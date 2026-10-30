import { ENDPOINTS, WSFE_ERRORES_INTERNOS, WSFE_NAMESPACE } from "./constants.js";
import { afipSoapCall, toArray } from "./soap-client.js";
import type { SoapOptions } from "./soap-client.js";
import { ArcaResultadoIncierto, ArcaSoapError, ArcaWSFEError } from "./errors.js";
import type { OperacionEmision } from "./errors.js";
import { intentoDesdeComprobante } from "./facturacion.js";
import type { CallOptions, SoapOperationKind } from "@ramiidv/arca-common";
import type {
  WsfeAuth,
  InvoiceRequest,
  InvoiceDetail,
  FECAESolicitarResult,
  FECompUltimoAutorizadoResult,
  FECompConsultarResult,
  ServerStatus,
  ParamItem,
  MonedaItem,
  PtoVentaItem,
  CotizacionResult,
  WsError,
  ArcaEvent,
  CaeaSolicitarResult,
  CaeaRegInfRequest,
  CaeaRegInfResult,
  CaeaSinMovResult,
} from "./types.js";

interface WsfeResult {
  Errors?: { Err: WsError | WsError[] };
  ResultGet?: Record<string, unknown>;
}

function checkErrors(result: WsfeResult): void {
  if (result.Errors) {
    const errs = toArray(result.Errors.Err);
    throw new ArcaWSFEError(errs.map((e) => ({ code: e.Code, msg: e.Msg })));
  }
}

export class WsfeClient {
  private endpoint: string;
  private soapOpts: Omit<SoapOptions, "soapAction">;

  constructor(
    production: boolean,
    opts: {
      timeoutMs?: number;
      retries?: number;
      retryDelayMs?: number;
      onEvent?: (event: ArcaEvent) => void;
    } = {}
  ) {
    this.endpoint = production
      ? ENDPOINTS.wsfe.production
      : ENDPOINTS.wsfe.testing;
    this.soapOpts = {
      timeoutMs: opts.timeoutMs,
      retries: opts.retries,
      retryDelayMs: opts.retryDelayMs,
      onEvent: opts.onEvent,
    };
  }

  private call(
    method: string,
    params: Record<string, any>,
    opts?: CallOptions & { kind?: SoapOperationKind }
  ) {
    return afipSoapCall(this.endpoint, WSFE_NAMESPACE, method, params, {
      ...this.soapOpts,
      kind: opts?.kind,
      signal: opts?.signal,
    });
  }

  /**
   * Llama a una operación de emisión: nunca se reintenta, y si no hay certeza
   * de que ARCA no la procesó, lanza ArcaResultadoIncierto.
   */
  private async emitir<T extends { Errors?: WsfeResult["Errors"] }>(
    operacion: OperacionEmision,
    params: Record<string, any>,
    request: { PtoVta: number; CbteTipo: number; invoices: InvoiceDetail[] },
    detalleKey: "FECAEDetResponse" | "FECAEADetResponse",
    opts?: CallOptions
  ): Promise<T> {
    const incierto = (cause: unknown) =>
      new ArcaResultadoIncierto(
        operacion,
        request.invoices.map((inv) =>
          intentoDesdeComprobante(request.PtoVta, request.CbteTipo, inv)
        ),
        { cause }
      );

    let result: T;
    try {
      result = (await this.call(operacion, params, { ...opts, kind: "emision" })) as T;
    } catch (err) {
      if (err instanceof ArcaSoapError && err.uncertain) throw incierto(err);
      throw err;
    }

    // Un error interno de ARCA no garantiza que no se haya procesado.
    const errores = toArray(result.Errors?.Err);
    if (errores.some((e) => WSFE_ERRORES_INTERNOS.includes(Number(e.Code)))) {
      throw incierto(new ArcaWSFEError(errores.map((e) => ({ code: Number(e.Code), msg: String(e.Msg) }))));
    }

    // Errores de negocio: ARCA rechazó el request, no se emitió nada.
    checkErrors(result);

    const detResp = (result as { FeDetResp?: Record<string, unknown> }).FeDetResp;
    if (!detResp || detResp[detalleKey] === undefined) {
      throw incierto(new ArcaSoapError(`Respuesta de ${operacion} sin FeDetResp`));
    }
    return result;
  }

  // ============================================================
  // Facturación
  // ============================================================

  /**
   * Solicita CAE (emisión). No se reintenta: ante un resultado incierto lanza
   * ArcaResultadoIncierto; ante errores de ARCA, ArcaWSFEError.
   */
  async solicitarCAE(
    auth: WsfeAuth,
    request: InvoiceRequest,
    opts?: CallOptions
  ): Promise<FECAESolicitarResult> {
    const detRequests = request.invoices.map((inv) =>
      this.buildDetRequest(inv)
    );

    return this.emitir<FECAESolicitarResult>(
      "FECAESolicitar",
      {
        Auth: auth,
        FeCAEReq: {
          FeCabReq: {
            CantReg: request.invoices.length,
            PtoVta: request.PtoVta,
            CbteTipo: request.CbteTipo,
          },
          FeDetReq: { FECAEDetRequest: detRequests },
        },
      },
      request,
      "FECAEDetResponse",
      opts
    );
  }

  async ultimoComprobante(
    auth: WsfeAuth,
    ptoVta: number,
    cbteTipo: number,
    opts?: CallOptions
  ): Promise<number> {
    const result = (await this.call("FECompUltimoAutorizado", {
      Auth: auth,
      PtoVta: ptoVta,
      CbteTipo: cbteTipo,
    }, opts)) as FECompUltimoAutorizadoResult;
    checkErrors(result);
    return Number(result.CbteNro);
  }

  async consultarComprobante(
    auth: WsfeAuth,
    cbteTipo: number,
    ptoVta: number,
    cbteNro: number,
    opts?: CallOptions
  ): Promise<FECompConsultarResult> {
    const result = (await this.call("FECompConsultar", {
      Auth: auth,
      FeCompConsReq: { CbteTipo: cbteTipo, CbteNro: cbteNro, PtoVta: ptoVta },
    }, opts)) as FECompConsultarResult;
    checkErrors(result);
    return result;
  }

  // ============================================================
  // Parámetros
  // ============================================================

  async serverStatus(opts?: CallOptions): Promise<ServerStatus> {
    return (await this.call("FEDummy", {}, opts)) as ServerStatus;
  }

  private async getParam<T>(
    auth: WsfeAuth,
    method: string,
    itemKey: string,
    opts?: CallOptions
  ): Promise<T[]> {
    const result = (await this.call(method, { Auth: auth }, opts)) as WsfeResult;
    checkErrors(result);
    return toArray(result.ResultGet?.[itemKey] as T | T[] | undefined);
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

  async getCondicionesIva(auth: WsfeAuth, opts?: CallOptions): Promise<ParamItem[]> {
    return this.getParam(auth, "FEParamGetCondicionIvaReceptor", "CondicionIVAReceptor", opts);
  }

  async getTiposIva(auth: WsfeAuth, opts?: CallOptions): Promise<ParamItem[]> {
    return this.getParam(auth, "FEParamGetTiposIva", "IvaTipo", opts);
  }

  async getMonedas(auth: WsfeAuth, opts?: CallOptions): Promise<MonedaItem[]> {
    return this.getParam(auth, "FEParamGetTiposMonedas", "Moneda", opts);
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

  async getCotizacion(
    auth: WsfeAuth,
    monedaId: string,
    opts?: CallOptions
  ): Promise<CotizacionResult> {
    const result = (await this.call("FEParamGetCotizacion", {
      Auth: auth,
      MonId: monedaId,
    }, opts)) as WsfeResult & CotizacionResult;
    checkErrors(result);
    return result;
  }

  async getCantMaxRegistros(auth: WsfeAuth, opts?: CallOptions): Promise<number> {
    const result = (await this.call("FECompTotXRequest", {
      Auth: auth,
    }, opts)) as WsfeResult & { RegXReq?: number };
    checkErrors(result);
    return Number(result.RegXReq ?? 0);
  }

  // ============================================================
  // CAEA - Autorización Anticipada
  // ============================================================

  async solicitarCAEA(
    auth: WsfeAuth,
    periodo: string,
    orden: number,
    opts?: CallOptions
  ): Promise<CaeaSolicitarResult> {
    const result = (await this.call("FECAEASolicitar", {
      Auth: auth,
      Periodo: periodo,
      Orden: orden,
    }, opts)) as WsfeResult & { ResultGet?: CaeaSolicitarResult };
    checkErrors(result);
    return result.ResultGet!;
  }

  async consultarCAEA(
    auth: WsfeAuth,
    periodo: string,
    orden: number,
    opts?: CallOptions
  ): Promise<CaeaSolicitarResult> {
    const result = (await this.call("FECAEAConsultar", {
      Auth: auth,
      Periodo: periodo,
      Orden: orden,
    }, opts)) as WsfeResult & { ResultGet?: CaeaSolicitarResult };
    checkErrors(result);
    return result.ResultGet!;
  }

  /**
   * Informa comprobantes emitidos con CAEA (emisión). No se reintenta: ante un
   * resultado incierto lanza ArcaResultadoIncierto.
   */
  async registrarCAEA(
    auth: WsfeAuth,
    request: CaeaRegInfRequest,
    opts?: CallOptions
  ): Promise<CaeaRegInfResult> {
    const detRequests = request.invoices.map((inv) => {
      const det = this.buildDetRequest(inv);
      det.CAEA = inv.CAEA;
      return det;
    });

    return this.emitir<CaeaRegInfResult>(
      "FECAEARegInformativo",
      {
        Auth: auth,
        FeCAEARegInfReq: {
          FeCabReq: {
            CantReg: request.invoices.length,
            PtoVta: request.PtoVta,
            CbteTipo: request.CbteTipo,
          },
          FeDetReq: { FECAEADetRequest: detRequests },
        },
      },
      request,
      "FECAEADetResponse",
      opts
    );
  }

  async sinMovimientoCAEA(
    auth: WsfeAuth,
    caea: string,
    ptoVta: number,
    opts?: CallOptions
  ): Promise<CaeaSinMovResult> {
    // Emisión: no se reintenta. Un error de transporte con `uncertain: true`
    // significa que no se sabe si quedó informado (consultarlo con FECAEASinMovimientoConsultar).
    const result = (await this.call("FECAEASinMovimientoInformar", {
      Auth: auth,
      CAEA: caea,
      PtoVta: ptoVta,
    }, { ...opts, kind: "emision" })) as CaeaSinMovResult;
    checkErrors(result);
    return result;
  }

  // ============================================================
  // Helpers
  // ============================================================

  private buildDetRequest(inv: InvoiceDetail): Record<string, any> {
    const det: Record<string, any> = {
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
      MonId: inv.MonId,
      MonCotiz: inv.MonCotiz,
    };

    if (inv.CondicionIVAReceptorId != null)
      det.CondicionIVAReceptorId = inv.CondicionIVAReceptorId;
    if (inv.CanMisMonExt) det.CanMisMonExt = inv.CanMisMonExt;

    if (inv.FchServDesde) det.FchServDesde = inv.FchServDesde;
    if (inv.FchServHasta) det.FchServHasta = inv.FchServHasta;
    if (inv.FchVtoPago) det.FchVtoPago = inv.FchVtoPago;

    if (inv.Iva && inv.Iva.length > 0) {
      det.Iva = {
        AlicIva: inv.Iva.map((i) => ({
          Id: i.Id,
          BaseImp: i.BaseImp,
          Importe: i.Importe,
        })),
      };
    }

    if (inv.Tributos && inv.Tributos.length > 0) {
      det.Tributos = {
        Tributo: inv.Tributos.map((t) => ({
          Id: t.Id,
          Desc: t.Desc,
          BaseImp: t.BaseImp,
          Alic: t.Alic,
          Importe: t.Importe,
        })),
      };
    }

    if (inv.CbtesAsoc && inv.CbtesAsoc.length > 0) {
      det.CbtesAsoc = {
        CbteAsoc: inv.CbtesAsoc.map((c) => {
          const asoc: Record<string, any> = {
            Tipo: c.Tipo,
            PtoVta: c.PtoVta,
            Nro: c.Nro,
          };
          if (c.Cuit) asoc.Cuit = c.Cuit;
          if (c.CbteFch) asoc.CbteFch = c.CbteFch;
          return asoc;
        }),
      };
    }

    if (inv.Opcionales && inv.Opcionales.length > 0) {
      det.Opcionales = {
        Opcional: inv.Opcionales.map((o) => ({
          Id: o.Id,
          Valor: o.Valor,
        })),
      };
    }

    return det;
  }
}
