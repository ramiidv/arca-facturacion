import { formatDate, validateCuit } from "@ramiidv/arca-common";
import { QR_URL } from "./constants.js";
import { redondear2 } from "./facturacion.js";
import { fail } from "./validation.js";
import type { FacturaResult, QRInput, QROptions } from "./types.js";

/**
 * Genera la URL del QR de un comprobante según la especificación de ARCA
 * ("Especificaciones del QR incluido en las facturas electrónicas", versión 1):
 * `{URL}?p={JSON en Base64}`.
 *
 * - `fecha` se envía como `YYYY-MM-DD` (acepta `YYYYMMDD`, `YYYY-MM-DD` o `Date`).
 * - `codAut` se envía como número de 14 dígitos (acepta el string que devuelve ARCA).
 * - `tipoDocRec` / `nroDocRec` son "de corresponder": si no vienen, no se incluyen.
 * - La URL base es `QR_URL` (https://www.arca.gob.ar/fe/qr/) salvo `options.baseUrl`.
 *
 * @throws ArcaValidationError si algún dato no es válido.
 */
export function generarUrlQR(input: QRInput, options?: QROptions): string {
  let fecha: string;
  try {
    fecha = formatDate(input.fecha);
  } catch {
    fail("fecha", "fecha debe ser un Date o una fecha existente YYYYMMDD / YYYY-MM-DD", input.fecha);
  }
  let cuit: number;
  try {
    cuit = Number(validateCuit(input.cuit));
  } catch {
    fail("cuit", "cuit no es un CUIT válido", input.cuit);
  }
  const codAut = String(input.codAut ?? "").trim();
  if (!/^\d{14}$/.test(codAut)) fail("codAut", "codAut debe ser el CAE/CAEA de 14 dígitos", input.codAut);
  for (const k of ["ptoVta", "tipoCmp", "nroCmp"] as const) {
    if (!Number.isInteger(input[k]) || input[k] < 1) fail(k, `${k} debe ser un entero >= 1`, input[k]);
  }
  if (typeof input.importe !== "number" || !Number.isFinite(input.importe)) fail("importe", "importe debe ser un número", input.importe);
  if (typeof input.ctz !== "number" || !Number.isFinite(input.ctz) || input.ctz <= 0) fail("ctz", "ctz debe ser un número > 0", input.ctz);
  if (!input.moneda) fail("moneda", "moneda es requerida", input.moneda);
  const tipoCodAut = input.tipoCodAut ?? "E";
  if (tipoCodAut !== "E" && tipoCodAut !== "A") fail("tipoCodAut", 'tipoCodAut debe ser "E" (CAE) o "A" (CAEA)', tipoCodAut);

  const payload: Record<string, unknown> = {
    ver: 1,
    fecha: `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}`,
    cuit,
    ptoVta: input.ptoVta,
    tipoCmp: input.tipoCmp,
    nroCmp: input.nroCmp,
    importe: redondear2(input.importe),
    moneda: input.moneda,
    ctz: input.ctz,
  };
  if (input.tipoDocRec !== undefined && input.tipoDocRec !== null) payload.tipoDocRec = input.tipoDocRec;
  if (input.nroDocRec !== undefined && input.nroDocRec !== null && input.nroDocRec !== "") {
    const nro = Number(input.nroDocRec);
    if (!Number.isSafeInteger(nro) || nro < 0) fail("nroDocRec", "nroDocRec debe ser un número entero", input.nroDocRec);
    payload.nroDocRec = nro;
  }
  payload.tipoCodAut = tipoCodAut;
  // 14 dígitos < 2^53: el número es exacto.
  payload.codAut = Number(codAut);

  const base64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${options?.baseUrl ?? QR_URL}?p=${base64}`;
}

/** Datos del QR que no están en un `FacturaResult` (o para sobrescribirlos). */
export interface DatosQR {
  /** CUIT del emisor */
  cuit: number | string;
  /** Fecha del comprobante. Default: `factura.fecha`. */
  fecha?: string | Date;
  /** Moneda. Default: `factura.moneda`, o "PES". */
  moneda?: string;
  /** Cotización. Default: `factura.cotizacion`, o 1 si la moneda es PES. */
  ctz?: number;
  /** Tipo de documento del receptor. Default: `factura.docTipo`. */
  tipoDocRec?: number;
  /** Número de documento del receptor. Default: `factura.docNro`. */
  nroDocRec?: number | string;
  /** "E" (CAE) o "A" (CAEA). Default: `factura.tipoCodAut`, o "E". */
  tipoCodAut?: "E" | "A";
}

/**
 * Genera la URL del QR a partir del resultado de `facturar` / `notaCredito` /
 * `notaDebito` / `registrarFacturaCAEA` / `recuperarComprobante`.
 *
 * Con moneda extranjera y `canMisMonExt: "S"` sin cotización enviada, pasar
 * `datos.ctz` (la cotización con la que ARCA autorizó el comprobante).
 *
 * @throws ArcaValidationError si el comprobante no está aprobado o faltan datos.
 */
export function urlQRDesdeFactura(factura: FacturaResult, datos: DatosQR, options?: QROptions): string {
  if (!factura.aprobada || !factura.cae) fail("factura", "el comprobante no está aprobado: no tiene CAE para el QR");
  const fecha = datos.fecha ?? factura.fecha;
  if (fecha === undefined) fail("fecha", "falta la fecha del comprobante (datos.fecha)");
  const moneda = datos.moneda ?? factura.moneda ?? "PES";
  const ctz = datos.ctz ?? factura.cotizacion ?? (moneda === "PES" ? 1 : undefined);
  if (ctz === undefined) fail("ctz", "falta la cotización del comprobante (datos.ctz)");
  return generarUrlQR(
    {
      fecha,
      cuit: datos.cuit,
      ptoVta: factura.ptoVta,
      tipoCmp: factura.cbteTipo,
      nroCmp: factura.cbteNro,
      importe: factura.importes.total,
      moneda,
      ctz,
      tipoDocRec: datos.tipoDocRec ?? factura.docTipo,
      nroDocRec: datos.nroDocRec ?? factura.docNro,
      tipoCodAut: datos.tipoCodAut ?? factura.tipoCodAut ?? "E",
      codAut: factura.cae,
    },
    options
  );
}
