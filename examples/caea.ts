/**
 * Ejemplo: CAEA — Facturación en contingencia
 *
 * Desde la RG 5782 el CAEA es solo para contingencias: todos los puntos de
 * venta CAEA son de contingencia, tienen que compartir domicilio con uno CAE
 * (o controlador fiscal) y cada comprobante se informa con la fecha y hora en
 * que se generó (CbteFchHsGen, obligatorio: error 1440).
 *
 * Flujo:
 *   1. Solicitar CAEA para la quincena (o consultarlo si ya se pidió)
 *   2. Durante la contingencia, emitir comprobantes offline con ese CAEA
 *      guardando la fecha y hora de generación de cada uno
 *   3. Informarlos a ARCA (registrarFacturaCAEA) antes de FchTopeInf
 *   4. Si un punto de venta no tuvo movimientos, informarlo sin movimiento
 *
 * Cada período es una quincena: orden 1 (días 1-15) u orden 2 (días 16-fin).
 */

import fs from "fs";
import { Arca, CbteTipo, IvaTipo } from "@ramiidv/arca-facturacion";

async function main() {
  const arca = new Arca({
    cuit: 20123456786,
    cert: fs.readFileSync("./certs/certificado.crt", "utf-8"),
    key: fs.readFileSync("./certs/clave.key", "utf-8"),
    production: false,
  });

  // 1. Solicitar CAEA para noviembre 2026, primera quincena
  const caea = await arca.solicitarCAEA("202611", 1);
  console.log(`CAEA: ${caea.CAEA}`);
  console.log(`Vigencia: ${caea.FchVigDesde} - ${caea.FchVigHasta}`);
  console.log(`Tope informar: ${caea.FchTopeInf}`);

  // 2-3. Informar un comprobante emitido offline con el CAEA.
  //    Misma interfaz que facturar() (calcula IVA y totales) más la fecha y
  //    hora de generación. La fecha del comprobante sale de esa fecha y hora.
  const result = await arca.registrarFacturaCAEA(caea.CAEA, {
    ptoVta: 5, // punto de venta CAEA (contingencia)
    cbteTipo: CbteTipo.FACTURA_B,
    cbteNro: 120, // el número que se usó al emitirlo offline
    fechaHoraGeneracion: new Date("2026-11-03T14:32:10-03:00"),
    items: [{ neto: 1000, iva: IvaTipo.IVA_21 }],
  });

  if (result.aprobada) {
    console.log(`Factura registrada — Cbte #${result.cbteNro}`);
    console.log(`Total: $${result.importes.total}`);
  } else {
    console.error("Error:", result.observaciones);
  }

  // 4. Si no hubo movimientos en el período para un punto de venta
  // await arca.sinMovimientoCAEA(caea.CAEA, 6);
  // console.log(await arca.consultarSinMovimientoCAEA(caea.CAEA, 6));

  // Consultar un CAEA existente
  const existente = await arca.consultarCAEA("202611", 1);
  console.log("CAEA consultado:", existente.CAEA);
}

main().catch(console.error);
