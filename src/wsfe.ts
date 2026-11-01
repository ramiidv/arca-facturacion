import { afipSoapCall, ensureArray, extractServiceErrors } from "@ramiidv/arca-common";
import type { ArcaEvent, CallOptions, LegacyTlsMode, SoapOperationKind } from "@ramiidv/arca-common";
import { ENDPOINTS, WSFE_ERRORES_INTERNOS, WSFE_NAMESPACE } from "./constants.js";
import { ArcaResultadoIncierto, ArcaSoapError, ArcaWSFEError } from "./errors.js";
import type { OperacionEmision } from "./errors.js";
import { eventosWsfe, intentoDesdeComprobante } from "./facturacion.js";
import type {
  WsfeAuth,
  InvoiceRequest,
  InvoiceDetail,
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
  CaeaSolicitarResult,
  CaeaRegInfRequest,
  CaeaRegInfResult,
  CaeaSinMovResult,
  CaeaSinMovItem,
} from "./types.js";

type R = Record<string, any>;

/** Opciones de transporte de los clientes de bajo nivel (`WsfeClient`, `WsfexClient`). */
export interface WsClientOptions {
  /** Timeout en ms (default: 30000). */
  timeoutMs?: number;
  /** Reintentos en consultas (default: 1). Las emisiones nunca se reintentan. */
  retries?: number;
  /** Delay base del backoff en ms (default: 1000). */
  retryDelayMs?: number;
  onEvent?: (event: ArcaEvent) => void;
  /** `fetch` propio (proxy, mTLS, tests). */
  fetch?: typeof fetch;
  /** Transporte TLS legacy para hosts con DH de 1024 bits (default: `auto`). */
  legacyTls?: LegacyTlsMode;
  /** URL del servicio. Si no se indica, la de ARCA según `production`. */
  endpoint?: string;
}

/** Lanza `ArcaWSFEError` si la respuesta trae `Errors` (formato de WSFEv1). */
function checkErrors(result: R): void {
  const errors = extractServiceErrors(result);
  if (errors.length > 0) throw new ArcaWSFEError(errors.map((e) => ({ code: e.code, msg: e.msg })));
}

/** Falta un campo obligatorio en la respuesta de una consulta. */
function sinCampo(method: string, campo: string): ArcaSoapError {
  return new ArcaSoapError(`Respuesta de ${method} sin ${campo}`);
}

/** Cliente de bajo nivel de WSFEv1 (Factura electrónica, mercado interno). */
export class WsfeClient {
  private readonly endpoint: string;
  private readonly soapOpts: Omit<WsClientOptions, "endpoint" | "timeoutMs"> & { timeout?: number };

  constructor(production: boolean, opts: WsClientOptions = {}) {
    this.endpoint = opts.endpoint ?? (production ? ENDPOINTS.wsfe.production : ENDPOINTS.wsfe.testing);
    this.soapOpts = {
      timeout: opts.timeoutMs,
      retries: opts.retries,
      retryDelayMs: opts.retryDelayMs,
      onEvent: opts.onEvent,
      fetch: opts.fetch,
      legacyTls: opts.legacyTls,
    };
  }

  /**
   * WSFEv1 es un servicio ASMX con `elementFormDefault="qualified"`: el método
   * declara el namespace por defecto y los hijos lo heredan; el SOAPAction es
   * `namespace + método`.
   */
  private call(method: string, params: R, opts?: CallOptions & { kind?: SoapOperationKind }): Promise<R> {
    return afipSoapCall(this.endpoint, WSFE_NAMESPACE, method, params, {
      ...this.soapOpts,
      qualified: true,
      soapActionFromMethod: true,
      kind: opts?.kind,
      signal: opts?.signal,
    });
  }

  /** Consulta autenticada que lanza `ArcaWSFEError` si ARCA devuelve `Errors`. */
  private async consulta(method: string, auth: WsfeAuth, params: R, opts?: CallOptions): Promise<R> {
    const result = await this.call(method, { Auth: auth, ...params }, opts);
    checkErrors(result);
    return result;
  }

  /**
   * Llama a una operación de emisión: nunca se reintenta, y si no hay certeza
   * de que ARCA no la procesó, lanza ArcaResultadoIncierto.
   */
  private async emitir<T>(
    operacion: OperacionEmision,
    params: R,
    request: { PtoVta: number; CbteTipo: number; invoices: InvoiceDetail[] },
    detalleKey: "FECAEDetResponse" | "FECAEADetResponse",
    opts?: CallOptions
  ): Promise<T> {
    const incierto = (cause: unknown) =>
      new ArcaResultadoIncierto(
        operacion,
        request.invoices.map((inv) => intentoDesdeComprobante(request.PtoVta, request.CbteTipo, inv)),
        { cause }
      );

    let result: R;
    try {
      result = await this.call(operacion, params, { ...opts, kind: "emision" });
    } catch (err) {
      if (err instanceof ArcaSoapError && err.uncertain) throw incierto(err);
      throw err;
    }

    // Un error interno de ARCA no garantiza que no se haya procesado.
    const errores = extractServiceErrors(result);
    if (errores.some((e) => WSFE_ERRORES_INTERNOS.includes(e.code))) {
      throw incierto(new ArcaWSFEError(errores.map((e) => ({ code: e.code, msg: e.msg }))));
    }

    // Errores de negocio: ARCA rechazó el request, no se emitió nada.
    checkErrors(result);

    const detResp = result.FeDetResp as R | undefined;
    if (!detResp || detResp[detalleKey] === undefined || !result.FeCabResp) {
      throw incierto(new ArcaSoapError(`Respuesta de ${operacion} sin FeCabResp/FeDetResp`));
    }
    return result as T;
  }

  // ============================================================
  // Facturación
  // ============================================================

  /**
   * Solicita CAE (emisión). No se reintenta: ante un resultado incierto lanza
   * ArcaResultadoIncierto; ante errores de ARCA, ArcaWSFEError.
   */
  async solicitarCAE(auth: WsfeAuth, request: InvoiceRequest, opts?: CallOptions): Promise<FECAESolicitarResult> {
    return this.emitir<FECAESolicitarResult>(
      "FECAESolicitar",
      {
        Auth: auth,
        FeCAEReq: {
          FeCabReq: { CantReg: request.invoices.length, PtoVta: request.PtoVta, CbteTipo: request.CbteTipo },
          FeDetReq: { FECAEDetRequest: request.invoices.map(buildDetRequest) },
        },
      },
      request,
      "FECAEDetResponse",
      opts
    );
  }

  async ultimoComprobante(auth: WsfeAuth, ptoVta: number, cbteTipo: number, opts?: CallOptions): Promise<number> {
    const result = (await this.consulta(
      "FECompUltimoAutorizado",
      auth,
      { PtoVta: ptoVta, CbteTipo: cbteTipo },
      opts
    )) as FECompUltimoAutorizadoResult;
    if (result.CbteNro === undefined || result.CbteNro === null || Number.isNaN(Number(result.CbteNro))) {
      throw sinCampo("FECompUltimoAutorizado", "CbteNro");
    }
    return Number(result.CbteNro);
  }

  async consultarComprobante(
    auth: WsfeAuth,
    cbteTipo: number,
    ptoVta: number,
    cbteNro: number,
    opts?: CallOptions
  ): Promise<FECompConsultarResult> {
    const result = (await this.consulta(
      "FECompConsultar",
      auth,
      { FeCompConsReq: { CbteTipo: cbteTipo, CbteNro: cbteNro, PtoVta: ptoVta } },
      opts
    )) as FECompConsultarResult;
    if (!result.ResultGet) throw sinCampo("FECompConsultar", "ResultGet");
    return result;
  }

  // ============================================================
  // Parámetros
  // ============================================================

  async serverStatus(opts?: CallOptions): Promise<ServerStatus> {
    return (await this.call("FEDummy", {}, opts)) as ServerStatus;
  }

  private async getParam<T>(auth: WsfeAuth, method: string, itemKey: string, opts?: CallOptions): Promise<T[]> {
    const result = await this.consulta(method, auth, {}, opts);
    return ensureArray(result.ResultGet?.[itemKey] as T | T[] | undefined);
  }

  async getTiposComprobante(auth: WsfeAuth, opts?: CallOptions): Promise<ParamItem[]> {
    return this.getParam(auth, "FEParamGetTiposCbte", "CbteTipo", opts);
  }

  async getTiposConcepto(auth: WsfeAuth, opts?: CallOptions): Promise<ParamItem[]> {
    return this.getParam(auth, "FEParamGetTiposConcepto", "ConceptoTipo", opts);
  }

  async getTiposDocumento(auth: WsfeAuth, opts?: CallOptions): Promise<ParamItem[]> {
    return this.getParam(auth, "FEParamGetTiposDoc", "DocTipo", opts);
  }

  /**
   * Condiciones frente al IVA del receptor (`FEParamGetCondicionIvaReceptor`).
   * @param claseCmp - Clase de comprobante para filtrar (ej: "A", "B", "C"). Opcional.
   */
  async getCondicionesIva(auth: WsfeAuth, opts?: CallOptions, claseCmp?: string): Promise<CondicionIvaItem[]> {
    const result = await this.consulta(
      "FEParamGetCondicionIvaReceptor",
      auth,
      claseCmp !== undefined ? { ClaseCmp: claseCmp } : {},
      opts
    );
    return ensureArray(result.ResultGet?.CondicionIvaReceptor as CondicionIvaItem | CondicionIvaItem[] | undefined);
  }

  async getTiposIva(auth: WsfeAuth, opts?: CallOptions): Promise<ParamItem[]> {
    return this.getParam(auth, "FEParamGetTiposIva", "IvaTipo", opts);
  }

  async getMonedas(auth: WsfeAuth, opts?: CallOptions): Promise<MonedaItem[]> {
    const items = await this.getParam<MonedaItem>(auth, "FEParamGetTiposMonedas", "Moneda", opts);
    // Id es xs:string: códigos como "060" no deben quedar como número.
    return items.map((m) => ({ ...m, Id: String(m.Id) }));
  }

  async getTiposTributo(auth: WsfeAuth, opts?: CallOptions): Promise<ParamItem[]> {
    return this.getParam(auth, "FEParamGetTiposTributos", "TributoTipo", opts);
  }

  async getTiposOpcional(auth: WsfeAuth, opts?: CallOptions): Promise<ParamItem[]> {
    return this.getParam(auth, "FEParamGetTiposOpcional", "OpcionalTipo", opts);
  }

  async getPuntosVenta(auth: WsfeAuth, opts?: CallOptions): Promise<PtoVentaItem[]> {
    return this.getParam(auth, "FEParamGetPtosVenta", "PtoVenta", opts);
  }

  /** Actividades del emisor (`FEParamGetActividades`). */
  async getActividades(auth: WsfeAuth, opts?: CallOptions): Promise<ActividadItem[]> {
    return this.getParam(auth, "FEParamGetActividades", "ActividadesTipo", opts);
  }

  /** Países (`FEParamGetTiposPaises`). */
  async getTiposPaises(auth: WsfeAuth, opts?: CallOptions): Promise<PaisItem[]> {
    return this.getParam(auth, "FEParamGetTiposPaises", "PaisTipo", opts);
  }

  /**
   * Cotización de una moneda (`FEParamGetCotizacion`).
   * `opts.fchCotiz`: fecha de la cotización (YYYYMMDD). Opcional: sin fecha, ARCA devuelve la vigente.
   */
  async getCotizacion(
    auth: WsfeAuth,
    monedaId: string,
    opts?: CallOptions & { fchCotiz?: string }
  ): Promise<CotizacionResult> {
    const params: R = { MonId: monedaId };
    if (opts?.fchCotiz !== undefined) params.FchCotiz = opts.fchCotiz;
    const result = await this.consulta("FEParamGetCotizacion", auth, params, opts);
    const r = result.ResultGet as R | undefined;
    if (!r) throw sinCampo("FEParamGetCotizacion", "ResultGet");
    const cotiz = Number(r.MonCotiz);
    if (r.MonCotiz === undefined || r.MonCotiz === null || !Number.isFinite(cotiz)) {
      throw sinCampo("FEParamGetCotizacion", "MonCotiz");
    }
    return {
      MonId: String(r.MonId ?? monedaId),
      MonCotiz: cotiz,
      FchCotiz: r.FchCotiz === undefined || r.FchCotiz === null ? "" : String(r.FchCotiz),
    };
  }

  async getCantMaxRegistros(auth: WsfeAuth, opts?: CallOptions): Promise<number> {
    const result = await this.consulta("FECompTotXRequest", auth, {}, opts);
    if (result.RegXReq === undefined || result.RegXReq === null) throw sinCampo("FECompTotXRequest", "RegXReq");
    return Number(result.RegXReq);
  }

  // ============================================================
  // CAEA - Autorización Anticipada
  // ============================================================

  private async caeaGet(method: string, auth: WsfeAuth, periodo: string, orden: number, opts?: CallOptions) {
    const result = await this.consulta(method, auth, { Periodo: periodo, Orden: orden }, opts);
    const r = result.ResultGet as R | undefined;
    if (!r || r.CAEA === undefined || r.CAEA === null || r.CAEA === "") throw sinCampo(method, "ResultGet.CAEA");
    const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
    const caea: CaeaSolicitarResult = {
      ...r,
      CAEA: String(r.CAEA),
      Periodo: String(r.Periodo),
      Orden: Number(r.Orden),
      FchVigDesde: str(r.FchVigDesde),
      FchVigHasta: str(r.FchVigHasta),
      FchTopeInf: str(r.FchTopeInf),
      FchProceso: str(r.FchProceso),
      eventos: eventosWsfe(result),
    };
    return caea;
  }

  /** Solicita un CAEA (`FECAEASolicitar`). Si ya existe para el período, ARCA devuelve error (usar `consultarCAEA`). */
  async solicitarCAEA(auth: WsfeAuth, periodo: string, orden: number, opts?: CallOptions): Promise<CaeaSolicitarResult> {
    return this.caeaGet("FECAEASolicitar", auth, periodo, orden, opts);
  }

  async consultarCAEA(auth: WsfeAuth, periodo: string, orden: number, opts?: CallOptions): Promise<CaeaSolicitarResult> {
    return this.caeaGet("FECAEAConsultar", auth, periodo, orden, opts);
  }

  /**
   * Informa comprobantes emitidos con CAEA (emisión). No se reintenta: ante un
   * resultado incierto lanza ArcaResultadoIncierto.
   */
  async registrarCAEA(auth: WsfeAuth, request: CaeaRegInfRequest, opts?: CallOptions): Promise<CaeaRegInfResult> {
    // FECAEADetRequest extiende FEDetRequest: CAEA y CbteFchHsGen van al final.
    const detRequests = request.invoices.map((inv) => {
      const det = buildDetRequest(inv);
      det.CAEA = inv.CAEA;
      det.CbteFchHsGen = inv.CbteFchHsGen;
      return det;
    });

    return this.emitir<CaeaRegInfResult>(
      "FECAEARegInformativo",
      {
        Auth: auth,
        FeCAEARegInfReq: {
          FeCabReq: { CantReg: request.invoices.length, PtoVta: request.PtoVta, CbteTipo: request.CbteTipo },
          FeDetReq: { FECAEADetRequest: detRequests },
        },
      },
      request,
      "FECAEADetResponse",
      opts
    );
  }

  /**
   * Informa que un punto de venta no tuvo movimientos con un CAEA (emisión, no
   * se reintenta). Un `ArcaSoapError` con `uncertain: true` significa que no se
   * sabe si quedó informado: verificarlo con `consultarSinMovimientoCAEA`.
   */
  async sinMovimientoCAEA(auth: WsfeAuth, caea: string, ptoVta: number, opts?: CallOptions): Promise<CaeaSinMovResult> {
    // Orden del WSDL: Auth, PtoVta, CAEA.
    const result = (await this.call(
      "FECAEASinMovimientoInformar",
      { Auth: auth, PtoVta: ptoVta, CAEA: caea },
      { ...opts, kind: "emision" }
    )) as CaeaSinMovResult & R;
    checkErrors(result);
    if (result.Resultado !== "A" && result.Resultado !== "R") {
      throw new ArcaSoapError("Respuesta de FECAEASinMovimientoInformar sin Resultado", { uncertain: true });
    }
    return { ...result, ...(result.CAEA !== undefined && { CAEA: String(result.CAEA) }) };
  }

  /**
   * Consulta los informes "sin movimiento" de un CAEA
   * (`FECAEASinMovimientoConsultar`). Devuelve `[]` si no hay ninguno.
   * @param caea - CAEA a consultar.
   * @param ptoVta - Punto de venta vinculado al CAEA.
   */
  async consultarSinMovimientoCAEA(
    auth: WsfeAuth,
    caea: string,
    ptoVta: number,
    opts?: CallOptions
  ): Promise<CaeaSinMovItem[]> {
    // Orden del WSDL: Auth, CAEA, PtoVta.
    const result = await this.consulta("FECAEASinMovimientoConsultar", auth, { CAEA: caea, PtoVta: ptoVta }, opts);
    return ensureArray(result.ResultGet?.FECAEASinMov as R | R[] | undefined).map((i) => ({
      CAEA: String(i.CAEA),
      FchProceso: String(i.FchProceso ?? ""),
      PtoVta: Number(i.PtoVta),
    }));
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Arma un `FEDetRequest` en el orden de la secuencia del WSDL de WSFEv1
 * (Concepto … ImpIVA, FchServ*, MonId, MonCotiz, CanMisMonExt,
 * CondicionIVAReceptorId, CbtesAsoc, Tributos, Iva, Opcionales, Compradores,
 * PeriodoAsoc, Actividades). Los opcionales ausentes no se envían.
 */
export function buildDetRequest(inv: InvoiceDetail): R {
  const det: R = {
    Concepto: inv.Concepto,
    DocTipo: inv.DocTipo,
    DocNro: inv.DocNro,
    CbteDesde: inv.CbteDesde,
    CbteHasta: inv.CbteHasta,
    CbteFch: inv.CbteFch,
    ImpTotal: inv.ImpTotal,
    ImpTotConc: inv.ImpTotConc,
    ImpNeto: inv.ImpNeto,
    ImpOpEx: inv.ImpOpEx,
    ImpTrib: inv.ImpTrib,
    ImpIVA: inv.ImpIVA,
  };

  if (inv.FchServDesde) det.FchServDesde = inv.FchServDesde;
  if (inv.FchServHasta) det.FchServHasta = inv.FchServHasta;
  if (inv.FchVtoPago) det.FchVtoPago = inv.FchVtoPago;
  det.MonId = inv.MonId;
  if (inv.MonCotiz !== undefined && inv.MonCotiz !== null) det.MonCotiz = inv.MonCotiz;
  if (inv.CanMisMonExt) det.CanMisMonExt = inv.CanMisMonExt;
  if (inv.CondicionIVAReceptorId != null) det.CondicionIVAReceptorId = inv.CondicionIVAReceptorId;

  if (inv.CbtesAsoc && inv.CbtesAsoc.length > 0) {
    det.CbtesAsoc = {
      CbteAsoc: inv.CbtesAsoc.map((c) => {
        const asoc: R = { Tipo: c.Tipo, PtoVta: c.PtoVta, Nro: c.Nro };
        if (c.Cuit !== undefined && c.Cuit !== null && c.Cuit !== "") asoc.Cuit = String(c.Cuit);
        if (c.CbteFch) asoc.CbteFch = c.CbteFch;
        return asoc;
      }),
    };
  }

  if (inv.Tributos && inv.Tributos.length > 0) {
    det.Tributos = {
      Tributo: inv.Tributos.map((t) => {
        const trib: R = { Id: t.Id };
        if (t.Desc !== undefined && t.Desc !== "") trib.Desc = t.Desc;
        trib.BaseImp = t.BaseImp;
        trib.Alic = t.Alic;
        trib.Importe = t.Importe;
        return trib;
      }),
    };
  }

  if (inv.Iva && inv.Iva.length > 0) {
    det.Iva = { AlicIva: inv.Iva.map((i) => ({ Id: i.Id, BaseImp: i.BaseImp, Importe: i.Importe })) };
  }

  if (inv.Opcionales && inv.Opcionales.length > 0) {
    det.Opcionales = { Opcional: inv.Opcionales.map((o) => ({ Id: o.Id, Valor: o.Valor })) };
  }

  if (inv.Compradores && inv.Compradores.length > 0) {
    det.Compradores = {
      Comprador: inv.Compradores.map((c) => ({ DocTipo: c.DocTipo, DocNro: c.DocNro, Porcentaje: c.Porcentaje })),
    };
  }

  if (inv.PeriodoAsoc) {
    det.PeriodoAsoc = { FchDesde: inv.PeriodoAsoc.FchDesde, FchHasta: inv.PeriodoAsoc.FchHasta };
  }

  if (inv.Actividades && inv.Actividades.length > 0) {
    det.Actividades = { Actividad: inv.Actividades.map((a) => ({ Id: a.Id })) };
  }

  return det;
}
