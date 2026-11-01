/**
 * Ejemplo: Crear una Nota de Crédito
 *
 * El tipo de NC se infiere automáticamente del comprobante original:
 *   FACTURA_A → NOTA_CREDITO_A
 *   FACTURA_B → NOTA_CREDITO_B
 *   etc.
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

  // Nota de crédito B asociada a la factura B #150
  const result = await arca.notaCredito({
    ptoVta: 1,
    comprobanteOriginal: {
      tipo: CbteTipo.FACTURA_B,
      ptoVta: 1,
      nro: 150,
    },
    items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
  });

  if (result.aprobada) {
    console.log(`NC aprobada — CAE: ${result.cae}, Cbte #${result.cbteNro}`);
  } else {
    console.error("NC rechazada:", result.observaciones);
  }
}

main().catch(console.error);
