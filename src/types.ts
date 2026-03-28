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
  /** Timeout para requests HTTP en milisegundos (default: 30000 = 30 segundos) */
  requestTimeoutMs?: number;
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

// ============================================================
// API Simplificada - Tipos de entrada
// ============================================================

export interface LineItem {
  /** Importe neto (sin IVA) */
  neto: number;
  /**
   * Tipo de alícuota IVA (usar enum IvaTipo).
   * Si no se especifica y exento=false, el item se trata como no gravado (ImpTotConc).
   */
  iva?: number;
  /** Si true, el importe es exento de IVA (va a ImpOpEx) */
  exento?: boolean;
}

export interface FacturarOpts {
  /** Punto de venta */
  ptoVta: number;
  /** Tipo de comprobante (usar enum CbteTipo) */
  cbteTipo: number;
  /** Items de la factura con importes netos */
  items: LineItem[];
  /** Concepto. Default: PRODUCTOS. Se auto-detecta SERVICIOS si se provee `servicio` */
  concepto?: number;
  /** Tipo de documento del receptor (usar enum DocTipo). Default: CONSUMIDOR_FINAL */
  docTipo?: number;
  /** Número de documento del receptor. Default: 0 */
  docNro?: number;
  /** Fecha del comprobante (Date o string YYYYMMDD). Default: hoy (timezone Argentina) */
  fecha?: Date | string;
  /** Para servicios: fechas de período y vencimiento de pago */
  servicio?: {
    desde: Date | string;
    hasta: Date | string;
    vtoPago: Date | string;
  };
  /** Código de moneda (usar enum Moneda). Default: PES */
  moneda?: string;
  /** Cotización de la moneda. Default: 1 */
  cotizacion?: number;
  /** Tributos adicionales */
  tributos?: Tributo[];
  /** Datos opcionales (ej: CBU para FCE) */
  opcionales?: Opcional[];
}

export interface ComprobanteRef {
  /** Tipo del comprobante original (usar enum CbteTipo) */
  tipo: number;
  /** Punto de venta del comprobante original */
  ptoVta: number;
  /** Número del comprobante original */
  nro: number;
  /** CUIT del emisor (requerido para FCE) */
  cuit?: number;
  /** Fecha del comprobante original (Date o string YYYYMMDD) */
  fecha?: Date | string;
}

export interface NotaCreditoOpts extends Omit<FacturarOpts, "cbteTipo"> {
  /** Comprobante original al que se asocia la nota de crédito.
   * El tipo de NC se infiere automáticamente del tipo del comprobante original. */
  comprobanteOriginal: ComprobanteRef;
}

export interface NotaDebitoOpts extends Omit<FacturarOpts, "cbteTipo"> {
  /** Comprobante original al que se asocia la nota de débito.
   * El tipo de ND se infiere automáticamente del tipo del comprobante original. */
  comprobanteOriginal: ComprobanteRef;
}

// ============================================================
// API Simplificada - Tipos de salida
// ============================================================

export interface Importes {
  total: number;
  neto: number;
  iva: number;
  exento: number;
  noGravado: number;
  tributos: number;
}

export interface FacturaResult {
  /** Si el comprobante fue aprobado por ARCA */
  aprobada: boolean;
  /** CAE otorgado (solo si aprobada) */
  cae?: string;
  /** Fecha de vencimiento del CAE en formato YYYYMMDD */
  caeVencimiento?: string;
  /** Número de comprobante asignado */
  cbteNro: number;
  /** Punto de venta */
  ptoVta: number;
  /** Tipo de comprobante */
  cbteTipo: number;
  /** Importes calculados y enviados */
  importes: Importes;
  /** Observaciones de ARCA (pueden existir incluso si fue aprobada) */
  observaciones: { code: number; msg: string }[];
  /** Resultado crudo de FECAESolicitar */
  raw: FECAESolicitarResult;
}
