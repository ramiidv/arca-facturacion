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
  /** Cantidad de reintentos en caso de error transitorio (default: 1) */
  retries?: number;
  /** Delay inicial entre reintentos en milisegundos, se duplica con cada intento (default: 1000) */
  retryDelayMs?: number;
  /** Callback para eventos del SDK (auth, requests, retries). Para logging/debugging. */
  onEvent?: (event: ArcaEvent) => void;
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
  /** Condición de IVA del receptor (usar enum CondicionIva). OBLIGATORIO desde abril 2026. */
  CondicionIVAReceptorId?: number;
  /** Cancela en misma moneda extranjera: "S" o "N". Requerido para operaciones en moneda extranjera (RG5616). */
  CanMisMonExt?: string;
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
// Eventos / Logging
// ============================================================

export type ArcaEvent =
  | { type: "auth:login"; service: string; durationMs: number }
  | { type: "auth:cache-hit"; service: string }
  | { type: "request:start"; method: string; endpoint: string }
  | { type: "request:end"; method: string; durationMs: number }
  | { type: "request:retry"; method: string; attempt: number; delayMs: number; error: string }
  | { type: "request:error"; method: string; error: string };

// ============================================================
// QR
// ============================================================

export interface QRInput {
  /** Fecha del comprobante (YYYY-MM-DD) */
  fecha: string;
  /** CUIT del emisor */
  cuit: number;
  /** Punto de venta */
  ptoVta: number;
  /** Tipo de comprobante */
  tipoCmp: number;
  /** Número de comprobante */
  nroCmp: number;
  /** Importe total */
  importe: number;
  /** Código de moneda */
  moneda: string;
  /** Cotización */
  ctz: number;
  /** Tipo de documento del receptor */
  tipoDocRec: number;
  /** Número de documento del receptor */
  nroDocRec: number;
  /** Tipo de código de autorización: "E" = CAE, "A" = CAEA */
  tipoCodAut?: "E" | "A";
  /** Código de autorización (CAE) */
  codAut: number;
}

// ============================================================
// WSFEX - Factura de Exportación
// ============================================================

export interface WsfexItem {
  /** Código del producto */
  Pro_codigo: string;
  /** Descripción del producto */
  Pro_ds: string;
  /** Cantidad */
  Pro_qty: number;
  /** Unidad de medida (código AFIP) */
  Pro_umed: number;
  /** Precio unitario */
  Pro_precio_uni: number;
  /** Bonificación / descuento */
  Pro_bonificacion: number;
  /** Total del item */
  Pro_total_item: number;
}

export interface WsfexPermiso {
  /** Número de permiso de embarque */
  Id_permiso: string;
  /** País destino de la mercadería */
  Dst_merc: number;
}

export interface WsfexCmpAsoc {
  /** Tipo de comprobante asociado */
  Cbte_tipo: number;
  /** Punto de venta del comprobante asociado */
  Cbte_punto_vta: number;
  /** Número del comprobante asociado */
  Cbte_nro: number;
  /** CUIT del emisor del comprobante asociado */
  Cbte_cuit: number;
}

export interface WsfexInvoice {
  /** ID único del request (usar getLastId + 1) */
  Id: number;
  /** Tipo de comprobante (19=Factura E, 20=ND E, 21=NC E) */
  Cbte_Tipo: number;
  /** Fecha del comprobante (YYYYMMDD) */
  Fecha_cbte: string;
  /** Punto de venta */
  Punto_vta: number;
  /** Número de comprobante */
  Cbte_nro: number;
  /** Tipo de exportación: 1=Bienes, 2=Servicios, 4=Otros */
  Tipo_expo: number;
  /** Permiso de embarque existente: "S", "N", o "" */
  Permiso_existente: string;
  /** Código de país destino */
  Dst_cmp: number;
  /** Nombre del cliente */
  Cliente: string;
  /** CUIT del país del cliente */
  Cuit_pais_cliente: number;
  /** Domicilio del cliente */
  Domicilio_cliente: string;
  /** ID impositivo del cliente extranjero */
  Id_impositivo: string;
  /** Código de moneda */
  Moneda_Id: string;
  /** Cotización de la moneda */
  Moneda_ctz: number;
  /** Importe total del comprobante */
  Imp_total?: number;
  /** Observaciones comerciales */
  Obs_comerciales?: string;
  /** Observaciones */
  Obs?: string;
  /** Idioma: 1=Español, 2=Inglés, 3=Portugués */
  Idioma_cbte: number;
  /** Forma de pago */
  Forma_pago: string;
  /** Código Incoterms */
  Incoterms?: string;
  /** Descripción Incoterms */
  Incoterms_Ds?: string;
  /** Items del comprobante */
  Items: WsfexItem[];
  /** Permisos de embarque */
  Permisos?: WsfexPermiso[];
  /** Comprobantes asociados */
  Cmps_asoc?: WsfexCmpAsoc[];
}

export interface WsfexAuthResult {
  FEXResultAuth?: {
    Id: number;
    Cuit: number;
    Cbte_nro: number;
    Cbte_tipo: number;
    Punto_vta: number;
    Resultado: "A" | "R";
    Cae: string;
    Fch_cbte: string;
    Fch_venc_Cae: string;
    Reproceso: string;
    Obs?: string;
  };
  FEXErr?: { ErrCode: number; ErrMsg: string };
  FEXEvents?: { EventCode: number; EventMsg: string };
}

export interface WsfexLastCmpResult {
  FEXResult_LastCMP?: {
    Cbte_nro: number;
    Cbte_tipo: number;
    Punto_vta: number;
  };
  FEXErr?: { ErrCode: number; ErrMsg: string };
}

export interface WsfexLastIdResult {
  FEXResultGet?: { Id: number };
  FEXErr?: { ErrCode: number; ErrMsg: string };
}

export interface WsfexGetCmpResult {
  FEXResultGet?: {
    Id: number;
    Cbte_nro: number;
    Cbte_tipo: number;
    Punto_vta: number;
    Fecha_cbte: string;
    Tipo_expo: number;
    Dst_cmp: number;
    Cliente: string;
    Moneda_Id: string;
    Moneda_ctz: number;
    Resultado: "A" | "R";
    Cae: string;
    Fch_venc_Cae: string;
    Obs?: string;
  };
  FEXErr?: { ErrCode: number; ErrMsg: string };
}

export interface WsfexParamItem {
  Id: number | string;
  Ds: string;
}

// ============================================================
// CAEA - Autorización Anticipada
// ============================================================

export interface CaeaSolicitarResult {
  CAEA: string;
  Periodo: string;
  Orden: number;
  FchVigDesde: string;
  FchVigHasta: string;
  FchTopeInf: string;
  FchProceso: string;
  Errors?: { Err: WsError | WsError[] };
  Events?: { Evt: WsError | WsError[] };
}

export interface CaeaRegInfRequest {
  /** Punto de venta */
  PtoVta: number;
  /** Tipo de comprobante */
  CbteTipo: number;
  /** Detalle de comprobantes con CAEA */
  invoices: (InvoiceDetail & { CAEA: string })[];
}

export interface CaeaSinMovResult {
  CAEA: string;
  FchProceso: string;
  Resultado: "A" | "R";
  Errors?: { Err: WsError | WsError[] };
  Events?: { Evt: WsError | WsError[] };
}

// ============================================================
// Padrón - Consulta de contribuyentes
// ============================================================

export interface Contribuyente {
  /** CUIT del contribuyente */
  cuit: number;
  /** Nombre completo o razón social */
  nombre: string;
  /** Tipo de persona: "FISICA" o "JURIDICA" */
  tipoPersona: string;
  /** Estado de la clave: "ACTIVO", etc. */
  estadoClave: string;
  /** Domicilio fiscal (disponible con A5) */
  domicilioFiscal?: {
    direccion?: string;
    localidad?: string;
    codPostal?: string;
    tipoDomicilio?: string;
  };
  /** Impuestos/categorías del contribuyente */
  impuestos?: {
    id: number;
    descripcion: string;
    estado: string;
  }[];
  /** Respuesta cruda del WS */
  raw: Record<string, any>;
}

// ============================================================
// WSFEX - API Simplificada
// ============================================================

export interface ExpoLineItem {
  /** Código del producto */
  codigo: string;
  /** Descripción */
  descripcion: string;
  /** Cantidad */
  cantidad: number;
  /** Unidad de medida (código AFIP) */
  unidad: number;
  /** Precio unitario */
  precioUnitario: number;
  /** Bonificación / descuento. Default: 0 */
  bonificacion?: number;
}

export interface FacturarExpoOpts {
  /** Punto de venta */
  ptoVta: number;
  /** Tipo de comprobante (CbteTipo.FACTURA_E, NOTA_CREDITO_E, NOTA_DEBITO_E) */
  cbteTipo: number;
  /** Tipo de exportación: 1=Bienes, 2=Servicios, 4=Otros */
  tipoExpo: number;
  /** Código de país destino (usar getPaisesExpo()) */
  pais: number;
  /** Datos del cliente */
  cliente: {
    nombre: string;
    cuitPais: number;
    domicilio: string;
    idImpositivo: string;
  };
  /** Código de moneda */
  moneda: string;
  /** Cotización de la moneda */
  cotizacion: number;
  /** Items del comprobante */
  items: ExpoLineItem[];
  /** Forma de pago */
  formaPago: string;
  /** Idioma: 1=Español, 2=Inglés, 3=Portugués. Default: 1 */
  idioma?: number;
  /** Código Incoterms */
  incoterms?: string;
  /** Descripción Incoterms */
  incotermsDes?: string;
  /** Permiso de embarque existente: "S", "N". Default: "N" */
  permisoExistente?: string;
  /** Permisos de embarque */
  permisos?: WsfexPermiso[];
  /** Comprobantes asociados (para NC/ND de exportación) */
  cbtesAsoc?: WsfexCmpAsoc[];
  /** Observaciones comerciales */
  obsComerciales?: string;
  /** Observaciones */
  obs?: string;
  /** Fecha del comprobante (Date o string YYYYMMDD). Default: hoy */
  fecha?: Date | string;
}

export interface FacturaExpoResult {
  /** Si el comprobante fue aprobado */
  aprobada: boolean;
  /** CAE otorgado */
  cae?: string;
  /** Fecha de vencimiento del CAE */
  caeVencimiento?: string;
  /** Número de comprobante */
  cbteNro: number;
  /** Punto de venta */
  ptoVta: number;
  /** Tipo de comprobante */
  cbteTipo: number;
  /** Observaciones */
  obs?: string;
  /** Resultado crudo */
  raw: WsfexAuthResult;
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
  /** Condición de IVA del receptor (usar enum CondicionIva). Default: se infiere de docTipo si es posible. */
  condicionIva?: number;
  /** Cancela en misma moneda extranjera: "S" o "N". Requerido si moneda != PES. */
  canMisMonExt?: string;
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
