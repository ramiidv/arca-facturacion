import { ENDPOINTS, WSFEX_NAMESPACE } from "./constants.js";
import { afipSoapCall } from "./soap-client.js";
import type { SoapOptions } from "./soap-client.js";
import { ArcaWSFEError } from "./errors.js";
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

function toArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

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

  private call(method: string, params: Record<string, any>) {
    return afipSoapCall(
      this.endpoint,
      WSFEX_NAMESPACE,
      method,
      params,
      this.soapOpts
    );
  }

  // ============================================================
  // Facturación de exportación
  // ============================================================

  /**
   * Autoriza un comprobante de exportación.
   */
  async authorize(
    auth: WsfeAuth,
    invoice: WsfexInvoice
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
    })) as WsfexAuthResult;

    checkFexErr(result);
    return result;
  }

  /**
   * Obtiene el último comprobante autorizado.
   */
  async getLastCmp(
    auth: WsfeAuth,
    ptoVta: number,
    cbteTipo: number
  ): Promise<number> {
    const result = (await this.call("FEXGetLast_CMP", {
      Auth: auth,
      Cbte_Tipo: cbteTipo,
      Punto_vta: ptoVta,
    })) as WsfexLastCmpResult;
    checkFexErr(result);
    return result.FEXResult_LastCMP?.Cbte_nro ?? 0;
  }

  /**
   * Obtiene el último ID de request.
   */
  async getLastId(auth: WsfeAuth): Promise<number> {
    const result = (await this.call("FEXGetLast_ID", {
      Auth: auth,
    })) as WsfexLastIdResult;
    checkFexErr(result);
    return result.FEXResultGet?.Id ?? 0;
  }

  /**
   * Consulta un comprobante de exportación.
   */
  async getCmp(
    auth: WsfeAuth,
    cbteTipo: number,
    ptoVta: number,
    cbteNro: number
  ): Promise<WsfexGetCmpResult> {
    const result = (await this.call("FEXGetCMP", {
      Auth: auth,
      Cmp: { Cbte_tipo: cbteTipo, Punto_vta: ptoVta, Cbte_nro: cbteNro },
    })) as WsfexGetCmpResult;
    checkFexErr(result);
    return result;
  }

  /**
   * Verifica el estado de los servidores de WSFEX.
   */
  async serverStatus(): Promise<ServerStatus> {
    return (await this.call("FEXDummy", {})) as ServerStatus;
  }

  // ============================================================
  // Parámetros
  // ============================================================

  private async getParamList<T>(
    auth: WsfeAuth,
    method: string,
    resultKey: string,
    itemKey: string
  ): Promise<T[]> {
    const result = (await this.call(method, { Auth: auth })) as Record<
      string,
      any
    >;
    checkFexErr(result);
    const items = result[resultKey]?.[itemKey];
    return toArray(items);
  }

  /** Tipos de comprobante de exportación. */
  async getTiposCbte(auth: WsfeAuth): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_Cbte_Tipo",
      "FEXResultGet",
      "ClsFEXResponse_Cbte_Tipo"
    );
  }

  /** Monedas disponibles. */
  async getMonedas(auth: WsfeAuth): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_MON",
      "FEXResultGet",
      "ClsFEXResponse_Mon"
    );
  }

  /** Países destino. */
  async getPaises(auth: WsfeAuth): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_DST_Pais",
      "FEXResultGet",
      "ClsFEXResponse_DST_pais"
    );
  }

  /** Idiomas disponibles. */
  async getIdiomas(auth: WsfeAuth): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_Idiomas",
      "FEXResultGet",
      "ClsFEXResponse_Idi"
    );
  }

  /** Incoterms disponibles. */
  async getIncoterms(auth: WsfeAuth): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_Incoterms",
      "FEXResultGet",
      "ClsFEXResponse_Inc"
    );
  }

  /** Unidades de medida. */
  async getUMed(auth: WsfeAuth): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_UMed",
      "FEXResultGet",
      "ClsFEXResponse_UMed"
    );
  }

  /** Tipos de exportación. */
  async getTiposExpo(auth: WsfeAuth): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_Tipo_Expo",
      "FEXResultGet",
      "ClsFEXResponse_Tex"
    );
  }

  /** CUITs de países. */
  async getCuitsPais(auth: WsfeAuth): Promise<WsfexParamItem[]> {
    return this.getParamList(
      auth,
      "FEXGetPARAM_DST_CUIT",
      "FEXResultGet",
      "ClsFEXResponse_DST_cuit"
    );
  }
}
