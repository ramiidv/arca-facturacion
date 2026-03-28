/**
 * Ejemplo: Consultar datos de un contribuyente (Padrón)
 *
 * - consultarCuit(): padrón A13 (básico) — funciona con cert estándar
 * - consultarCuitDetalle(): padrón A5 (detallado) — requiere autorización adicional
 */

import fs from "fs";
import { Arca } from "@ramiidv/arca-sdk";

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

  if (persona.impuestos) {
    console.log("Impuestos:");
    for (const imp of persona.impuestos) {
      console.log(`  ${imp.descripcion} (${imp.id}): ${imp.estado}`);
    }
  }

  // Consulta detallada (padrón A5) — incluye domicilio
  // Requiere que el certificado tenga acceso a ws_sr_padron_a5
  try {
    const detalle = await arca.consultarCuitDetalle(30712345678);
    if (detalle.domicilioFiscal) {
      console.log("\nDomicilio fiscal:");
      console.log(`  ${detalle.domicilioFiscal.direccion}`);
      console.log(`  ${detalle.domicilioFiscal.localidad} (${detalle.domicilioFiscal.codPostal})`);
    }
  } catch (e) {
    console.log("\nA5 no disponible (requiere autorización adicional)");
  }
}

main().catch(console.error);
