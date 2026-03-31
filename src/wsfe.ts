import { ENDPOINTS, WSFE_NAMESPACE } from "./constants.js";
import { afipSoapCall, toArray } from "./soap-client.js";
import type { SoapOptions } from "./soap-client.js";
import { ArcaWSFEError } from "./errors.js";
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

  private call(method: string, params: Record<string, any>) {
    return afipSoapCall(
      this.endpoint,
      WSFE_NAMESPACE,
      method,
      params,
      this.soapOpts
    );
  }

  // ============================================================
  // Facturación
  // ============================================================

  async solicitarCAE(
    auth: WsfeAuth,
    request: InvoiceRequest
  ): Promise<FECAESolicitarResult> {
    const detRequests = request.invoices.map((inv) =>
      this.buildDetRequest(inv)
    );

    const result = (await this.call("FECAESolicitar", {
      Auth: auth,
      FeCAEReq: {
        FeCabReq: {
          CantReg: request.invoices.length,
          PtoVta: request.PtoVta,
          CbteTipo: request.CbteTipo,
        },
        FeDetReq: { FECAEDetRequest: detRequests },
      },
    })) as FECAESolicitarResult;

    checkErrors(result);
    return result;
  }

  async ultimoComprobante(
    auth: WsfeAuth,
    ptoVta: number,
    cbteTipo: number
  ): Promise<number> {
    const result = (await this.call("FECompUltimoAutorizado", {
      Auth: auth,
      PtoVta: ptoVta,
      CbteTipo: cbteTipo,
    })) as FECompUltimoAutorizadoResult;
    checkErrors(result);
    return Number(result.CbteNro);
  }

  async consultarComprobante(
    auth: WsfeAuth,
    cbteTipo: number,
    ptoVta: number,
    cbteNro: number
  ): Promise<FECompConsultarResult> {
    const result = (await this.call("FECompConsultar", {
      Auth: auth,
      FeCompConsReq: { CbteTipo: cbteTipo, CbteNro: cbteNro, PtoVta: ptoVta },
    })) as FECompConsultarResult;
    checkErrors(result);
    return result;
  }

  // ============================================================
  // Parámetros
  // ============================================================

  async serverStatus(): Promise<ServerStatus> {
    return (await this.call("FEDummy", {})) as ServerStatus;
  }

  private async getParam<T>(
    auth: WsfeAuth,
    method: string,
    itemKey: string
  ): Promise<T[]> {
    const result = (await this.call(method, { Auth: auth })) as WsfeResult;
    checkErrors(result);
    return toArray(result.ResultGet?.[itemKey] as T | T[] | undefined);
  }

  async getTiposComprobante(auth: WsfeAuth): Promise<ParamItem[]> {
    return this.getParam(auth, "FEParamGetTiposCbte", "CbteTipo");
  }

  async getTiposConcepto(auth: WsfeAuth): Promise<ParamItem[]> {
    return this.getParam(auth, "FEParamGetTiposConcepto", "ConceptoTipo");
  }

  async getTiposDocumento(auth: WsfeAuth): Promise<ParamItem[]> {
    return this.getParam(auth, "FEParamGetTiposDoc", "DocTipo");
  }

  async getCondicionesIva(auth: WsfeAuth): Promise<ParamItem[]> {
    return this.getParam(auth, "FEParamGetCondicionIvaReceptor", "CondicionIVAReceptor");
  }

  async getTiposIva(auth: WsfeAuth): Promise<ParamItem[]> {
    return this.getParam(auth, "FEParamGetTiposIva", "IvaTipo");
  }

  async getMonedas(auth: WsfeAuth): Promise<MonedaItem[]> {
    return this.getParam(auth, "FEParamGetTiposMonedas", "Moneda");
  }

  async getTiposTributo(auth: WsfeAuth): Promise<ParamItem[]> {
    return this.getParam(auth, "FEParamGetTiposTributos", "TributoTipo");
  }

  async getTiposOpcional(auth: WsfeAuth): Promise<ParamItem[]> {
    return this.getParam(auth, "FEParamGetTiposOpcional", "OpcionalTipo");
  }

  async getPuntosVenta(auth: WsfeAuth): Promise<PtoVentaItem[]> {
    return this.getParam(auth, "FEParamGetPtosVenta", "PtoVenta");
  }

  async getCotizacion(
    auth: WsfeAuth,
    monedaId: string
  ): Promise<CotizacionResult> {
    const result = (await this.call("FEParamGetCotizacion", {
      Auth: auth,
      MonId: monedaId,
    })) as WsfeResult & CotizacionResult;
    checkErrors(result);
    return result;
  }

  async getCantMaxRegistros(auth: WsfeAuth): Promise<number> {
    const result = (await this.call("FECompTotXRequest", {
      Auth: auth,
    })) as WsfeResult & { RegXReq?: number };
    checkErrors(result);
    return Number(result.RegXReq ?? 0);
  }

  // ============================================================
  // CAEA - Autorización Anticipada
  // ============================================================

  async solicitarCAEA(
    auth: WsfeAuth,
    periodo: string,
    orden: number
  ): Promise<CaeaSolicitarResult> {
    const result = (await this.call("FECAEASolicitar", {
      Auth: auth,
      Periodo: periodo,
      Orden: orden,
    })) as WsfeResult & { ResultGet?: CaeaSolicitarResult };
    checkErrors(result);
    return result.ResultGet!;
  }

  async consultarCAEA(
    auth: WsfeAuth,
    periodo: string,
    orden: number
  ): Promise<CaeaSolicitarResult> {
    const result = (await this.call("FECAEAConsultar", {
      Auth: auth,
      Periodo: periodo,
      Orden: orden,
    })) as WsfeResult & { ResultGet?: CaeaSolicitarResult };
    checkErrors(result);
    return result.ResultGet!;
  }

  async registrarCAEA(
    auth: WsfeAuth,
    request: CaeaRegInfRequest
  ): Promise<CaeaRegInfResult> {
    const detRequests = request.invoices.map((inv) => {
      const det = this.buildDetRequest(inv);
      det.CAEA = inv.CAEA;
      return det;
    });

    const result = (await this.call("FECAEARegInformativo", {
      Auth: auth,
      FeCAEARegInfReq: {
        FeCabReq: {
          CantReg: request.invoices.length,
          PtoVta: request.PtoVta,
          CbteTipo: request.CbteTipo,
        },
        FeDetReq: { FECAEADetRequest: detRequests },
      },
    })) as CaeaRegInfResult;
    checkErrors(result);
    return result;
  }

  async sinMovimientoCAEA(
    auth: WsfeAuth,
    caea: string,
    ptoVta: number
  ): Promise<CaeaSinMovResult> {
    const result = (await this.call("FECAEASinMovimientoInformar", {
      Auth: auth,
      CAEA: caea,
      PtoVta: ptoVta,
    })) as CaeaSinMovResult;
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
