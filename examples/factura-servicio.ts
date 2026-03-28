/**
 * Ejemplo: Crear una Factura A por servicios
 *
 * Para facturas de servicios (Concepto 2 o 3), es obligatorio
 * incluir FchServDesde, FchServHasta y FchVtoPago.
 */

import fs from "fs";
import {
  Arca,
  CbteTipo,
  Concepto,
  DocTipo,
  IvaTipo,
  Moneda,
} from "@ramiidv/arca-sdk";

async function main() {
  const arca = new Arca({
    cuit: 20123456789,
    cert: fs.readFileSync("./certs/certificado.crt", "utf-8"),
    key: fs.readFileSync("./certs/clave.key", "utf-8"),
    production: false,
  });

  const today = Arca.formatDate(new Date());
  const neto = 50000;
  const iva = neto * 0.21;
  const total = neto + iva;

  // Usar crearFacturaAuto para obtener automáticamente el siguiente número
  const result = await arca.crearFacturaAuto(
    1, // punto de venta
    CbteTipo.FACTURA_A,
    {
      Concepto: Concepto.SERVICIOS,
      DocTipo: DocTipo.CUIT,
      DocNro: 30712345678, // CUIT del cliente
      CbteFch: today,
      ImpTotal: total,
      ImpTotConc: 0,
      ImpNeto: neto,
      ImpOpEx: 0,
      ImpTrib: 0,
      ImpIVA: iva,
      MonId: Moneda.PESOS,
      MonCotiz: 1,
      // Obligatorio para servicios:
      FchServDesde: "20260301",
      FchServHasta: "20260331",
      FchVtoPago: today,
      Iva: [{ Id: IvaTipo.IVA_21, BaseImp: neto, Importe: iva }],
    }
  );

  const { approved, cae } = Arca.extractCAE(result);
  console.log(approved ? `CAE: ${cae}` : "Rechazada");
}

main().catch(console.error);
