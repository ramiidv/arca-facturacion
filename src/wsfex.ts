import { ENDPOINTS, WSFEX_NAMESPACE } from "./constants.js";
import { afipSoapCall, toArray } from "./soap-client.js";
import type { SoapOptions } from "./soap-client.js";
import { ArcaWSFEError } from "./errors.js";
import type { CallOptions, SoapOperationKind } from "@ramiidv/arca-common";
import type {
  WsfeAuth,
  WsfexInvoice,
  WsfexAuthResult,
  WsfexLastCmpResult,
  WsfexLastIdResult,
  WsfexGetCmpResult,
  WsfexParamItem,
  ServerStatus,
  ArcaEvent,
} from "./types.js";

function checkFexErr(result: {
  FEXErr?: { ErrCode: number; ErrMsg: string };
}): void {
  if (result.FEXErr && result.FEXErr.ErrCode !== 0) {
    throw new ArcaWSFEError([
      { code: result.FEXErr.ErrCode, msg: result.FEXErr.ErrMsg },
    ]);
  }
}

export class WsfexClient {
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
      ? ENDPOINTS.wsfex.production
      : ENDPOINTS.wsfex.testing;
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
    return afipSoapCall(this.endpoint, WSFEX_NAMESPACE, method, params, {
      ...this.soapOpts,
      kind: opts?.kind,
      signal: opts?.signal,
    });
  }

  // ============================================================
  // Facturación de exportación
  // ============================================================

  /**
   * Autoriza un comprobante de exportación (emisión). No se reintenta: si el
   * resultado es incierto, el error es `ArcaSoapError` con `uncertain: true`;
   * verificar con `getCmp` antes de volver a enviar.
   */
  async authorize(
    auth: WsfeAuth,
    invoice: WsfexInvoice,
    opts?: CallOptions
  ): Promise<WsfexAuthResult> {
    const cmp: Record<string, any> = { ...invoice };

    // Wrappear Items
    if (invoice.Items && invoice.Items.length > 0) {
      cmp.Items = { Item: invoice.Items };
    }

    // Wrappear Permisos
    if (invoice.Permisos && invoice.Permisos.length > 0) {
      cmp.Permisos = { Permiso: invoice.Permisos };
    }

    // Wrappear Cmps_asoc
    if (invoice.Cmps_asoc && invoice.Cmps_asoc.length > 0) {
      cmp.Cmps_asoc = { Cmp_asoc: invoice.Cmps_asoc };
    }

    const result = (await this.call("FEXAuthorize", {
      Auth: auth,
      Cmp: cmp,
    }, { ...opts, kind: "emision" })) as WsfexAuthResult;

    checkFexErr(result);
    return result;
  }

  /**
   * Obtiene el último comprobante autorizado.
   */
  async getLastCmp(
    auth: WsfeAuth,
    ptoVta: number,
    cbteTipo: number,
    opts?: CallOptions
  ): Promise<number> {
    const result = (await this.call("FEXGetLast_CMP", {
      Auth: {
        Token: auth.Token,
        Sign: auth.Sign,
        Cuit: auth.Cuit,
        Pto_venta: ptoVta,
        Cbte_Tipo: cbteTipo,
      },
    }, opts)) as WsfexLastCmpResult;
    checkFexErr(result);
    return Number(result.FEXResult_LastCMP?.Cbte_nro ?? 0);
  }

  /**
   * Obtiene el último ID de request.
   */
  async getLastId(auth: WsfeAuth, opts?: CallOptions): Promise<number> {
    const result = (await this.call("FEXGetLast_ID", {
      Auth: auth,
    }, opts)) as WsfexLastIdResult;
    checkFexErr(result);
    return Number(result.FEXResultGet?.Id ?? 0);
  }

  /**
   * Consulta un comprobante de exportación.
   */
  async getCmp(
    auth: WsfeAuth,
    cbteTipo: number,
    ptoVta: number,
    cbteNro: number,
    opts?: CallOptions
  ): Promise<WsfexGetCmpResult> {
    const result = (await this.call("FEXGetCMP", {
      Auth: auth,
      Cmp: { Cbte_tipo: cbteTipo, Punto_vta: ptoVta, Cbte_nro: cbteNro },
    }, opts)) as WsfexGetCmpResult;
    checkFexErr(result);
    return result;
  }

  /**
   * Verifica el estado de los servidores de WSFEX.
   */
  async serverStatus(opts?: CallOptions): Promise<ServerStatus> {
    return (await this.call("FEXDummy", {}, opts)) as ServerStatus;
  }

  // ============================================================
  // Parámetros
  // ============================================================

  private async getParamList<T>(
    auth: WsfeAuth,
    method: string,
    resultKey: string,
    itemKey: string,
    opts?: CallOptions
  ): Promise<T[]> {
    const result = (await this.call(method, { Auth: auth }, opts)) as Record<
      string,
      any
    >;
    checkFexErr(result);
    const items = result[resultKey]?.[itemKey];
    return toArray(items);
  }

  /** Tipos de comprobante de exportación. */
  async getTiposCbte(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_Cbte_Tipo",
      "FEXResultGet",
      "ClsFEXResponse_Cbte_Tipo",
      opts
    );
  }

  /** Monedas disponibles. */
  async getMonedas(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_MON",
      "FEXResultGet",
      "ClsFEXResponse_Mon",
      opts
    );
  }

  /** Países destino. */
  async getPaises(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_DST_Pais",
      "FEXResultGet",
      "ClsFEXResponse_DST_pais",
      opts
    );
  }

  /** Idiomas disponibles. */
  async getIdiomas(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_Idiomas",
      "FEXResultGet",
      "ClsFEXResponse_Idi",
      opts
    );
  }

  /** Incoterms disponibles. */
  async getIncoterms(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_Incoterms",
      "FEXResultGet",
      "ClsFEXResponse_Inc",
      opts
    );
  }

  /** Unidades de medida. */
  async getUMed(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_UMed",
      "FEXResultGet",
      "ClsFEXResponse_UMed",
      opts
    );
  }

  /** Tipos de exportación. */
  async getTiposExpo(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_Tipo_Expo",
      "FEXResultGet",
      "ClsFEXResponse_Tex",
      opts
    );
  }

  /** CUITs de países. */
  async getCuitsPais(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_DST_CUIT",
      "FEXResultGet",
      "ClsFEXResponse_DST_cuit",
      opts
    );
  }
}
