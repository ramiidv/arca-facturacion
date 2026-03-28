export { Arca } from "./arca.js";

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
} from "./constants.js";

// Low-level clients (for advanced usage)
export { WsaaClient } from "./wsaa.js";
export { WsfeClient } from "./wsfe.js";
