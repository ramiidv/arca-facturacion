export { Arca } from "./arca.js";

// Funciones puras (sin red)
export {
  armarComprobante,
  calcularTotales,
  intentoDesdeComprobante,
  coincideConIntento,
  facturaResultDesdeConsulta,
  requiereRecuperacion,
  toDateString,
} from "./facturacion.js";
export { resolverCbteTipo } from "./cbte-tipo.js";
export type { ClaseComprobante } from "./cbte-tipo.js";

// Errors
export {
  ArcaError,
  ArcaAuthError,
  ArcaTicketVigenteError,
  ArcaWSFEError,
  ArcaSoapError,
  ArcaValidationError,
  ArcaResultadoIncierto,
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
  WsfeAuth,
  AlicuotaIva,
  Tributo,
  ComprobanteAsociado,
  Opcional,
  InvoiceDetail,
  InvoiceRequest,
  FeCabResp,
  FECAEDetResponse,
  FECAESolicitarResult,
  FECompUltimoAutorizadoResult,
  FECompConsultarResult,
  ServerStatus,
  ParamItem,
  MonedaItem,
  PtoVentaItem,
  CotizacionResult,
  WsError,
  QRInput,
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
  FacturarExpoOpts,
  ExpoLineItem,
  FacturaExpoResult,
  // CAEA
  CaeaSolicitarResult,
  CaeaRegInfRequest,
  CaeaRegInfResult,
  CaeaSinMovResult,
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
  WSFE_NUMERO_NO_CORRESPONDE,
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
export { WsfexClient } from "./wsfex.js";
/** @deprecated Usar `@ramiidv/arca-padron`. */
export { PadronClient } from "./padron.js";
