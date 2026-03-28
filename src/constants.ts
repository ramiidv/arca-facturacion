// ============================================================
// Endpoints
// ============================================================

export const ENDPOINTS = {
  wsaa: {
    testing: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    production: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
  },
  wsfe: {
    testing: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
    production: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
  wsfex: {
    testing: "https://wswhomo.afip.gov.ar/wsfexv1/service.asmx",
    production: "https://servicios1.afip.gov.ar/wsfexv1/service.asmx",
  },
} as const;

export const WSFE_NAMESPACE = "http://ar.gov.afip.dif.FEV1/";
export const WSFEX_NAMESPACE = "http://ar.gov.afip.dif.fexv1/";
export const WSAA_NAMESPACE =
  "http://wsaa.view.sua.dvadac.desein.afip.gov/LoginCMSService";

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

export enum DocTipo {
  CUIT = 80,
  CUIL = 86,
  CDI = 87,
  LE = 89,
  LC = 90,
  CI_EXTRANJERA = 91,
  EN_TRAMITE = 92,
  ACTA_NACIMIENTO = 93,
  PASAPORTE = 94,
  CI_BS_AS_RNP = 95,
  DNI = 96,
  CONSUMIDOR_FINAL = 99,
}

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
