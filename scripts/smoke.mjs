#!/usr/bin/env node
/**
 * Smoke test del paquete publicado: verifica que se pueda consumir desde
 * proyectos TypeScript CommonJS y ESM, en tipos y en runtime.
 *
 * Uso: node scripts/smoke.mjs <export> [<export>...]
 *
 * Arma proyectos temporales que importan el paquete (vía symlink a este
 * directorio, como si estuviera instalado), los compila con tsc y los ejecuta.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const names = process.argv.slice(2);
if (names.length === 0) throw new Error('Indicá al menos un export a verificar');

const tsc = join(root, 'node_modules', '.bin', 'tsc');
const typeRoots = [join(root, 'node_modules', '@types'), join(root, '..', 'node_modules', '@types')];

const cases = [
  {
    name: 'CommonJS (module: CommonJS)',
    type: 'commonjs',
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node10', ignoreDeprecations: '6.0' },
  },
  { name: 'CommonJS (module: Node16)', type: 'commonjs', compilerOptions: { module: 'Node16', moduleResolution: 'Node16' } },
  { name: 'ESM (module: NodeNext)', type: 'module', compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' } },
];

const tsVersion = execFileSync(tsc, ['-v'], { encoding: 'utf8' });
const supportsIgnore6 = /Version ([6-9]|\d{2,})\./.test(tsVersion);

let failed = false;
for (const c of cases) {
  const dir = mkdtempSync(join(tmpdir(), 'arca-smoke-'));
  try {
    const scope = join(dir, 'node_modules', ...pkg.name.split('/').slice(0, -1));
    mkdirSync(scope, { recursive: true });
    symlinkSync(root, join(dir, 'node_modules', pkg.name), 'dir');

    const compilerOptions = { ...c.compilerOptions };
    if (!supportsIgnore6) delete compilerOptions.ignoreDeprecations;

    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: c.type }));
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          outDir: 'out',
          types: ['node'],
          typeRoots,
          ...compilerOptions,
        },
        files: ['index.ts'],
      }),
    );
    writeFileSync(
      join(dir, 'index.ts'),
      `import { ${names.join(', ')} } from ${JSON.stringify(pkg.name)};\n` +
        `const exported: Record<string, unknown> = { ${names.join(', ')} };\n` +
        `const missing = Object.entries(exported).filter(([, v]) => v === undefined).map(([k]) => k);\n` +
        `if (missing.length > 0) throw new Error("exports faltantes: " + missing.join(", "));\n` +
        `console.log("ok");\n`,
    );

    execFileSync(tsc, ['-p', dir], { stdio: 'pipe' });
    const out = execFileSync(process.execPath, [join(dir, 'out', 'index.js')], { encoding: 'utf8', cwd: dir });
    if (out.trim() !== 'ok') throw new Error(`salida inesperada: ${out}`);
    console.log(`✓ ${c.name}`);
  } catch (err) {
    failed = true;
    const detail = err.stdout?.toString() || err.stderr?.toString() || err.message;
    console.error(`✗ ${c.name}\n${detail}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failed) process.exit(1);
