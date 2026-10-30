/**
 * Ejemplo: Consultar datos de un contribuyente (Padrón)
 *
 * DEPRECADO: para consultas de padrón usá @ramiidv/arca-padron, que además
 * tiene condicionIvaDesdePadron. Estos métodos se mantienen por compatibilidad.
 *
 * - consultarCuit(): padrón A13 — requiere acceso a ws_sr_padron_a13
 * - consultarCuitDetalle(): constancia de inscripción (ex A5) — requiere acceso a
 *   ws_sr_constancia_inscripcion
 */

import fs from "fs";
import { Arca } from "@ramiidv/arca-facturacion";

async function main() {
  const arca = new Arca({
    cuit: 20123456789,
    cert: fs.readFileSync("./certs/certificado.crt", "utf-8"),
    key: fs.readFileSync("./certs/clave.key", "utf-8"),
    production: false,
  });

  // Consulta básica (padrón A13)
  const persona = await arca.consultarCuit(30712345678);

  console.log("=== Datos del contribuyente ===");
  console.log(`CUIT: ${persona.cuit}`);
  console.log(`Nombre: ${persona.nombre}`);
  console.log(`Tipo: ${persona.tipoPersona}`);   // "FISICA" o "JURIDICA"
  console.log(`Estado: ${persona.estadoClave}`);  // "ACTIVO", etc.

  // Constancia de inscripción (ex padrón A5): domicilio fiscal e impuestos.
  // Requiere que el certificado tenga acceso a ws_sr_constancia_inscripcion
  try {
    const detalle = await arca.consultarCuitDetalle(30712345678);
    if (detalle.domicilioFiscal) {
      console.log("\nDomicilio fiscal:");
      console.log(`  ${detalle.domicilioFiscal.direccion}`);
      console.log(`  ${detalle.domicilioFiscal.localidad} (${detalle.domicilioFiscal.codPostal})`);
    }
    for (const imp of detalle.impuestos ?? []) {
      console.log(`  ${imp.descripcion} (${imp.id}): ${imp.estado}`);
    }
  } catch (e) {
    console.log("\nConstancia no disponible (requiere autorización de ws_sr_constancia_inscripcion)");
  }
}

main().catch(console.error);
