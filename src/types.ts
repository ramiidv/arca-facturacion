// Re-export from common
export type { AccessTicket, ArcaEvent, TicketStorage, CallOptions, LegacyTlsMode } from '@ramiidv/arca-common';
import type { ArcaBaseConfig, WsaaClient } from '@ramiidv/arca-common';

// ============================================================
// Configuración
// ============================================================

/**
 * Configuración de `Arca`. Extiende `ArcaBaseConfig` de `@ramiidv/arca-common`
 * (cert, key, cuit, production, timeout, retries, retryDelayMs,
 * tokenTTLMinutes, onEvent, ticketStorage, clockOffsetMs, autoClockSkew,
 * loginErrorCooldownMs, fetch, legacyTls).
 *
 * - `retries`: reintentos en consultas ante errores transitorios (default: 1).
 *   Las emisiones (FECAESolicitar, FECAEARegInformativo,
 *   FECAEASinMovimientoInformar, FEXAuthorize) nunca se reintentan: ver
 *   `ArcaResultadoIncierto` y `ArcaResultadoInciertoExpo`.
 * - `legacyTls`: la producción de WSFEv1/WSFEX (`servicios1.afip.gov.ar`)
 *   negocia DH de 1024 bits, que Node >= 17 rechaza; con `auto` (default) el
 *   SDK reintenta ese handshake con el transporte TLS legacy de arca-common.
 */
export interface ArcaConfig extends ArcaBaseConfig {
  /**
   * CUIT del contribuyente (con o sin guiones). Se valida el dígito
   * verificador y se envía como número.
   */
  cuit: number | string;
  /** @deprecated Usar `timeout` (de `ArcaBaseConfig`). Si vienen ambos, gana `timeout`. */
  requestTimeoutMs?: number;
  /**
   * TTL del cache de parámetros (getTipos*, getMonedas, etc.) en milisegundos.
   * Default: 86400000 (24 horas). 0 para desactivar. Los puntos de venta y las
   * cotizaciones no se cachean.
   */
  paramCacheTTLMs?: number;
  /** Signal global: cancela todas las llamadas de esta instancia (ej: al apagar la app). */
  signal?: AbortSignal;
  /**
   * WsaaClient a usar en lugar de crear uno. Permite compartir los tickets con
   * otras instancias (ej: `ArcaPadron`) que usan el mismo certificado.
   * Si se provee, se ignoran `cert`, `key`, `tokenTTLMinutes`, `ticketStorage`,
   * `clockOffsetMs`, `autoClockSkew`, `loginErrorCooldownMs` y `endpoints.wsaa`.
   */
  wsaa?: WsaaClient;
  /** URLs propias de los servicios (ej: un proxy). Si no se indican, se usan las de ARCA según `production`. */
  endpoints?: {
    wsaa?: string;
    wsfe?: string;
    wsfex?: string;
    padronA5?: string;
    padronA13?: string;
  };
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
  /** Base imponible (>= 0, se redondea a 2 decimales) */
  BaseImp: number;
  /** Alícuota del tributo (>= 0) */
  Alic: number;
  /** Importe del tributo (>= 0, se redondea a 2 decimales) */
  Importe: number;
}

/** Comprador de un comprobante con receptores múltiples (estructura `Compradores` de WSFEv1). */
export interface Comprador {
  DocTipo: number;
  DocNro: number;
  /** Porcentaje de titularidad */
  Porcentaje: number;
}

/** Período asociado (`PeriodoAsoc`): NC/ND que refieren a un período en lugar de a comprobantes. */
export interface PeriodoAsociado {
  /** Fecha desde (YYYYMMDD) */
  FchDesde: string;
  /** Fecha hasta (YYYYMMDD) */
  FchHasta: string;
}

export interface ComprobanteAsociado {
  /** Tipo de comprobante asociado */
  Tipo: number;
  /** Punto de venta del comprobante asociado */
  PtoVta: number;
  /** Número de comprobante asociado */
  Nro: number;
  /** CUIT del emisor del comprobante asociado */
  Cuit?: string | number;
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
  /**
   * Cotización de la moneda: 1 para pesos. Obligatoria salvo moneda extranjera
   * con `CanMisMonExt = "S"` (validación 10038).
   */
  MonCotiz?: number;
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
  /**
   * Condición de IVA del receptor (usar enum CondicionIva). Obligatorio según RG 5616:
   * ARCA rechaza los comprobantes sin este dato desde el 01/12/2026 (manual WSFEv1 v4.8).
   */
  CondicionIVAReceptorId?: number;
  /**
   * Cancela en la misma moneda extranjera: "S" o "N" (opcional). Con `MonId`
   * = PES no debe informarse o debe ser "N" (validación 10241).
   */
  CanMisMonExt?: string;
  /** Compradores (receptores múltiples). */
  Compradores?: Comprador[];
  /** Período asociado (solo NC/ND, alternativa a `CbtesAsoc`). */
  PeriodoAsoc?: PeriodoAsociado;
  /** Actividades asociadas al comprobante (ver `getActividades`). */
  Actividades?: { Id: number }[];
  /**
   * Solo FECAEARegInformativo: fecha y hora de generación del comprobante
   * de contingencia, formato yyyymmddhhmmss (manual WSFEv1 v4.6, RG 5782).
   */
  CbteFchHsGen?: string;
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
  /** CAE otorgado (FECAESolicitar) */
  CAE?: string;
  CAEFchVto?: string;
  /** CAEA informado (FECAEARegInformativo) */
  CAEA?: string;
  Observaciones?: { Obs: WsError | WsError[] };
}

export interface WsError {
  Code: number;
  Msg: string;
}

/** Error, observación o evento de ARCA ya normalizado. */
export interface MensajeArca {
  code: number;
  msg: string;
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
    CondicionIVAReceptorId?: number;
    Iva?: { AlicIva: AlicuotaIva | AlicuotaIva[] };
    Tributos?: { Tributo: Tributo | Tributo[] };
    CbtesAsoc?: { CbteAsoc: ComprobanteAsociado | ComprobanteAsociado[] };
    Opcionales?: { Opcional: Opcional | Opcional[] };
    Observaciones?: { Obs: WsError | WsError[] };
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

/** Condición frente al IVA del receptor (`FEParamGetCondicionIvaReceptor`). */
export interface CondicionIvaItem {
  Id: number;
  Desc: string;
  /** Clases de comprobante para las que es válida (ej: "A/M/C") */
  Cmp_Clase?: string;
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

/** Cotización de `FEParamGetCotizacion` (`ResultGet`). */
export interface CotizacionResult {
  MonId: string;
  MonCotiz: number;
  /** Fecha de la cotización (YYYYMMDD) */
  FchCotiz: string;
}

/** Actividad del emisor (`FEParamGetActividades`). */
export interface ActividadItem {
  Id: number;
  Orden: number;
  Desc: string;
}

/** País (`FEParamGetTiposPaises`). */
export interface PaisItem {
  Id: number;
  Desc: string;
}

// ============================================================
// Eventos / Logging
// ============================================================
// QR
// ============================================================

export interface QRInput {
  /** Fecha del comprobante: `YYYY-MM-DD`, `YYYYMMDD` o `Date` (se envía como `YYYY-MM-DD`). */
  fecha: string | Date;
  /** CUIT del emisor */
  cuit: number | string;
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
  /** Tipo de documento del receptor (de corresponder) */
  tipoDocRec?: number;
  /** Número de documento del receptor (de corresponder) */
  nroDocRec?: number | string;
  /** Tipo de código de autorización: "E" = CAE, "A" = CAEA */
  tipoCodAut?: "E" | "A";
  /** Código de autorización (CAE o CAEA, 14 dígitos). El string que devuelve ARCA se convierte a número. */
  codAut: number | string;
}

/** Opciones de `generateQRUrl`. */
export interface QROptions {
  /** URL base del QR. Default: `QR_URL` (https://www.arca.gob.ar/fe/qr/). */
  baseUrl?: string;
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
  /**
   * ID único del request (usar getLastId + 1). Ante un corte, reenviar la
   * misma solicitud con el mismo Id: WSFEX responde `Reproceso = "S"` sin duplicar.
   */
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
  /**
   * Permiso de embarque existente: "S"/"N" solo para Factura E (19) de bienes
   * (Tipo_expo 1); vacío en los demás casos (validación 1720).
   */
  Permiso_existente?: string;
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
  Imp_total: number;
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
  /** Fecha de pago (YYYYMMDD). Solo Factura E (19); obligatoria para servicios/otros (1672, 1673). */
  Fecha_pago?: string;
  /** Cancela en misma moneda extranjera: "S" o "N" */
  CanMisMonExt?: string;
  /** Items del comprobante */
  Items: WsfexItem[];
  /** Permisos de embarque */
  Permisos?: WsfexPermiso[];
  /** Comprobantes asociados */
  Cmps_asoc?: WsfexCmpAsoc[];
  /** Datos opcionales */
  Opcionales?: Opcional[];
  /** Actividades (ver `getActividadesExpo`) */
  Actividades?: { Id: number }[];
}

export interface WsfexErr {
  ErrCode: number;
  ErrMsg: string;
}

export interface WsfexEvents {
  EventCode: number;
  EventMsg: string;
}

export interface WsfexAuthResult {
  FEXResultAuth?: {
    Id: number;
    Cuit: number;
    Cbte_tipo: number;
    Punto_vta: number;
    Cbte_nro: number;
    Cae?: string;
    Fch_venc_Cae?: string;
    Fch_cbte?: string;
    Resultado: "A" | "R";
    /** "S" si WSFEX encontró la misma solicitud (mismo Id) ya procesada. */
    Reproceso?: string;
    Motivos_Obs?: string;
  };
  FEXErr?: WsfexErr;
  FEXEvents?: WsfexEvents;
}

export interface WsfexLastCmpResult {
  FEXResult_LastCMP?: {
    Cbte_nro: number;
    Cbte_fecha?: string;
  };
  FEXErr?: WsfexErr;
  FEXEvents?: WsfexEvents;
}

export interface WsfexLastIdResult {
  FEXResultGet?: { Id: number };
  FEXErr?: WsfexErr;
  FEXEvents?: WsfexEvents;
}

/** Respuesta de `FEXGetCMP` (campos según el WSDL de WSFEX, `ClsFEXGetCMPR`). */
export interface WsfexGetCmpResult {
  FEXResultGet?: {
    Id: number;
    Fecha_cbte?: string;
    Cbte_tipo: number;
    Punto_vta: number;
    Cbte_nro: number;
    Tipo_expo: number;
    Permiso_existente?: string;
    Permisos?: { Permiso: WsfexPermiso | WsfexPermiso[] };
    Dst_cmp: number;
    Cliente?: string;
    Cuit_pais_cliente: number | string;
    Domicilio_cliente?: string;
    Id_impositivo?: string;
    Moneda_Id?: string;
    Moneda_ctz: number;
    CanMisMonExt?: string;
    Obs_comerciales?: string;
    Imp_total: number;
    Obs?: string;
    Cmps_asoc?: { Cmp_asoc: WsfexCmpAsoc | WsfexCmpAsoc[] };
    Forma_pago?: string;
    Incoterms?: string;
    Incoterms_Ds?: string;
    Idioma_cbte: number;
    Items?: { Item: WsfexItem | WsfexItem[] };
    /** Fecha de autorización del CAE */
    Fecha_cbte_cae?: string;
    Fch_venc_Cae?: string;
    Cae?: string;
    Resultado?: "A" | "R";
    Motivos_Obs?: string;
    Opcionales?: { Opcional: Opcional | Opcional[] };
    Fecha_pago?: string;
    Actividades?: { Actividad: { Id: number } | { Id: number }[] };
  };
  FEXErr?: WsfexErr;
  FEXEvents?: WsfexEvents;
}

/** Cotización de `FEXGetPARAM_Ctz`. */
export interface WsfexCotizacion {
  Mon_ctz: number;
  Mon_fecha?: string;
}

/** Punto de venta de exportación (`FEXGetPARAM_PtoVenta`). */
export interface WsfexPtoVenta {
  Pve_Nro: number;
  Pve_Bloqueado?: string;
  Pve_FchBaja?: string;
}

/**
 * Item de parámetro WSFEX. Los nombres de campo varían por tipo
 * (ej: Mon_Id, Cbte_Id, DST_Codigo, etc.). Usar Record para acceso genérico.
 */
export type WsfexParamItem = Record<string, string | number>;

// ============================================================
// CAEA - Autorización Anticipada
// ============================================================

/** `ResultGet` de FECAEASolicitar / FECAEAConsultar (`FECAEAGet`). */
export interface CaeaSolicitarResult {
  CAEA: string;
  /** Período YYYYMM */
  Periodo: string;
  /** Quincena: 1 o 2 */
  Orden: number;
  FchVigDesde: string;
  FchVigHasta: string;
  FchTopeInf: string;
  FchProceso: string;
  Observaciones?: { Obs: WsError | WsError[] };
  /** Eventos de ARCA de la respuesta (normalizados). */
  eventos?: MensajeArca[];
}

export interface CaeaRegInfResult {
  FeCabResp: FeCabResp;
  FeDetResp: { FECAEADetResponse: FECAEDetResponse | FECAEDetResponse[] };
  Errors?: { Err: WsError | WsError[] };
  Events?: { Evt: WsError | WsError[] };
}

export interface CaeaRegInfRequest {
  /** Punto de venta */
  PtoVta: number;
  /** Tipo de comprobante */
  CbteTipo: number;
  /**
   * Detalle de comprobantes con CAEA. `CbteFchHsGen` (yyyymmddhhmmss) es
   * obligatorio desde la RG 5782 (validación 1440).
   */
  invoices: (InvoiceDetail & { CAEA: string; CbteFchHsGen: string })[];
}

/** Respuesta de FECAEASinMovimientoInformar. */
export interface CaeaSinMovResult {
  CAEA?: string;
  FchProceso?: string;
  PtoVta?: number;
  Resultado: "A" | "R";
  Errors?: { Err: WsError | WsError[] };
  Events?: { Evt: WsError | WsError[] };
}

/** Un informe "sin movimiento" (`FECAEASinMovimientoConsultar`). */
export interface CaeaSinMovItem {
  CAEA: string;
  FchProceso: string;
  PtoVta: number;
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
  /**
   * Permiso de embarque existente: "S" o "N". Solo aplica a Factura E (19) de
   * bienes (tipoExpo 1), donde el default es "N"; en los demás casos se envía
   * vacío y no se admite (validación 1720).
   */
  permisoExistente?: "S" | "N";
  /** Permisos de embarque */
  permisos?: WsfexPermiso[];
  /** Comprobantes asociados (para NC/ND de exportación) */
  cbtesAsoc?: WsfexCmpAsoc[];
  /** Observaciones comerciales */
  obsComerciales?: string;
  /** Observaciones */
  obs?: string;
  /**
   * Fecha del comprobante (Date o string YYYYMMDD / YYYY-MM-DD). Default: hoy
   * (reloj de ARCA). Al reenviar un resultado incierto, usar la misma fecha
   * (`error.intento.fecha`).
   */
  fecha?: Date | string;
  /**
   * Fecha de pago (Date o string YYYYMMDD). Solo Factura E (19): obligatoria
   * para servicios y otros (si falta, se usa la fecha del comprobante); no se
   * admite en NC/ND (validación 1673).
   */
  fechaPago?: Date | string;
  /** Cancela en misma moneda extranjera: "S" o "N" */
  canMisMonExt?: string;
  /** Datos opcionales (ver `getOpcionalesExpo`) */
  opcionales?: Opcional[];
  /** Actividades (ver `getActividadesExpo`) */
  actividades?: number[];
  /**
   * `Id` del request. Default: último Id + 1. Indicarlo solo para reenviar un
   * resultado incierto (`ArcaResultadoInciertoExpo.intento`).
   */
  id?: number;
  /** Número de comprobante. Default: último autorizado + 1. */
  cbteNro?: number;
}

/** Datos para reenviar una factura de exportación con resultado incierto. */
export interface IntentoExpo {
  id: number;
  cbteNro: number;
  /** Fecha del comprobante enviada (YYYYMMDD) */
  fecha: string;
}

export interface FacturaExpoResult {
  /** Si el comprobante fue aprobado */
  aprobada: boolean;
  /** `Id` del request */
  id: number;
  /**
   * `true` si WSFEX ya tenía esta solicitud (mismo `Id`) y devolvió la
   * respuesta original (`Reproceso = "S"`): no se autorizó otro comprobante.
   */
  reproceso: boolean;
  /** Fecha del comprobante (YYYYMMDD) */
  fecha: string;
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
  /** Eventos de ARCA (`FEXEvents` con código distinto de 0) */
  eventos: MensajeArca[];
  /** Resultado crudo */
  raw: WsfexAuthResult;
}

// ============================================================
// API Simplificada - Tipos de entrada
// ============================================================

interface LineItemBase {
  /**
   * Tipo de alícuota IVA (usar enum IvaTipo).
   * Si no se especifica y exento=false, el item se trata como no gravado (ImpTotConc).
   */
  iva?: number;
  /** Si true, el importe es exento de IVA (va a ImpOpEx) */
  exento?: boolean;
}

/** Item con importe neto (sin IVA). El IVA se calcula sobre el neto. */
export interface LineItemNeto extends LineItemBase {
  /** Importe neto (sin IVA) */
  neto: number;
  total?: undefined;
}

/**
 * Item con precio final (IVA incluido), típico de un punto de venta.
 * El neto y el IVA se despejan del total. En exentos y no gravados, total = neto.
 */
export interface LineItemTotal extends LineItemBase {
  /** Precio final con IVA incluido */
  total: number;
  neto?: undefined;
}

/** Un item lleva `neto` (sin IVA) o `total` (IVA incluido), nunca ambos. */
export type LineItem = LineItemNeto | LineItemTotal;

export interface FacturarOpts {
  /** Punto de venta */
  ptoVta: number;
  /** Tipo de comprobante (usar enum CbteTipo) */
  cbteTipo: number;
  /**
   * Número de comprobante a emitir. Si se indica, no se consulta
   * `ultimoComprobante` y reintentar con el mismo número es seguro (ARCA
   * rechaza un número ya usado: nunca se duplica un comprobante).
   *
   * Sin `cbteNro`, el SDK usa último + 1 y no hay lock: el caller es
   * responsable de serializar las emisiones por (ptoVta, cbteTipo).
   */
  cbteNro?: number;
  /** Items de la factura: cada uno con `neto` (sin IVA) o `total` (IVA incluido) */
  items: LineItem[];
  /**
   * Descuento global, como monto final (IVA incluido). Se prorratea entre las
   * alícuotas, exento y no gravado en proporción a su total. No afecta tributos.
   */
  descuentoGlobal?: number;
  /**
   * Concepto. Default: PRODUCTOS, o SERVICIOS si se provee `servicio`.
   * Servicios (2) y Productos y Servicios (3) exigen `servicio`; Productos (1) no lo admite.
   */
  concepto?: number;
  /** Tipo de documento del receptor (usar enum DocTipo). Default: CONSUMIDOR_FINAL */
  docTipo?: number;
  /** Número de documento del receptor. Default: 0 */
  docNro?: number;
  /** Fecha del comprobante (Date o string YYYYMMDD / YYYY-MM-DD). Default: hoy (timezone Argentina) */
  fecha?: Date | string;
  /** Para servicios (concepto 2 o 3): fechas del período y vencimiento de pago */
  servicio?: {
    desde: Date | string;
    hasta: Date | string;
    vtoPago: Date | string;
  };
  /** Código de moneda (usar enum Moneda). Default: PES */
  moneda?: string;
  /**
   * Cotización de la moneda (> 0). Con PES debe ser 1 (default). Con moneda
   * extranjera es obligatoria salvo `canMisMonExt: "S"` (ARCA usa la oficial).
   */
  cotizacion?: number;
  /** Tributos adicionales (Importe y BaseImp >= 0, se redondean a 2 decimales) */
  tributos?: Tributo[];
  /** Datos opcionales (ej: CBU para FCE) */
  opcionales?: Opcional[];
  /**
   * Condición de IVA del receptor (usar enum CondicionIva). Obligatoria si el
   * receptor está identificado (docTipo distinto de 99): no se infiere del tipo
   * de documento porque un CUIT puede ser RI, monotributista o exento. Para
   * consumidor final sin identificar (docTipo 99) el default es CONSUMIDOR_FINAL (5).
   */
  condicionIva?: number;
  /**
   * Cancela en la misma moneda extranjera: "S" o "N" (opcional). "S" solo con
   * moneda extranjera (validación 10241).
   */
  canMisMonExt?: "S" | "N";
  /** Comprobantes asociados (para NC/ND, o para asociar otros comprobantes). */
  cbtesAsoc?: ComprobanteRef[];
  /**
   * Período asociado (`PeriodoAsoc`), solo para notas de crédito/débito (no
   * FCE): alternativa a asociar comprobantes (validaciones 10196-10198).
   */
  periodoAsoc?: { desde: Date | string; hasta: Date | string };
  /** Actividades del emisor asociadas al comprobante (ver `getActividades`). */
  actividades?: number[];
}

/** Opciones de `registrarFacturaCAEA`: las de `facturar` más la fecha y hora de generación. */
export interface FacturarCAEAOpts extends FacturarOpts {
  /**
   * Fecha y hora en que se generó el comprobante en contingencia
   * (`CbteFchHsGen`, obligatorio desde la RG 5782). `Date` (se toma la hora de
   * Argentina) o string `yyyymmddhhmmss`.
   */
  fechaHoraGeneracion: Date | string;
  /** Fecha del comprobante. Default: la fecha de `fechaHoraGeneracion`. */
  fecha?: Date | string;
}

export interface ComprobanteRef {
  /** Tipo del comprobante original (usar enum CbteTipo) */
  tipo: number;
  /** Punto de venta del comprobante original */
  ptoVta: number;
  /** Número del comprobante original */
  nro: number;
  /** CUIT del emisor (requerido para FCE). Se valida el dígito verificador. */
  cuit?: number | string;
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
  /** Descuento global aplicado (IVA incluido). No disponible en comprobantes recuperados. */
  descuento?: number;
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
  observaciones: MensajeArca[];
  /** Eventos de ARCA (`Events`): avisos generales, no afectan el resultado */
  eventos: MensajeArca[];
  /** Fecha del comprobante (YYYYMMDD) */
  fecha?: string;
  /** Tipo de documento del receptor */
  docTipo?: number;
  /** Número de documento del receptor */
  docNro?: number;
  /** Moneda del comprobante (si se conoce) */
  moneda?: string;
  /** Cotización enviada (si se conoce) */
  cotizacion?: number;
  /** "E" si se autorizó con CAE, "A" si se informó con CAEA (para el QR) */
  tipoCodAut?: "E" | "A";
  /** Resultado crudo: FECAESolicitar, o FECompConsultar si se obtuvo con `recuperarComprobante` */
  raw: FECAESolicitarResult | FECompConsultarResult;
}

/**
 * Datos de un intento de emisión: alcanzan para saber, después, si ARCA lo
 * autorizó (`recuperarComprobante`). Es JSON puro: se puede persistir antes de
 * enviar el comprobante.
 */
export interface IntentoComprobante {
  ptoVta: number;
  cbteTipo: number;
  cbteNro: number;
  importeTotal: number;
  docTipo: number;
  docNro: number;
  /** Fecha del comprobante (YYYYMMDD) */
  fecha: string;
}

export type ResultadoRecuperacion =
  /** ARCA autorizó el comprobante con los mismos datos del intento. */
  | { estado: "autorizado"; resultado: FacturaResult }
  /** ARCA no tiene ese número: reintentar con el mismo `cbteNro` es seguro. */
  | { estado: "no_emitido" }
  /** El número existe pero con otros datos (lo usó otra emisión). */
  | { estado: "conflicto"; encontrado: FECompConsultarResult };

export interface ComprobanteArmado {
  /** Detalle listo para enviar a FECAESolicitar */
  request: InvoiceDetail;
  /** Importes calculados */
  importes: Importes;
  /** Datos para recuperar el comprobante si el resultado es incierto. Persistilo antes de enviar. */
  intento: IntentoComprobante;
}
