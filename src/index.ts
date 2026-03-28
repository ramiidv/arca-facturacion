export { Arca } from "./arca.js";

// Errors
export {
  ArcaError,
  ArcaAuthError,
  ArcaWSFEError,
  ArcaSoapError,
} from "./errors.js";

// Types
export type {
  ArcaConfig,
  AccessTicket,
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
  // Simplified API types
  LineItem,
  FacturarOpts,
  NotaCreditoOpts,
  NotaDebitoOpts,
  ComprobanteRef,
  FacturaResult,
  Importes,
} from "./types.js";

// Constants / Enums
export {
  ENDPOINTS,
  WSFE_NAMESPACE,
  CbteTipo,
  Concepto,
  DocTipo,
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
