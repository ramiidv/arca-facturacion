/**
 * Ejemplo: Factura de exportación (WSFEX)
 *
 * Usa facturarExpo() que obtiene automáticamente el ID de request
 * y el número de comprobante, y calcula el total por item.
 *
 * Si la respuesta se pierde (ArcaResultadoInciertoExpo), WSFEX permite
 * reenviar la misma solicitud con el mismo Id: si ya estaba autorizada,
 * devuelve el CAE original con reproceso = true, sin duplicar.
 */

import fs from "fs";
import { Arca, ArcaResultadoInciertoExpo, CbteTipo } from "@ramiidv/arca-facturacion";
import type { FacturarExpoOpts } from "@ramiidv/arca-facturacion";

async function main() {
  const arca = new Arca({
    cuit: 20123456786,
    cert: fs.readFileSync("./certs/certificado.crt", "utf-8"),
    key: fs.readFileSync("./certs/clave.key", "utf-8"),
    production: false,
  });

  const opts: FacturarExpoOpts = {
    ptoVta: 1,
    cbteTipo: CbteTipo.FACTURA_E,
    tipoExpo: 1, // 1=Bienes, 2=Servicios, 4=Otros
    pais: 203,   // País destino (203 = Estados Unidos)
    cliente: {
      nombre: "ACME Corp",
      cuitPais: 50000000016,
      domicilio: "123 Main St, New York, NY 10001",
      idImpositivo: "12-3456789",
    },
    moneda: "DOL",
    cotizacion: 1200,
    formaPago: "Wire Transfer - 30 days",
    incoterms: "FOB",
    idioma: 2, // 1=Español, 2=Inglés, 3=Portugués
    items: [
      {
        codigo: "SKU-001",
        descripcion: "Industrial Widget",
        cantidad: 100,
        unidad: 7, // 7 = unidades
        precioUnitario: 10,
        // total se calcula automáticamente: 100 * 10 = 1000
      },
      {
        codigo: "SKU-002",
        descripcion: "Premium Gasket",
        cantidad: 50,
        unidad: 7,
        precioUnitario: 25,
        bonificacion: 50, // descuento
        // total: 50 * 25 - 50 = 1200
      },
    ],
  };

  let result;
  try {
    result = await arca.facturarExpo(opts);
  } catch (e) {
    if (!(e instanceof ArcaResultadoInciertoExpo)) throw e;
    // Persistí e.intento antes de reintentar. Reenviar con el mismo Id, número y fecha:
    result = await arca.facturarExpo({ ...opts, ...e.intento });
    if (result.reproceso) console.log("WSFEX ya la tenía autorizada (reproceso)");
  }

  if (result.aprobada) {
    console.log("Factura de exportación aprobada!");
    console.log(`  CAE: ${result.cae}`);
    console.log(`  Vencimiento: ${result.caeVencimiento}`);
    console.log(`  Comprobante #${result.cbteNro}`);
  } else {
    console.error("Rechazada:", result.obs);
  }
}

main().catch(console.error);
