export { Arca } from "./arca.js";

// Funciones puras (sin red)
export {
  armarComprobante,
  calcularTotales,
  intentoDesdeComprobante,
  coincideConIntento,
  facturaResultDesdeConsulta,
  requiereRecuperacion,
  formatFechaHora,
  toDateString,
} from "./facturacion.js";
export { generarUrlQR, urlQRDesdeFactura } from "./qr.js";
export type { DatosQR } from "./qr.js";
export { resolverCbteTipo } from "./cbte-tipo.js";
export type { ClaseComprobante } from "./cbte-tipo.js";

// Errors
export {
  ArcaError,
  ArcaAuthError,
  ArcaTicketVigenteError,
  ArcaWSFEError,
  ArcaSoapError,
  ArcaServiceError,
  ArcaValidationError,
  ArcaResultadoIncierto,
  ArcaResultadoInciertoExpo,
} from "./errors.js";
export type { OperacionEmision } from "./errors.js";

// Persistencia de tickets (desde arca-common)
export { MemoryTicketStorage, FileTicketStorage } from "@ramiidv/arca-common";

// Types
export type {
  ArcaConfig,
  ArcaEvent,
  AccessTicket,
  TicketStorage,
  CallOptions,
  LegacyTlsMode,
  WsfeAuth,
  AlicuotaIva,
  Tributo,
  ComprobanteAsociado,
  Opcional,
  Comprador,
  PeriodoAsociado,
  InvoiceDetail,
  InvoiceRequest,
  FeCabResp,
  FECAEDetResponse,
  FECAESolicitarResult,
  FECompUltimoAutorizadoResult,
  FECompConsultarResult,
  ServerStatus,
  ParamItem,
  CondicionIvaItem,
  MonedaItem,
  PtoVentaItem,
  CotizacionResult,
  ActividadItem,
  PaisItem,
  WsError,
  MensajeArca,
  QRInput,
  QROptions,
  // Simplified API
  LineItem,
  LineItemNeto,
  LineItemTotal,
  FacturarOpts,
  NotaCreditoOpts,
  NotaDebitoOpts,
  ComprobanteRef,
  FacturaResult,
  Importes,
  IntentoComprobante,
  ResultadoRecuperacion,
  ComprobanteArmado,
  FacturarCAEAOpts,
  // WSFEX
  WsfexInvoice,
  WsfexItem,
  WsfexPermiso,
  WsfexCmpAsoc,
  WsfexAuthResult,
  WsfexLastCmpResult,
  WsfexLastIdResult,
  WsfexGetCmpResult,
  WsfexParamItem,
  WsfexErr,
  WsfexEvents,
  WsfexCotizacion,
  WsfexPtoVenta,
  FacturarExpoOpts,
  ExpoLineItem,
  FacturaExpoResult,
  IntentoExpo,
  // CAEA
  CaeaSolicitarResult,
  CaeaRegInfRequest,
  CaeaRegInfResult,
  CaeaSinMovResult,
  CaeaSinMovItem,
  // Padrón
  Contribuyente,
} from "./types.js";

// Constants / Enums
export {
  ENDPOINTS,
  WSFE_NAMESPACE,
  WSFEX_NAMESPACE,
  WSAA_SERVICES,
  WSFE_ERRORES_INTERNOS,
  WSFEX_ERRORES_INTERNOS,
  WSFE_NUMERO_NO_CORRESPONDE,
  QR_URL,
  TipoExpo,
  CbteTipo,
  Concepto,
  DocTipo,
  CondicionIva,
  IvaTipo,
  IVA_RATES,
  Moneda,
  TributoTipo,
  NOTA_CREDITO_MAP,
  NOTA_DEBITO_MAP,
} from "./constants.js";

// Low-level clients (for advanced usage)
export { WsaaClient } from "./wsaa.js";
export { WsfeClient } from "./wsfe.js";
export type { WsClientOptions } from "./wsfe.js";
export { WsfexClient } from "./wsfex.js";
/** @deprecated Usar `@ramiidv/arca-padron`. */
export { PadronClient } from "./padron.js";
