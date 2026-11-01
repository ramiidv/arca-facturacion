/**
 * Ejemplo: Crear una Factura A por servicios
 *
 * Para servicios, es obligatorio incluir el período y vencimiento de pago.
 * Al proveer `servicio`, el concepto se auto-detecta como SERVICIOS.
 */

import fs from "fs";
import { Arca, CbteTipo, CondicionIva, DocTipo, IvaTipo } from "@ramiidv/arca-facturacion";

async function main() {
  const arca = new Arca({
    cuit: 20123456786,
    cert: fs.readFileSync("./certs/certificado.crt", "utf-8"),
    key: fs.readFileSync("./certs/clave.key", "utf-8"),
    production: false,
  });

  const result = await arca.facturar({
    ptoVta: 1,
    cbteTipo: CbteTipo.FACTURA_A,
    docTipo: DocTipo.CUIT,
    docNro: 30712345671,
    condicionIva: CondicionIva.RESPONSABLE_INSCRIPTO,
    items: [
      { neto: 50000, iva: IvaTipo.IVA_21 },
      { neto: 10000, iva: IvaTipo.IVA_10_5 },
    ],
    servicio: {
      desde: new Date("2026-03-01"),
      hasta: new Date("2026-03-31"),
      vtoPago: new Date("2026-04-15"),
    },
  });

  if (result.aprobada) {
    console.log(`CAE: ${result.cae}`);
    console.log(`Neto: $${result.importes.neto}`);
    console.log(`IVA: $${result.importes.iva}`);
    console.log(`Total: $${result.importes.total}`);
  }
}

main().catch(console.error);
