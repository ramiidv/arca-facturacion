/**
 * Ejemplo: CAEA — Facturación offline / contingencia
 *
 * Flujo:
 *   1. Solicitar CAEA para un período (antes de que empiece)
 *   2. Emitir facturas offline usando el CAEA
 *   3. Informar las facturas a ARCA
 *   4. Si no hubo movimientos, informar sin movimiento
 *
 * El CAEA debe solicitarse al menos 5 días antes del inicio del período.
 * Cada período es una quincena: orden 1 (días 1-15) u orden 2 (días 16-fin).
 */

import fs from "fs";
import { Arca, CbteTipo, IvaTipo } from "@ramiidv/arca-sdk";

async function main() {
  const arca = new Arca({
    cuit: 20123456789,
    cert: fs.readFileSync("./certs/certificado.crt", "utf-8"),
    key: fs.readFileSync("./certs/clave.key", "utf-8"),
    production: false,
  });

  // 1. Solicitar CAEA para abril 2026, primera quincena
  const caea = await arca.solicitarCAEA("202604", 1);
  console.log(`CAEA: ${caea.CAEA}`);
  console.log(`Vigencia: ${caea.FchVigDesde} - ${caea.FchVigHasta}`);
  console.log(`Tope informar: ${caea.FchTopeInf}`);

  // 2. Registrar facturas emitidas con el CAEA
  //    Usa la misma interfaz que facturar() — auto-calcula IVA y totales
  const result = await arca.registrarFacturaCAEA(caea.CAEA, {
    ptoVta: 5, // punto de venta habilitado para CAEA
    cbteTipo: CbteTipo.FACTURA_B,
    items: [{ neto: 1000, iva: IvaTipo.IVA_21 }],
  });

  if (result.aprobada) {
    console.log(`Factura registrada — Cbte #${result.cbteNro}`);
    console.log(`Total: $${result.importes.total}`);
  } else {
    console.error("Error:", result.observaciones);
  }

  // 3. Si no hubo movimientos en el período para un punto de venta
  // await arca.sinMovimientoCAEA(caea.CAEA, 5);

  // Consultar un CAEA existente
  const existente = await arca.consultarCAEA("202604", 1);
  console.log("CAEA consultado:", existente.CAEA);
}

main().catch(console.error);
