import { afipSoapCall, ensureArray } from "@ramiidv/arca-common";
import type { CallOptions, SoapOperationKind } from "@ramiidv/arca-common";
import { ENDPOINTS, WSFEX_ERRORES_INTERNOS, WSFEX_NAMESPACE } from "./constants.js";
import { ArcaResultadoInciertoExpo, ArcaSoapError, ArcaWSFEError } from "./errors.js";
import type { WsClientOptions } from "./wsfe.js";
import type {
  WsfeAuth,
  WsfexInvoice,
  WsfexAuthResult,
  WsfexGetCmpResult,
  WsfexParamItem,
  WsfexCotizacion,
  WsfexPtoVenta,
  WsfexErr,
  ServerStatus,
  MensajeArca,
} from "./types.js";

type R = Record<string, any>;

/** Error de WSFEX en `FEXErr` (código distinto de 0), o `undefined`. */
function fexErr(result: R): WsfexErr | undefined {
  const err = result.FEXErr as R | undefined;
  if (!err || err.ErrCode === undefined || Number(err.ErrCode) === 0) return undefined;
  return { ErrCode: Number(err.ErrCode), ErrMsg: String(err.ErrMsg ?? "") };
}

function checkFexErr(result: R): void {
  const err = fexErr(result);
  if (err) throw new ArcaWSFEError([{ code: err.ErrCode, msg: err.ErrMsg }], "WSFEX");
}

/** `FEXEvents` con código distinto de 0, normalizado. */
export function eventosWsfex(result: { FEXEvents?: unknown } | undefined): MensajeArca[] {
  return ensureArray((result as R | undefined)?.FEXEvents as R | R[] | undefined)
    .filter((e) => e && Number(e.EventCode) !== 0)
    .map((e) => ({ code: Number(e.EventCode), msg: String(e.EventMsg ?? "") }));
}

function sinCampo(method: string, campo: string): ArcaSoapError {
  return new ArcaSoapError(`Respuesta de ${method} sin ${campo}`);
}

/**
 * Arma el `Cmp` (ClsFEXRequest) en el orden de la secuencia del WSDL de WSFEX,
 * envolviendo los arrays (`Permisos/Permiso`, `Cmps_asoc/Cmp_asoc`,
 * `Items/Item`, `Opcionales/Opcional`, `Actividades/Actividad`).
 */
export function buildFexCmp(inv: WsfexInvoice): R {
  const cmp: R = {
    Id: inv.Id,
    Fecha_cbte: inv.Fecha_cbte,
    Cbte_Tipo: inv.Cbte_Tipo,
    Punto_vta: inv.Punto_vta,
    Cbte_nro: inv.Cbte_nro,
    Tipo_expo: inv.Tipo_expo,
  };
  // "" se envía como elemento vacío: el manual pide Permiso_existente "vacío" fuera de Factura E de bienes.
  if (inv.Permiso_existente !== undefined && inv.Permiso_existente !== null) cmp.Permiso_existente = inv.Permiso_existente;
  if (inv.Permisos && inv.Permisos.length > 0) {
    cmp.Permisos = { Permiso: inv.Permisos.map((p) => ({ Id_permiso: p.Id_permiso, Dst_merc: p.Dst_merc })) };
  }
  cmp.Dst_cmp = inv.Dst_cmp;
  cmp.Cliente = inv.Cliente;
  cmp.Cuit_pais_cliente = inv.Cuit_pais_cliente;
  cmp.Domicilio_cliente = inv.Domicilio_cliente;
  if (inv.Id_impositivo) cmp.Id_impositivo = inv.Id_impositivo;
  cmp.Moneda_Id = inv.Moneda_Id;
  cmp.Moneda_ctz = inv.Moneda_ctz;
  if (inv.CanMisMonExt) cmp.CanMisMonExt = inv.CanMisMonExt;
  if (inv.Obs_comerciales) cmp.Obs_comerciales = inv.Obs_comerciales;
  cmp.Imp_total = inv.Imp_total;
  if (inv.Obs) cmp.Obs = inv.Obs;
  if (inv.Cmps_asoc && inv.Cmps_asoc.length > 0) {
    cmp.Cmps_asoc = {
      Cmp_asoc: inv.Cmps_asoc.map((c) => ({
        Cbte_tipo: c.Cbte_tipo,
        Cbte_punto_vta: c.Cbte_punto_vta,
        Cbte_nro: c.Cbte_nro,
        Cbte_cuit: c.Cbte_cuit,
      })),
    };
  }
  if (inv.Forma_pago) cmp.Forma_pago = inv.Forma_pago;
  if (inv.Incoterms) cmp.Incoterms = inv.Incoterms;
  if (inv.Incoterms_Ds) cmp.Incoterms_Ds = inv.Incoterms_Ds;
  cmp.Idioma_cbte = inv.Idioma_cbte;
  if (inv.Items && inv.Items.length > 0) {
    cmp.Items = {
      Item: inv.Items.map((i) => {
        const item: R = {};
        if (i.Pro_codigo !== undefined && i.Pro_codigo !== "") item.Pro_codigo = i.Pro_codigo;
        item.Pro_ds = i.Pro_ds;
        item.Pro_qty = i.Pro_qty;
        item.Pro_umed = i.Pro_umed;
        item.Pro_precio_uni = i.Pro_precio_uni;
        item.Pro_bonificacion = i.Pro_bonificacion;
        item.Pro_total_item = i.Pro_total_item;
        return item;
      }),
    };
  }
  if (inv.Opcionales && inv.Opcionales.length > 0) {
    cmp.Opcionales = { Opcional: inv.Opcionales.map((o) => ({ Id: o.Id, Valor: o.Valor })) };
  }
  if (inv.Fecha_pago) cmp.Fecha_pago = inv.Fecha_pago;
  if (inv.Actividades && inv.Actividades.length > 0) {
    cmp.Actividades = { Actividad: inv.Actividades.map((a) => ({ Id: a.Id })) };
  }
  return cmp;
}

/** Cliente de bajo nivel de WSFEX (Factura electrónica de exportación). */
export class WsfexClient {
  private readonly endpoint: string;
  private readonly soapOpts: Omit<WsClientOptions, "endpoint" | "timeoutMs"> & { timeout?: number };

  constructor(production: boolean, opts: WsClientOptions = {}) {
    this.endpoint = opts.endpoint ?? (production ? ENDPOINTS.wsfex.production : ENDPOINTS.wsfex.testing);
    this.soapOpts = {
      timeout: opts.timeoutMs,
      retries: opts.retries,
      retryDelayMs: opts.retryDelayMs,
      onEvent: opts.onEvent,
      fetch: opts.fetch,
      legacyTls: opts.legacyTls,
    };
  }

  /** WSFEX es ASMX con `elementFormDefault="qualified"`, como WSFEv1. */
  private call(method: string, params: R, opts?: CallOptions & { kind?: SoapOperationKind }): Promise<R> {
    return afipSoapCall(this.endpoint, WSFEX_NAMESPACE, method, params, {
      ...this.soapOpts,
      qualified: true,
      soapActionFromMethod: true,
      kind: opts?.kind,
      signal: opts?.signal,
    });
  }

  private async consulta(method: string, params: R, opts?: CallOptions): Promise<R> {
    const result = await this.call(method, params, opts);
    checkFexErr(result);
    return result;
  }

  // ============================================================
  // Facturación de exportación
  // ============================================================

  /**
   * Autoriza un comprobante de exportación (emisión). No se reintenta.
   *
   * - `ArcaResultadoInciertoExpo`: no se sabe si se autorizó (timeout, red,
   *   5xx, error interno 500/501/502/505, respuesta sin `FEXResultAuth`).
   *   Reenviar el mismo `Cmp` con el mismo `Id` (`error.request`).
   * - `ArcaWSFEError`: WSFEX rechazó el request (`FEXErr`).
   */
  async authorize(auth: WsfeAuth, invoice: WsfexInvoice, opts?: CallOptions): Promise<WsfexAuthResult> {
    let result: R;
    try {
      result = await this.call("FEXAuthorize", { Auth: auth, Cmp: buildFexCmp(invoice) }, { ...opts, kind: "emision" });
    } catch (err) {
      if (err instanceof ArcaSoapError && err.uncertain) throw new ArcaResultadoInciertoExpo(invoice, { cause: err });
      throw err;
    }

    const err = fexErr(result);
    if (err && WSFEX_ERRORES_INTERNOS.includes(err.ErrCode)) {
      throw new ArcaResultadoInciertoExpo(invoice, {
        cause: new ArcaWSFEError([{ code: err.ErrCode, msg: err.ErrMsg }], "WSFEX"),
      });
    }
    if (err) throw new ArcaWSFEError([{ code: err.ErrCode, msg: err.ErrMsg }], "WSFEX");

    const auth_ = result.FEXResultAuth as R | undefined;
    if (!auth_ || (auth_.Resultado !== "A" && auth_.Resultado !== "R")) {
      throw new ArcaResultadoInciertoExpo(invoice, {
        cause: new ArcaSoapError("Respuesta de FEXAuthorize sin FEXResultAuth.Resultado", { uncertain: true }),
      });
    }
    if (auth_.Cae !== undefined && auth_.Cae !== null) auth_.Cae = String(auth_.Cae);
    return result as WsfexAuthResult;
  }

  /** Último comprobante autorizado (`FEXGetLast_CMP`). */
  async getLastCmp(auth: WsfeAuth, ptoVta: number, cbteTipo: number, opts?: CallOptions): Promise<number> {
    const result = await this.consulta(
      "FEXGetLast_CMP",
      { Auth: { Token: auth.Token, Sign: auth.Sign, Cuit: auth.Cuit, Pto_venta: ptoVta, Cbte_Tipo: cbteTipo } },
      opts
    );
    const nro = result.FEXResult_LastCMP?.Cbte_nro;
    if (nro === undefined || nro === null) throw sinCampo("FEXGetLast_CMP", "FEXResult_LastCMP.Cbte_nro");
    return Number(nro);
  }

  /** Último `Id` de request usado (`FEXGetLast_ID`). */
  async getLastId(auth: WsfeAuth, opts?: CallOptions): Promise<number> {
    const result = await this.consulta("FEXGetLast_ID", { Auth: auth }, opts);
    const id = result.FEXResultGet?.Id;
    if (id === undefined || id === null) throw sinCampo("FEXGetLast_ID", "FEXResultGet.Id");
    return Number(id);
  }

  /** Consulta un comprobante de exportación (`FEXGetCMP`). */
  async getCmp(
    auth: WsfeAuth,
    cbteTipo: number,
    ptoVta: number,
    cbteNro: number,
    opts?: CallOptions
  ): Promise<WsfexGetCmpResult> {
    const result = await this.consulta(
      "FEXGetCMP",
      { Auth: auth, Cmp: { Cbte_tipo: cbteTipo, Punto_vta: ptoVta, Cbte_nro: cbteNro } },
      opts
    );
    if (!result.FEXResultGet) throw sinCampo("FEXGetCMP", "FEXResultGet");
    const r = result.FEXResultGet as R;
    if (r.Cae !== undefined && r.Cae !== null) r.Cae = String(r.Cae);
    return result as WsfexGetCmpResult;
  }

  /** Estado de los servidores de WSFEX (`FEXDummy`). */
  async serverStatus(opts?: CallOptions): Promise<ServerStatus> {
    return (await this.call("FEXDummy", {}, opts)) as ServerStatus;
  }

  /** Cotización de una moneda (`FEXGetPARAM_Ctz`). */
  async getCotizacion(
    auth: WsfeAuth,
    monId: string,
    opts?: CallOptions & { fchCotiz?: string }
  ): Promise<WsfexCotizacion> {
    const params: R = { Auth: auth, Mon_id: monId };
    if (opts?.fchCotiz !== undefined) params.FchCotiz = opts.fchCotiz;
    const result = await this.consulta("FEXGetPARAM_Ctz", params, opts);
    const r = result.FEXResultGet as R | undefined;
    if (!r || r.Mon_ctz === undefined || r.Mon_ctz === null) throw sinCampo("FEXGetPARAM_Ctz", "FEXResultGet.Mon_ctz");
    return { Mon_ctz: Number(r.Mon_ctz), ...(r.Mon_fecha != null && { Mon_fecha: String(r.Mon_fecha) }) };
  }

  /**
   * Verifica un permiso de embarque (`FEXCheck_Permiso`). Devuelve el `Status`
   * que informa ARCA (ej: "OK").
   */
  async checkPermiso(auth: WsfeAuth, idPermiso: string, dstMerc: number, opts?: CallOptions): Promise<string> {
    const result = await this.consulta(
      "FEXCheck_Permiso",
      { Auth: auth, ID_Permiso: idPermiso, Dst_merc: dstMerc },
      opts
    );
    const status = result.FEXResultGet?.Status;
    if (status === undefined || status === null) throw sinCampo("FEXCheck_Permiso", "FEXResultGet.Status");
    return String(status);
  }

  // ============================================================
  // Parámetros
  // ============================================================

  private async getParamList<T>(method: string, itemKey: string, params: R, opts?: CallOptions): Promise<T[]> {
    const result = await this.consulta(method, params, opts);
    return ensureArray(result.FEXResultGet?.[itemKey] as T | T[] | undefined);
  }

  /** Tipos de comprobante de exportación. */
  async getTiposCbte(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList("FEXGetPARAM_Cbte_Tipo", "ClsFEXResponse_Cbte_Tipo", { Auth: auth }, opts);
  }

  /** Monedas disponibles. */
  async getMonedas(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList("FEXGetPARAM_MON", "ClsFEXResponse_Mon", { Auth: auth }, opts);
  }

  /** Monedas con su cotización a una fecha (`FEXGetPARAM_MON_CON_COTIZACION`). */
  async getMonedasConCotizacion(
    auth: WsfeAuth,
    opts?: CallOptions & { fechaCtz?: string }
  ): Promise<WsfexParamItem[]> {
    const params: R = { Auth: auth };
    if (opts?.fechaCtz !== undefined) params.Fecha_CTZ = opts.fechaCtz;
    return this.getParamList("FEXGetPARAM_MON_CON_COTIZACION", "ClsFEXResponse_Mon_CON_Cotizacion", params, opts);
  }

  /** Países destino (`FEXGetPARAM_DST_pais`). */
  async getPaises(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList("FEXGetPARAM_DST_pais", "ClsFEXResponse_DST_pais", { Auth: auth }, opts);
  }

  /** Idiomas disponibles. */
  async getIdiomas(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList("FEXGetPARAM_Idiomas", "ClsFEXResponse_Idi", { Auth: auth }, opts);
  }

  /** Incoterms disponibles. */
  async getIncoterms(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList("FEXGetPARAM_Incoterms", "ClsFEXResponse_Inc", { Auth: auth }, opts);
  }

  /** Unidades de medida. */
  async getUMed(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList("FEXGetPARAM_UMed", "ClsFEXResponse_UMed", { Auth: auth }, opts);
  }

  /** Tipos de exportación. */
  async getTiposExpo(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList("FEXGetPARAM_Tipo_Expo", "ClsFEXResponse_Tex", { Auth: auth }, opts);
  }

  /** CUITs de países. */
  async getCuitsPais(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList("FEXGetPARAM_DST_CUIT", "ClsFEXResponse_DST_cuit", { Auth: auth }, opts);
  }

  /** Puntos de venta habilitados para exportación (`FEXGetPARAM_PtoVenta`). */
  async getPuntosVenta(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexPtoVenta[]> {
    return this.getParamList("FEXGetPARAM_PtoVenta", "ClsFEXResponse_PtoVenta", { Auth: auth }, opts);
  }

  /** Tipos de datos opcionales (`FEXGetPARAM_Opcionales`). */
  async getOpcionales(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList("FEXGetPARAM_Opcionales", "ClsFEXResponse_Opc", { Auth: auth }, opts);
  }

  /** Actividades del emisor (`FEXGetPARAM_Actividades`). */
  async getActividades(auth: WsfeAuth, opts?: CallOptions): Promise<WsfexParamItem[]> {
    return this.getParamList("FEXGetPARAM_Actividades", "ClsFEXResponse_ActividadTipo", { Auth: auth }, opts);
  }
}
