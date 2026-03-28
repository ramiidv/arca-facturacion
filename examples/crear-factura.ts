/**
 * Ejemplo: Crear una Factura B para consumidor final
 *
 * Requisitos:
 *   - Certificado digital (.crt) y clave privada (.key) de ARCA
 *   - CUIT del contribuyente
 *   - Punto de venta habilitado para facturación electrónica
 *
 * Para testing/homologación, generá el certificado desde:
 *   https://wsass-homo.afip.gob.ar/wsass/portal/main.aspx
 *
 * Para producción:
 *   https://auth.afip.gob.ar/contribuyente_/certificados/
 */

import fs from "fs";
import {
  Arca,
  CbteTipo,
  Concepto,
  DocTipo,
  IvaTipo,
  Moneda,
} from "arca-sdk";

async function main() {
  // 1. Inicializar el SDK
  const arca = new Arca({
    cuit: 20123456789, // Tu CUIT sin guiones
    cert: fs.readFileSync("./certs/certificado.crt", "utf-8"),
    key: fs.readFileSync("./certs/clave.key", "utf-8"),
    production: false, // true para producción
  });

  // 2. Verificar que los servidores estén activos
  const status = await arca.serverStatus();
  console.log("Estado servidores:", status);

  // 3. Obtener el siguiente número de comprobante
  const ptoVta = 1;
  const cbteTipo = CbteTipo.FACTURA_B;
  const nextNum = await arca.siguienteComprobante(ptoVta, cbteTipo);
  console.log(`Siguiente comprobante: ${nextNum}`);

  // 4. Crear la factura
  const result = await arca.crearFactura({
    PtoVta: ptoVta,
    CbteTipo: cbteTipo,
    invoices: [
      {
        Concepto: Concepto.PRODUCTOS,
        DocTipo: DocTipo.CONSUMIDOR_FINAL,
        DocNro: 0,
        CbteDesde: nextNum,
        CbteHasta: nextNum,
        CbteFch: Arca.formatDate(new Date()),
        ImpTotal: 121,
        ImpTotConc: 0,
        ImpNeto: 100,
        ImpOpEx: 0,
        ImpTrib: 0,
        ImpIVA: 21,
        MonId: Moneda.PESOS,
        MonCotiz: 1,
        Iva: [{ Id: IvaTipo.IVA_21, BaseImp: 100, Importe: 21 }],
      },
    ],
  });

  // 5. Procesar el resultado
  const { approved, cae, caeFchVto, details } = Arca.extractCAE(result);

  if (approved) {
    console.log(`Factura aprobada!`);
    console.log(`  CAE: ${cae}`);
    console.log(`  Vencimiento CAE: ${caeFchVto}`);
  } else {
    console.error("Factura rechazada:");
    for (const det of details) {
      if (det.Observaciones) {
        const obs = Array.isArray(det.Observaciones.Obs)
          ? det.Observaciones.Obs
          : [det.Observaciones.Obs];
        for (const o of obs) {
          console.error(`  [${o.Code}] ${o.Msg}`);
        }
      }
    }
  }
}

main().catch(console.error);
