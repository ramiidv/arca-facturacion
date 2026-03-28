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
import { Arca, CbteTipo, DocTipo, IvaTipo } from "@ramiidv/arca-sdk";

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

  // 3. Crear la factura (número, fecha, totales e IVA se calculan automáticamente)
  const result = await arca.facturar({
    ptoVta: 1,
    cbteTipo: CbteTipo.FACTURA_B,
    items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
  });

  // 4. Verificar resultado
  if (result.aprobada) {
    console.log("Factura aprobada!");
    console.log(`  CAE: ${result.cae}`);
    console.log(`  Vencimiento: ${result.caeVencimiento}`);
    console.log(`  Comprobante #${result.cbteNro}`);
    console.log(`  Total: $${result.importes.total}`);

    // 5. Generar URL del QR oficial para imprimir en la factura
    const qrUrl = Arca.generateQRUrl({
      fecha: result.caeVencimiento!.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
      cuit: 20123456789,
      ptoVta: result.ptoVta,
      tipoCmp: result.cbteTipo,
      nroCmp: result.cbteNro,
      importe: result.importes.total,
      moneda: "PES",
      ctz: 1,
      tipoDocRec: DocTipo.CONSUMIDOR_FINAL,
      nroDocRec: 0,
      codAut: Number(result.cae),
    });
    console.log(`  QR: ${qrUrl}`);
  } else {
    console.error("Factura rechazada:");
    for (const obs of result.observaciones) {
      console.error(`  [${obs.code}] ${obs.msg}`);
    }
  }
}

main().catch(console.error);
