// ============================================================
// Endpoints
// ============================================================

export const ENDPOINTS = {
  wsfe: {
    testing: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
    production: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
  wsfex: {
    testing: "https://wswhomo.afip.gov.ar/wsfexv1/service.asmx",
    production: "https://servicios1.afip.gov.ar/wsfexv1/service.asmx",
  },
  padronA5: {
    testing: "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5",
    production: "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5",
  },
  padronA13: {
    testing: "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA13",
    production: "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13",
  },
} as const;

/** Tipos de exportación (WSFEX). */
export enum TipoExpo {
  BIENES = 1,
  SERVICIOS = 2,
  OTROS = 4,
}

/**
 * Códigos de error internos de WSFEv1 (manual, "Errores generales"): 500 error
 * interno de aplicación, 501 de base de datos, 502 transacción activa. No
 * garantizan que el comprobante no se haya procesado.
 */
export const WSFE_ERRORES_INTERNOS: readonly number[] = [500, 501, 502];

/**
 * Código de error interno de infraestructura de WSFEX (manual WSFEX 3.1.1,
 * "Errores de infraestructura"): 500 aplicación, 501 base de datos, 502/505
 * autorizador - transacción activa. No garantizan que el comprobante no se
 * haya procesado.
 */
export const WSFEX_ERRORES_INTERNOS: readonly number[] = [500, 501, 502, 505];

/**
 * Validación 10016 de WSFEv1. El manual la usa para dos rechazos distintos:
 * - `<CbteDesde>` no es el próximo a autorizar (último + 1). Después de un
 *   resultado incierto suele indicar que el intento original sí se autorizó.
 * - `<CbteFch>` fuera de rango (N±5 / N±10 días, anterior al último emitido).
 *   No tiene nada que recuperar: hay que corregir la fecha.
 *
 * `requiereRecuperacion` distingue los dos casos por el mensaje.
 */
export const WSFE_NUMERO_NO_CORRESPONDE = 10016;

/** Servicios WSAA que usa este SDK. */
export const WSAA_SERVICES = {
  wsfe: "wsfe",
  wsfex: "wsfex",
  /** Constancia de inscripción (ex Padrón A5, `ws_sr_padron_a5` está deprecado). */
  padronA5: "ws_sr_constancia_inscripcion",
  padronA13: "ws_sr_padron_a13",
} as const;

export const WSFE_NAMESPACE = "http://ar.gov.afip.dif.FEV1/";
export const WSFEX_NAMESPACE = "http://ar.gov.afip.dif.fexv1/";
export const PADRON_A5_NAMESPACE = "http://a5.soap.ws.server.puc.sr/";
export const PADRON_A13_NAMESPACE = "http://a13.soap.ws.server.puc.sr/";

/**
 * URL base del QR de los comprobantes, según la especificación vigente de ARCA
 * ("Especificaciones del QR incluido en las facturas electrónicas").
 */
export const QR_URL = "https://www.arca.gob.ar/fe/qr/";

// ============================================================
// Tipos de Comprobante
// ============================================================

export enum CbteTipo {
  // Tipo A - Responsable Inscripto a Responsable Inscripto
  FACTURA_A = 1,
  NOTA_DEBITO_A = 2,
  NOTA_CREDITO_A = 3,
  RECIBO_A = 4,
  NOTA_VENTA_CONTADO_A = 5,

  // Tipo B - Responsable Inscripto a Consumidor Final / Monotributista / Exento
  FACTURA_B = 6,
  NOTA_DEBITO_B = 7,
  NOTA_CREDITO_B = 8,
  RECIBO_B = 9,
  NOTA_VENTA_CONTADO_B = 10,

  // Tipo C - Monotributista a cualquier receptor
  FACTURA_C = 11,
  NOTA_DEBITO_C = 12,
  NOTA_CREDITO_C = 13,
  RECIBO_C = 15,

  // Tipo E - Exportación
  FACTURA_E = 19,
  NOTA_DEBITO_E = 20,
  NOTA_CREDITO_E = 21,

  // RG 1415 - Comprobantes especiales
  CBTE_A_ANEXO_I_RG1415 = 34,
  CBTE_B_ANEXO_I_RG1415 = 35,
  OTROS_CBTE_A_RG1415 = 39,
  OTROS_CBTE_B_RG1415 = 40,

  // Bienes usados
  COMPRA_BIENES_USADOS = 49,

  // Tipo M - Operaciones habituales con restricciones fiscales
  FACTURA_M = 51,
  NOTA_DEBITO_M = 52,
  NOTA_CREDITO_M = 53,
  RECIBO_M = 54,

  // Cuenta de Venta y Líquido Producto
  CTA_VTA_LIQ_PROD_A = 60,
  CTA_VTA_LIQ_PROD_B = 61,

  // Liquidaciones
  LIQUIDACION_A = 63,
  LIQUIDACION_B = 64,

  // Factura de Crédito Electrónica MiPyME (FCE) - Tipo A
  FCE_FACTURA_A = 201,
  FCE_NOTA_DEBITO_A = 202,
  FCE_NOTA_CREDITO_A = 203,

  // Factura de Crédito Electrónica MiPyME (FCE) - Tipo B
  FCE_FACTURA_B = 206,
  FCE_NOTA_DEBITO_B = 207,
  FCE_NOTA_CREDITO_B = 208,

  // Factura de Crédito Electrónica MiPyME (FCE) - Tipo C
  FCE_FACTURA_C = 211,
  FCE_NOTA_DEBITO_C = 212,
  FCE_NOTA_CREDITO_C = 213,
}

// ============================================================
// Tipos de Concepto
// ============================================================

export enum Concepto {
  PRODUCTOS = 1,
  SERVICIOS = 2,
  PRODUCTOS_Y_SERVICIOS = 3,
}

// ============================================================
// Tipos de Documento
// ============================================================

// Definido en @ramiidv/arca-common (tabla oficial completa, incluye las cédulas
// provinciales y el código 99 como CONSUMIDOR_FINAL / SIN_IDENTIFICAR).
export { DocTipo } from "@ramiidv/arca-common";

// ============================================================
// Condición de IVA del receptor
// ============================================================

// Definido en @ramiidv/arca-common para compartirlo con arca-padron.
export { CondicionIva } from "@ramiidv/arca-common";

// ============================================================
// Tipos de IVA (alícuotas)
// ============================================================

export enum IvaTipo {
  IVA_0 = 3,
  IVA_10_5 = 4,
  IVA_21 = 5,
  IVA_27 = 6,
  IVA_5 = 8,
  IVA_2_5 = 9,
}

export const IVA_RATES: Record<IvaTipo, number> = {
  [IvaTipo.IVA_0]: 0,
  [IvaTipo.IVA_2_5]: 2.5,
  [IvaTipo.IVA_5]: 5,
  [IvaTipo.IVA_10_5]: 10.5,
  [IvaTipo.IVA_21]: 21,
  [IvaTipo.IVA_27]: 27,
};

// ============================================================
// Tipos de Moneda
// ============================================================

export enum Moneda {
  PESOS = "PES",
  DOLARES = "DOL",
  EUROS = "060",
  REALES = "012",
  PESOS_URUGUAYOS = "011",
  PESOS_CHILENOS = "033",
  GUARANIES = "031",
  BOLIVIANOS = "029",
  PESOS_COLOMBIANOS = "032",
  PESOS_MEXICANOS = "010",
  LIBRAS_ESTERLINAS = "021",
  YENES = "019",
  FRANCOS_SUIZOS = "009",
  DOLARES_CANADIENSES = "018",
  YUANES = "064",
}

// ============================================================
// Mapeos de CbteTipo: Factura → Nota Crédito / Nota Débito
// ============================================================

/**
 * Factura → Nota de Crédito del mismo tipo. Incluye la clase E (exportación)
 * como referencia, pero esas notas se emiten por WSFEX (`facturarExpo`), no
 * con `notaCredito`.
 */
export const NOTA_CREDITO_MAP: Record<number, number> = {
  [CbteTipo.FACTURA_A]: CbteTipo.NOTA_CREDITO_A,
  [CbteTipo.FACTURA_B]: CbteTipo.NOTA_CREDITO_B,
  [CbteTipo.FACTURA_C]: CbteTipo.NOTA_CREDITO_C,
  [CbteTipo.FACTURA_E]: CbteTipo.NOTA_CREDITO_E,
  [CbteTipo.FACTURA_M]: CbteTipo.NOTA_CREDITO_M,
  [CbteTipo.FCE_FACTURA_A]: CbteTipo.FCE_NOTA_CREDITO_A,
  [CbteTipo.FCE_FACTURA_B]: CbteTipo.FCE_NOTA_CREDITO_B,
  [CbteTipo.FCE_FACTURA_C]: CbteTipo.FCE_NOTA_CREDITO_C,
};

/** Factura → Nota de Débito del mismo tipo (la clase E se emite por WSFEX, ver `NOTA_CREDITO_MAP`). */
export const NOTA_DEBITO_MAP: Record<number, number> = {
  [CbteTipo.FACTURA_A]: CbteTipo.NOTA_DEBITO_A,
  [CbteTipo.FACTURA_B]: CbteTipo.NOTA_DEBITO_B,
  [CbteTipo.FACTURA_C]: CbteTipo.NOTA_DEBITO_C,
  [CbteTipo.FACTURA_E]: CbteTipo.NOTA_DEBITO_E,
  [CbteTipo.FACTURA_M]: CbteTipo.NOTA_DEBITO_M,
  [CbteTipo.FCE_FACTURA_A]: CbteTipo.FCE_NOTA_DEBITO_A,
  [CbteTipo.FCE_FACTURA_B]: CbteTipo.FCE_NOTA_DEBITO_B,
  [CbteTipo.FCE_FACTURA_C]: CbteTipo.FCE_NOTA_DEBITO_C,
};

/** CbteTipo que NO discriminan IVA (Monotributista - tipo C) */
const TIPOS_C = new Set([
  CbteTipo.FACTURA_C,
  CbteTipo.NOTA_DEBITO_C,
  CbteTipo.NOTA_CREDITO_C,
  CbteTipo.RECIBO_C,
  CbteTipo.FCE_FACTURA_C,
  CbteTipo.FCE_NOTA_DEBITO_C,
  CbteTipo.FCE_NOTA_CREDITO_C,
]);

export function isTipoC(cbteTipo: number): boolean {
  return TIPOS_C.has(cbteTipo);
}

/** Comprobantes de exportación (clase E): se emiten por WSFEX, no por WSFEv1. */
const TIPOS_E = new Set<number>([CbteTipo.FACTURA_E, CbteTipo.NOTA_DEBITO_E, CbteTipo.NOTA_CREDITO_E]);

export function isTipoE(cbteTipo: number): boolean {
  return TIPOS_E.has(cbteTipo);
}

/** Comprobantes clase A (incluida FCE A): el receptor debe ser RI o monotributista. */
const TIPOS_A = new Set<number>([
  CbteTipo.FACTURA_A,
  CbteTipo.NOTA_DEBITO_A,
  CbteTipo.NOTA_CREDITO_A,
  CbteTipo.RECIBO_A,
  CbteTipo.NOTA_VENTA_CONTADO_A,
  CbteTipo.FCE_FACTURA_A,
  CbteTipo.FCE_NOTA_DEBITO_A,
  CbteTipo.FCE_NOTA_CREDITO_A,
]);

export function isTipoA(cbteTipo: number): boolean {
  return TIPOS_A.has(cbteTipo);
}

/** Facturas de Crédito Electrónica MiPyME (FCE), cualquier clase. */
export function isFCE(cbteTipo: number): boolean {
  return cbteTipo >= 201 && cbteTipo <= 213;
}

/** Notas de crédito y débito (WSFEv1, incluidas FCE). */
const NOTAS = new Set<number>([
  ...Object.values(NOTA_CREDITO_MAP),
  ...Object.values(NOTA_DEBITO_MAP),
].filter((t) => !TIPOS_E.has(t)));

export function isNotaCreditoODebito(cbteTipo: number): boolean {
  return NOTAS.has(cbteTipo);
}

// ============================================================
// Tipos de Tributo
// ============================================================

export enum TributoTipo {
  IMPUESTOS_NACIONALES = 1,
  IMPUESTOS_PROVINCIALES = 2,
  IMPUESTOS_MUNICIPALES = 3,
  IMPUESTOS_INTERNOS = 4,
  IIBB = 5,
  PERCEP_IVA = 6,
  PERCEP_IIBB = 7,
  PERCEP_MUNICIPALES = 8,
  OTRAS_PERCEPCIONES = 9,
  OTRO = 99,
}
