/**
 * Ejemplo: Consultas de parámetros y comprobantes (WSFE + WSFEX)
 */

import fs from "fs";
import { Arca, CbteTipo, Moneda } from "@ramiidv/arca-facturacion";

async function main() {
  const arca = new Arca({
    cuit: 20123456786,
    cert: fs.readFileSync("./certs/certificado.crt", "utf-8"),
    key: fs.readFileSync("./certs/clave.key", "utf-8"),
    production: false,
  });

  // Tipos de comprobante disponibles
  const tiposCbte = await arca.getTiposComprobante();
  console.log("Tipos de comprobante:", tiposCbte);

  // Tipos de documento
  const tiposDoc = await arca.getTiposDocumento();
  console.log("Tipos de documento:", tiposDoc);

  // Tipos de IVA
  const tiposIva = await arca.getTiposIva();
  console.log("Tipos de IVA:", tiposIva);

  // Monedas
  const monedas = await arca.getMonedas();
  console.log("Monedas:", monedas);

  // Puntos de venta habilitados
  const ptosVenta = await arca.getPuntosVenta();
  console.log("Puntos de venta:", ptosVenta);

  // Cotización del dólar
  const cotizacion = await arca.getCotizacion(Moneda.DOLARES);
  console.log(`Cotización USD: ${cotizacion.MonCotiz} (${cotizacion.FchCotiz})`);

  // Cotización a una fecha puntual
  const cotizacionAyer = await arca.getCotizacion(Moneda.DOLARES, { fecha: "20261030" });
  console.log("Cotización USD al 30/10:", cotizacionAyer.MonCotiz);

  // Actividades del emisor (para informar en Actividades)
  console.log("Actividades:", await arca.getActividades());

  // Condiciones de IVA válidas para el receptor
  const condicionesIva = await arca.getCondicionesIva();
  console.log("Condiciones IVA:", condicionesIva);

  // Último comprobante autorizado
  const ultimoNro = await arca.ultimoComprobante(1, CbteTipo.FACTURA_B);
  console.log("Último Factura B en PtoVta 1:", ultimoNro);

  // Consultar un comprobante específico
  if (ultimoNro > 0) {
    const comprobante = await arca.consultarComprobante(
      CbteTipo.FACTURA_B,
      1,
      ultimoNro
    );
    console.log("Comprobante consultado:", comprobante.ResultGet);
  }

  // ============================================================
  // Parámetros WSFEX (exportación)
  // ============================================================

  const paises = await arca.getPaisesExpo();
  console.log("Países destino:", paises.slice(0, 5), "...");

  const incoterms = await arca.getIncotermsExpo();
  console.log("Incoterms:", incoterms);

  const unidades = await arca.getUMedExpo();
  console.log("Unidades de medida:", unidades.slice(0, 5), "...");

  const tiposExpo = await arca.getTiposExpo();
  console.log("Tipos de exportación:", tiposExpo);
}

main().catch(console.error);
