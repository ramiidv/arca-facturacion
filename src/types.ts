// ============================================================
// Configuración
// ============================================================

export interface ArcaConfig {
  /** CUIT del contribuyente (sin guiones) */
  cuit: number;
  /** Contenido del certificado X.509 en formato PEM */
  cert: string;
  /** Contenido de la clave privada en formato PEM */
  key: string;
  /** Usar entorno de producción (default: false = testing/homologación) */
  production?: boolean;
  /** Tiempo de vida del token en minutos (default: 720 = 12 horas) */
  tokenTTLMinutes?: number;
}

// ============================================================
// WSAA - Autenticación
// ============================================================

export interface AccessTicket {
  token: string;
  sign: string;
  expirationTime: Date;
}

// ============================================================
// WSFE - Auth
// ============================================================

export interface WsfeAuth {
  Token: string;
  Sign: string;
  Cuit: number;
}

// ============================================================
// WSFE - Solicitar CAE
// ============================================================

export interface AlicuotaIva {
  /** ID de tipo de IVA (usar enum IvaTipo) */
  Id: number;
  /** Base imponible */
  BaseImp: number;
  /** Importe del IVA */
  Importe: number;
}

export interface Tributo {
  /** ID de tipo de tributo (usar enum TributoTipo) */
  Id: number;
  /** Descripción del tributo */
  Desc: string;
  /** Base imponible */
  BaseImp: number;
  /** Alícuota del tributo */
  Alic: number;
  /** Importe del tributo */
  Importe: number;
}

export interface ComprobanteAsociado {
  /** Tipo de comprobante asociado */
  Tipo: number;
  /** Punto de venta del comprobante asociado */
  PtoVta: number;
  /** Número de comprobante asociado */
  Nro: number;
  /** CUIT del emisor del comprobante asociado */
  Cuit?: number;
  /** Fecha del comprobante asociado (formato YYYYMMDD) */
  CbteFch?: string;
}

export interface Opcional {
  /** ID de dato opcional */
  Id: string;
  /** Valor del dato opcional */
  Valor: string;
}

export interface InvoiceDetail {
  /** Concepto: 1=Productos, 2=Servicios, 3=Productos y Servicios */
  Concepto: number;
  /** Tipo de documento del receptor (usar enum DocTipo) */
  DocTipo: number;
  /** Número de documento del receptor */
  DocNro: number;
  /** Número de comprobante desde */
  CbteDesde: number;
  /** Número de comprobante hasta */
  CbteHasta: number;
  /** Fecha del comprobante (formato YYYYMMDD) */
  CbteFch: string;
  /** Importe total */
  ImpTotal: number;
  /** Importe total de conceptos no gravados */
  ImpTotConc: number;
  /** Importe neto gravado */
  ImpNeto: number;
  /** Importe exento de IVA */
  ImpOpEx: number;
  /** Importe total de tributos */
  ImpTrib: number;
  /** Importe total de IVA */
  ImpIVA: number;
  /** Código de moneda (usar enum Moneda) */
  MonId: string;
  /** Cotización de la moneda (1 para pesos) */
  MonCotiz: number;
  /** Fecha inicio del servicio (formato YYYYMMDD, requerido para servicios) */
  FchServDesde?: string;
  /** Fecha fin del servicio (formato YYYYMMDD, requerido para servicios) */
  FchServHasta?: string;
  /** Fecha de vencimiento de pago (formato YYYYMMDD, requerido para servicios) */
  FchVtoPago?: string;
  /** Array de alícuotas de IVA */
  Iva?: AlicuotaIva[];
  /** Array de tributos */
  Tributos?: Tributo[];
  /** Array de comprobantes asociados */
  CbtesAsoc?: ComprobanteAsociado[];
  /** Array de datos opcionales */
  Opcionales?: Opcional[];
}

export interface InvoiceRequest {
  /** Punto de venta */
  PtoVta: number;
  /** Tipo de comprobante (usar enum CbteTipo) */
  CbteTipo: number;
  /** Detalle de comprobantes */
  invoices: InvoiceDetail[];
}

// ============================================================
// WSFE - Respuestas
// ============================================================

export interface FeCabResp {
  Cuit: number;
  PtoVta: number;
  CbteTipo: number;
  FchProceso: string;
  CantReg: number;
  Resultado: "A" | "R" | "P";
  Reproceso: string;
}

export interface FECAEDetResponse {
  Concepto: number;
  DocTipo: number;
  DocNro: number;
  CbteDesde: number;
  CbteHasta: number;
  CbteFch: string;
  Resultado: "A" | "R";
  CAE: string;
  CAEFchVto: string;
  Observaciones?: { Obs: WsError | WsError[] };
}

export interface WsError {
  Code: number;
  Msg: string;
}

export interface FECAESolicitarResult {
  FeCabResp: FeCabResp;
  FeDetResp: { FECAEDetResponse: FECAEDetResponse | FECAEDetResponse[] };
  Errors?: { Err: WsError | WsError[] };
  Events?: { Evt: WsError | WsError[] };
}

export interface FECompUltimoAutorizadoResult {
  PtoVta: number;
  CbteTipo: number;
  CbteNro: number;
  Errors?: { Err: WsError | WsError[] };
  Events?: { Evt: WsError | WsError[] };
}

export interface FECompConsultarResult {
  ResultGet: {
    Concepto: number;
    DocTipo: number;
    DocNro: number;
    CbteDesde: number;
    CbteHasta: number;
    CbteFch: string;
    ImpTotal: number;
    ImpTotConc: number;
    ImpNeto: number;
    ImpOpEx: number;
    ImpTrib: number;
    ImpIVA: number;
    FchServDesde: string;
    FchServHasta: string;
    FchVtoPago: string;
    MonId: string;
    MonCotiz: number;
    Resultado: "A" | "R";
    CodAutorizacion: string;
    EmisionTipo: string;
    FchVto: string;
    FchProceso: string;
    PtoVta: number;
    CbteTipo: number;
  };
  Errors?: { Err: WsError | WsError[] };
  Events?: { Evt: WsError | WsError[] };
}

export interface ServerStatus {
  AppServer: string;
  DbServer: string;
  AuthServer: string;
}

export interface ParamItem {
  Id: number;
  Desc: string;
  FchDesde?: string;
  FchHasta?: string;
}

export interface MonedaItem {
  Id: string;
  Desc: string;
  FchDesde?: string;
  FchHasta?: string;
}

export interface PtoVentaItem {
  Nro: number;
  EmisionTipo: string;
  Bloqueado: string;
  FchBaja: string;
}

export interface CotizacionResult {
  MonId: string;
  MonCotiz: number;
  FchCotiz: string;
  Errors?: { Err: WsError | WsError[] };
}
