import { EventEmitter } from "node:events";
import { anySignal } from "@ramiidv/arca-common";
import type { CallOptions } from "@ramiidv/arca-common";
import { WsaaClient } from "./wsaa.js";
import { WsfeClient } from "./wsfe.js";
import { WsfexClient } from "./wsfex.js";
import { PadronClient, PADRON_A5_SERVICE, PADRON_A13_SERVICE } from "./padron.js";
import {
  armarComprobante,
  coincideConIntento,
  facturaResultDesdeConsulta,
  parseFacturaResult,
  toDateString,
  calcularTotales,
} from "./facturacion.js";
import { ArcaError } from "./errors.js";
import {
  validateFacturarOpts,
  validateFacturarExpoOpts,
  validateInvoiceRequest,
} from "./validation.js";
import type {
  ArcaConfig,
  ArcaEvent,
  WsfeAuth,
  InvoiceRequest,
  InvoiceDetail,
  FECAESolicitarResult,
  FECAEDetResponse,
  FECompConsultarResult,
  ServerStatus,
  ParamItem,
  MonedaItem,
  PtoVentaItem,
  CotizacionResult,
  FacturarOpts,
  NotaCreditoOpts,
  NotaDebitoOpts,
  FacturaResult,
  LineItem,
  QRInput,
  WsfexInvoice,
  WsfexAuthResult,
  WsfexGetCmpResult,
  WsfexParamItem,
  FacturarExpoOpts,
  FacturaExpoResult,
  CaeaSolicitarResult,
  CaeaRegInfRequest,
  CaeaRegInfResult,
  CaeaSinMovResult,
  Contribuyente,
  ComprobanteArmado,
  ComprobanteRef,
  IntentoComprobante,
  ResultadoRecuperacion,
} from "./types.js";
import { NOTA_CREDITO_MAP, NOTA_DEBITO_MAP, QR_URL } from "./constants.js";

export class Arca {
  /**
   * Cliente WSAA de esta instancia. Se puede pasar a otras instancias que usan
   * el mismo certificado (ej: `new ArcaPadron({ ..., wsaa: arca.wsaa })`) para
   * compartir los tickets.
   */
  public readonly wsaa: WsaaClient;
  private wsfe: WsfeClient;
  private wsfex: WsfexClient;
  private padron: PadronClient;
  private cuit: number;
  private production: boolean;
  private signal?: AbortSignal;
  private emitter = new EventEmitter();
  private onEventCb?: (event: ArcaEvent) => void;
  private paramCache = new Map<string, { data: unknown; expires: number }>();
  private paramCacheTTLMs: number;

  constructor(config: ArcaConfig) {
    this.cuit = config.cuit;
    this.production = config.production ?? false;
    this.onEventCb = config.onEvent;
    this.signal = config.signal;
    this.paramCacheTTLMs = config.paramCacheTTLMs ?? 24 * 60 * 60_000; // default 24h

    const timeoutMs = config.requestTimeoutMs ?? 30_000;
    const retries = config.retries ?? 1;
    const retryDelayMs = config.retryDelayMs ?? 1_000;

    const emit = (event: ArcaEvent) => {
      this.onEventCb?.(event);
      this.emitter.emit(event.type, event);
    };

    const clientOpts = { timeoutMs, retries, retryDelayMs, onEvent: emit };

    this.wsaa =
      config.wsaa ??
      new WsaaClient({
        cert: config.cert,
        key: config.key,
        production: this.production,
        tokenTTLMinutes: config.tokenTTLMinutes ?? 720,
        timeout: timeoutMs,
        retries,
        retryDelayMs,
        onEvent: emit,
        ticketStorage: config.ticketStorage,
        clockOffsetMs: config.clockOffsetMs,
        autoClockSkew: config.autoClockSkew,
      });

    this.wsfe = new WsfeClient(this.production, clientOpts);
    this.wsfex = new WsfexClient(this.production, clientOpts);
    this.padron = new PadronClient(this.production, clientOpts);
  }

  // ============================================================
  // Eventos
  // ============================================================

  /**
   * Suscribirse a eventos del SDK.
   *
   * @example
   * ```ts
   * arca.on("request:end", (e) => console.log(`${e.method} took ${e.durationMs}ms`));
   * arca.on("auth:login", (e) => console.log(`Login ${e.service} in ${e.durationMs}ms`));
   * arca.on("request:retry", (e) => console.warn(`Retry #${e.attempt}: ${e.error}`));
   * ```
   */
  on(event: ArcaEvent["type"], handler: (event: ArcaEvent) => void): this {
    this.emitter.on(event, handler);
    return this;
  }

  /** Desuscribirse de un evento. */
  off(event: ArcaEvent["type"], handler: (event: ArcaEvent) => void): this {
    this.emitter.off(event, handler);
    return this;
  }

  // ============================================================
  // Auth helpers
  // ============================================================

  /** Combina el signal global de la config con el de la llamada. */
  private opts(call?: CallOptions): CallOptions {
    return { signal: anySignal(this.signal, call?.signal) };
  }

  private async getAuth(service: string = "wsfe", call?: CallOptions): Promise<WsfeAuth> {
    const ticket = await this.wsaa.getAccessTicket(service, call);
    return {
      Token: ticket.token,
      Sign: ticket.sign,
      Cuit: this.cuit,
    };
  }

  // ============================================================
  // Facturación - Métodos principales (raw)
  // ============================================================

  /**
   * Solicita CAE para uno o más comprobantes (API raw).
   *
   * No se reintenta. Si el resultado es incierto lanza `ArcaResultadoIncierto`;
   * si ARCA rechaza el request, `ArcaWSFEError`.
   */
  async crearFactura(request: InvoiceRequest, call?: CallOptions): Promise<FECAESolicitarResult> {
    validateInvoiceRequest(request);
    const opts = this.opts(call);
    const auth = await this.getAuth("wsfe", opts);
    return this.wsfe.solicitarCAE(auth, request, opts);
  }

  /** Último número de comprobante autorizado. */
  async ultimoComprobante(ptoVta: number, cbteTipo: number, call?: CallOptions): Promise<number> {
    const opts = this.opts(call);
    const auth = await this.getAuth("wsfe", opts);
    return this.wsfe.ultimoComprobante(auth, ptoVta, cbteTipo, opts);
  }

  /** Siguiente número de comprobante (último + 1). */
  async siguienteComprobante(
    ptoVta: number,
    cbteTipo: number,
    call?: CallOptions
  ): Promise<number> {
    const ultimo = await this.ultimoComprobante(ptoVta, cbteTipo, call);
    return ultimo + 1;
  }

  /** Crea factura obteniendo el número automáticamente (API raw). */
  async crearFacturaAuto(
    ptoVta: number,
    cbteTipo: number,
    invoice: Omit<InvoiceDetail, "CbteDesde" | "CbteHasta">,
    call?: CallOptions
  ): Promise<FECAESolicitarResult> {
    const nextNum = await this.siguienteComprobante(ptoVta, cbteTipo, call);
    return this.crearFactura({
      PtoVta: ptoVta,
      CbteTipo: cbteTipo,
      invoices: [{ ...invoice, CbteDesde: nextNum, CbteHasta: nextNum }],
    }, call);
  }

  // ============================================================
  // Facturación - API Simplificada
  // ============================================================

  /**
   * Valida y arma un comprobante sin enviarlo (no usa la red). Si `fecha` no
   * viene, usa la fecha de hoy según el reloj de ARCA (`clockOffsetMs`).
   *
   * Persistí el `intento` antes de enviar: si el proceso se cae o el resultado
   * es incierto, pasalo a `recuperarComprobante`.
   */
  armarComprobante(opts: FacturarOpts & { cbteNro: number }): ComprobanteArmado {
    return armarComprobante(opts, { ahora: this.wsaa.now() });
  }

  /**
   * Crea una factura con API simplificada.
   * Calcula automáticamente IVA y totales. Si no viene `cbteNro`, usa el
   * último autorizado + 1 (sin lock: serializá las emisiones por ptoVta y cbteTipo).
   *
   * - `ArcaWSFEError`: ARCA rechazó el comprobante (no se emitió).
   * - `ArcaResultadoIncierto`: no se sabe si se emitió; usar `recuperarComprobante(error.intento)`.
   * - `aprobada: false`: ARCA respondió con resultado "R" (no se emitió), ver `observaciones`.
   */
  async facturar(opts: FacturarOpts, call?: CallOptions): Promise<FacturaResult> {
    return this.emitirComprobante(opts, call);
  }

  /**
   * Crea una nota de crédito. Tipo de NC inferido del comprobante original.
   */
  async notaCredito(opts: NotaCreditoOpts, call?: CallOptions): Promise<FacturaResult> {
    const cbteTipo = NOTA_CREDITO_MAP[opts.comprobanteOriginal.tipo];
    if (cbteTipo === undefined) {
      throw new ArcaError(
        `No se puede inferir el tipo de Nota de Crédito para CbteTipo ${opts.comprobanteOriginal.tipo}`
      );
    }
    return this.emitirComprobante(this.conAsociado(cbteTipo, opts), call);
  }

  /**
   * Crea una nota de débito. Tipo de ND inferido del comprobante original.
   */
  async notaDebito(opts: NotaDebitoOpts, call?: CallOptions): Promise<FacturaResult> {
    const cbteTipo = NOTA_DEBITO_MAP[opts.comprobanteOriginal.tipo];
    if (cbteTipo === undefined) {
      throw new ArcaError(
        `No se puede inferir el tipo de Nota de Débito para CbteTipo ${opts.comprobanteOriginal.tipo}`
      );
    }
    return this.emitirComprobante(this.conAsociado(cbteTipo, opts), call);
  }

  private conAsociado(
    cbteTipo: number,
    opts: NotaCreditoOpts | NotaDebitoOpts
  ): FacturarOpts {
    const { comprobanteOriginal, ...rest } = opts;
    const asociados: ComprobanteRef[] = [comprobanteOriginal, ...(opts.cbtesAsoc ?? [])];
    return { ...rest, cbteTipo, cbtesAsoc: asociados };
  }

  private async emitirComprobante(opts: FacturarOpts, call?: CallOptions): Promise<FacturaResult> {
    // Validar antes de tocar la red.
    validateFacturarOpts(opts);
    const cbteNro = opts.cbteNro ?? (await this.siguienteComprobante(opts.ptoVta, opts.cbteTipo, call));
    const { request, importes } = this.armarComprobante({ ...opts, cbteNro });
    const result = await this.crearFactura(
      { PtoVta: opts.ptoVta, CbteTipo: opts.cbteTipo, invoices: [request] },
      call
    );
    return parseFacturaResult(result, importes);
  }

  /**
   * Resuelve un resultado incierto (`ArcaResultadoIncierto`) consultando ARCA.
   *
   * - Si el último autorizado es menor que `cbteNro` → `no_emitido`: reintentar
   *   con el mismo `cbteNro` es seguro (si el intento original llegara a
   *   autorizarse después, ARCA rechaza el reintento con el error 10016).
   * - Si no, consulta el comprobante y compara ImpTotal (tolerancia 0,01),
   *   DocTipo, DocNro y CbteFch: si coinciden → `autorizado` con el CAE; si no
   *   → `conflicto` (ese número lo usó otra emisión).
   *
   * Tip: si la respuesta se perdió por timeout, esperar unos segundos antes de
   * llamar: ARCA puede seguir procesando el request original.
   */
  async recuperarComprobante(
    intento: IntentoComprobante,
    call?: CallOptions
  ): Promise<ResultadoRecuperacion> {
    const ultimo = await this.ultimoComprobante(intento.ptoVta, intento.cbteTipo, call);
    if (ultimo < intento.cbteNro) return { estado: "no_emitido" };

    const encontrado = await this.consultarComprobante(
      intento.cbteTipo,
      intento.ptoVta,
      intento.cbteNro,
      call
    );
    if (coincideConIntento(encontrado, intento)) {
      return { estado: "autorizado", resultado: facturaResultDesdeConsulta(encontrado) };
    }
    return { estado: "conflicto", encontrado };
  }

  /** Consulta un comprobante previamente autorizado. */
  async consultarComprobante(
    cbteTipo: number,
    ptoVta: number,
    cbteNro: number,
    call?: CallOptions
  ): Promise<FECompConsultarResult> {
    const opts = this.opts(call);
    const auth = await this.getAuth("wsfe", opts);
    return this.wsfe.consultarComprobante(auth, cbteTipo, ptoVta, cbteNro, opts);
  }

  // ============================================================
  // WSFEX - Facturación de Exportación
  // ============================================================

  /** Autoriza un comprobante de exportación (WSFEX). */
  async crearFacturaExportacion(invoice: WsfexInvoice, call?: CallOptions): Promise<WsfexAuthResult> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfex", callOpts);
    return this.wsfex.authorize(auth, invoice, callOpts);
  }

  /** Último número de comprobante de exportación autorizado. */
  async ultimoComprobanteExpo(
    ptoVta: number,
    cbteTipo: number,
    call?: CallOptions
  ): Promise<number> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfex", callOpts);
    return this.wsfex.getLastCmp(auth, ptoVta, cbteTipo, callOpts);
  }

  /** Siguiente número de comprobante de exportación. */
  async siguienteComprobanteExpo(
    ptoVta: number,
    cbteTipo: number
  ): Promise<number> {
    const ultimo = await this.ultimoComprobanteExpo(ptoVta, cbteTipo);
    return ultimo + 1;
  }

  /** Último ID de request WSFEX. */
  async ultimoIdExpo(call?: CallOptions): Promise<number> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfex", callOpts);
    return this.wsfex.getLastId(auth, callOpts);
  }

  /** Consulta un comprobante de exportación. */
  async consultarComprobanteExpo(
    cbteTipo: number,
    ptoVta: number,
    cbteNro: number,
    call?: CallOptions
  ): Promise<WsfexGetCmpResult> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfex", callOpts);
    return this.wsfex.getCmp(auth, cbteTipo, ptoVta, cbteNro, callOpts);
  }

  /** Estado de los servidores WSFEX. */
  async serverStatusExpo(call?: CallOptions): Promise<ServerStatus> {
    return this.wsfex.serverStatus(this.opts(call));
  }

  /** Tipos de comprobante de exportación. */
  async getTiposCbteExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfex", callOpts);
    return this.wsfex.getTiposCbte(auth, callOpts);
  }

  /** Monedas (WSFEX). */
  async getMonedasExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfex", callOpts);
    return this.wsfex.getMonedas(auth, callOpts);
  }

  /** Países destino de exportación. */
  async getPaisesExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfex", callOpts);
    return this.wsfex.getPaises(auth, callOpts);
  }

  /** Idiomas disponibles (WSFEX). */
  async getIdiomasExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfex", callOpts);
    return this.wsfex.getIdiomas(auth, callOpts);
  }

  /** Incoterms disponibles. */
  async getIncotermsExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfex", callOpts);
    return this.wsfex.getIncoterms(auth, callOpts);
  }

  /** Unidades de medida (WSFEX). */
  async getUMedExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfex", callOpts);
    return this.wsfex.getUMed(auth, callOpts);
  }

  /** Tipos de exportación. */
  async getTiposExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfex", callOpts);
    return this.wsfex.getTiposExpo(auth, callOpts);
  }

  /** CUITs de países. */
  async getCuitsPaisExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfex", callOpts);
    return this.wsfex.getCuitsPais(auth, callOpts);
  }

  /**
   * Crea una factura de exportación con API simplificada.
   * Obtiene automáticamente el ID y número de comprobante.
   */
  async facturarExpo(opts: FacturarExpoOpts, call?: CallOptions): Promise<FacturaExpoResult> {
    validateFacturarExpoOpts(opts);
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfex", callOpts);
    const [lastId, nextNum] = await Promise.all([
      this.wsfex.getLastId(auth, callOpts),
      this.wsfex.getLastCmp(auth, opts.ptoVta, opts.cbteTipo, callOpts).then((n) => n + 1),
    ]);

    const fecha = toDateString(opts.fecha ?? this.wsaa.now());

    const items = opts.items.map((item) => ({
      Pro_codigo: item.codigo,
      Pro_ds: item.descripcion,
      Pro_qty: item.cantidad,
      Pro_umed: item.unidad,
      Pro_precio_uni: item.precioUnitario,
      Pro_bonificacion: item.bonificacion ?? 0,
      Pro_total_item:
        Math.round(
          (item.cantidad * item.precioUnitario - (item.bonificacion ?? 0)) * 100
        ) / 100,
    }));

    const impTotal = Math.round(
      items.reduce((sum, i) => sum + i.Pro_total_item, 0) * 100
    ) / 100;

    // Permiso_existente: "S"/"N" solo para Bienes (1). Servicios (2) y Otros (4) requieren "".
    const esServicios = [2, 4].includes(opts.tipoExpo);
    const permisoExistente = esServicios
      ? ""
      : (opts.permisoExistente ?? "N");

    const invoice: WsfexInvoice = {
      Id: lastId + 1,
      Cbte_Tipo: opts.cbteTipo,
      Fecha_cbte: fecha,
      Punto_vta: opts.ptoVta,
      Cbte_nro: nextNum,
      Tipo_expo: opts.tipoExpo,
      Permiso_existente: permisoExistente,
      Dst_cmp: opts.pais,
      Cliente: opts.cliente.nombre,
      Cuit_pais_cliente: opts.cliente.cuitPais,
      Domicilio_cliente: opts.cliente.domicilio,
      Id_impositivo: opts.cliente.idImpositivo,
      Moneda_Id: opts.moneda,
      Moneda_ctz: opts.cotizacion,
      Idioma_cbte: opts.idioma ?? 1,
      Forma_pago: opts.formaPago,
      Imp_total: impTotal,
      Items: items,
    };

    // Fecha_pago obligatorio para Servicios (2) y Otros (4)
    if (opts.fechaPago) {
      invoice.Fecha_pago = toDateString(opts.fechaPago);
    } else if (esServicios) {
      invoice.Fecha_pago = fecha;
    }

    if (opts.incoterms) invoice.Incoterms = opts.incoterms;
    if (opts.incotermsDes) invoice.Incoterms_Ds = opts.incotermsDes;
    if (opts.obsComerciales) invoice.Obs_comerciales = opts.obsComerciales;
    if (opts.obs) invoice.Obs = opts.obs;
    if (opts.permisos) invoice.Permisos = opts.permisos;
    if (opts.cbtesAsoc) invoice.Cmps_asoc = opts.cbtesAsoc;
    if (opts.canMisMonExt) invoice.CanMisMonExt = opts.canMisMonExt;

    // Emisión: no se reintenta. Un ArcaSoapError con `uncertain: true` significa que
    // no se sabe si quedó autorizada: verificar con consultarComprobanteExpo.
    const result = await this.wsfex.authorize(auth, invoice, callOpts);
    const authResult = result.FEXResultAuth;
    const aprobada = authResult?.Resultado === "A";

    return {
      aprobada,
      cae: aprobada ? authResult?.Cae : undefined,
      caeVencimiento: aprobada ? authResult?.Fch_venc_Cae : undefined,
      cbteNro: Number(authResult?.Cbte_nro ?? nextNum),
      ptoVta: Number(authResult?.Punto_vta ?? opts.ptoVta),
      cbteTipo: Number(authResult?.Cbte_tipo ?? opts.cbteTipo),
      obs: authResult?.Motivos_Obs,
      raw: result,
    };
  }

  // ============================================================
  // CAEA - Autorización Anticipada
  // ============================================================

  /**
   * Solicita un CAEA para un período y quincena.
   * @param periodo - Período en formato YYYYMM
   * @param orden - 1 = primera quincena, 2 = segunda quincena
   */
  async solicitarCAEA(
    periodo: string,
    orden: number,
    call?: CallOptions
  ): Promise<CaeaSolicitarResult> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfe", callOpts);
    return this.wsfe.solicitarCAEA(auth, periodo, orden, callOpts);
  }

  /** Consulta un CAEA previamente solicitado. */
  async consultarCAEA(
    periodo: string,
    orden: number,
    call?: CallOptions
  ): Promise<CaeaSolicitarResult> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfe", callOpts);
    return this.wsfe.consultarCAEA(auth, periodo, orden, callOpts);
  }

  /** Informa comprobantes emitidos con un CAEA. */
  async registrarCAEA(request: CaeaRegInfRequest, call?: CallOptions): Promise<CaeaRegInfResult> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfe", callOpts);
    return this.wsfe.registrarCAEA(auth, request, callOpts);
  }

  /**
   * Registra una factura emitida con CAEA (API simplificada).
   * Equivale a `facturar()` pero usando un CAEA pre-solicitado.
   * Calcula automáticamente IVA, totales, y número de comprobante.
   *
   * @example
   * ```ts
   * const caea = await arca.solicitarCAEA("202604", 1);
   *
   * const result = await arca.registrarFacturaCAEA(caea.CAEA, {
   *   ptoVta: 1,
   *   cbteTipo: CbteTipo.FACTURA_B,
   *   items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
   * });
   * ```
   */
  async registrarFacturaCAEA(
    caea: string,
    opts: FacturarOpts,
    call?: CallOptions
  ): Promise<FacturaResult> {
    if (!caea) throw new ArcaError("Validación: caea es requerido");
    validateFacturarOpts(opts);
    const cbteNro = opts.cbteNro ?? (await this.siguienteComprobante(opts.ptoVta, opts.cbteTipo, call));
    const { request, importes } = this.armarComprobante({ ...opts, cbteNro });

    const result = await this.registrarCAEA({
      PtoVta: opts.ptoVta,
      CbteTipo: opts.cbteTipo,
      invoices: [{ ...request, CAEA: caea }],
    }, call);

    // CaeaRegInfResult usa FECAEADetResponse, adaptar para parseFacturaResult
    const adapted = {
      ...result,
      FeDetResp: {
        FECAEDetResponse: result.FeDetResp.FECAEADetResponse,
      },
    } as FECAESolicitarResult;
    return parseFacturaResult(adapted, importes);
  }

  /** Informa que no hubo movimientos para un CAEA en un punto de venta. */
  async sinMovimientoCAEA(
    caea: string,
    ptoVta: number,
    call?: CallOptions
  ): Promise<CaeaSinMovResult> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfe", callOpts);
    return this.wsfe.sinMovimientoCAEA(auth, caea, ptoVta, callOpts);
  }

  // ============================================================
  // Padrón - Consulta de contribuyentes
  // ============================================================

  /**
   * Consulta datos de un contribuyente por CUIT (padrón A13).
   * Requiere cert con acceso a `ws_sr_padron_a13`.
   *
   * @deprecated Usar `@ramiidv/arca-padron` (`ArcaPadron.getPersonaA13`).
   */
  async consultarCuit(cuit: number, call?: CallOptions): Promise<Contribuyente> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth(PADRON_A13_SERVICE, callOpts);
    return this.padron.getPersonaA13(auth, cuit, callOpts);
  }

  /**
   * Consulta la constancia de inscripción de un contribuyente (ex padrón A5):
   * domicilio fiscal e impuestos. Requiere cert con acceso a
   * `ws_sr_constancia_inscripcion`.
   *
   * @deprecated Usar `@ramiidv/arca-padron` (`ArcaPadron.getConstanciaInscripcion`
   * y `condicionIvaDesdePadron`).
   */
  async consultarCuitDetalle(cuit: number, call?: CallOptions): Promise<Contribuyente> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth(PADRON_A5_SERVICE, callOpts);
    return this.padron.getPersonaA5(auth, cuit, callOpts);
  }

  // ============================================================
  // Estado y parámetros WSFE
  // ============================================================

  private async cachedParam<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.paramCacheTTLMs > 0) {
      const cached = this.paramCache.get(key);
      if (cached && cached.expires > Date.now()) return cached.data as T;
    }
    const data = await fn();
    if (this.paramCacheTTLMs > 0) {
      this.paramCache.set(key, { data, expires: Date.now() + this.paramCacheTTLMs });
    }
    return data;
  }

  /** Estado de los servidores WSFE. No requiere autenticación. */
  async serverStatus(call?: CallOptions): Promise<ServerStatus> {
    return this.wsfe.serverStatus(this.opts(call));
  }

  /** Tipos de comprobante disponibles. Cacheado. */
  async getTiposComprobante(call?: CallOptions): Promise<ParamItem[]> {
    const callOpts = this.opts(call);
    return this.cachedParam("tiposCbte", async () => {
      const auth = await this.getAuth("wsfe", callOpts);
      return this.wsfe.getTiposComprobante(auth, callOpts);
    });
  }

  /** Tipos de concepto (Productos, Servicios, Ambos). Cacheado. */
  async getTiposConcepto(call?: CallOptions): Promise<ParamItem[]> {
    const callOpts = this.opts(call);
    return this.cachedParam("tiposConcepto", async () => {
      const auth = await this.getAuth("wsfe", callOpts);
      return this.wsfe.getTiposConcepto(auth, callOpts);
    });
  }

  /** Tipos de documento disponibles (CUIT, DNI, etc.). Cacheado. */
  async getTiposDocumento(call?: CallOptions): Promise<ParamItem[]> {
    const callOpts = this.opts(call);
    return this.cachedParam("tiposDoc", async () => {
      const auth = await this.getAuth("wsfe", callOpts);
      return this.wsfe.getTiposDocumento(auth, callOpts);
    });
  }

  /** Condiciones de IVA válidas para el receptor. Cacheado. */
  async getCondicionesIva(call?: CallOptions): Promise<ParamItem[]> {
    const callOpts = this.opts(call);
    return this.cachedParam("condicionesIva", async () => {
      const auth = await this.getAuth("wsfe", callOpts);
      return this.wsfe.getCondicionesIva(auth, callOpts);
    });
  }

  /** Alícuotas de IVA disponibles (0%, 2.5%, 5%, 10.5%, 21%, 27%). Cacheado. */
  async getTiposIva(call?: CallOptions): Promise<ParamItem[]> {
    const callOpts = this.opts(call);
    return this.cachedParam("tiposIva", async () => {
      const auth = await this.getAuth("wsfe", callOpts);
      return this.wsfe.getTiposIva(auth, callOpts);
    });
  }

  /** Monedas disponibles. Cacheado. */
  async getMonedas(call?: CallOptions): Promise<MonedaItem[]> {
    const callOpts = this.opts(call);
    return this.cachedParam("monedas", async () => {
      const auth = await this.getAuth("wsfe", callOpts);
      return this.wsfe.getMonedas(auth, callOpts);
    });
  }

  /** Tipos de tributo disponibles. Cacheado. */
  async getTiposTributo(call?: CallOptions): Promise<ParamItem[]> {
    const callOpts = this.opts(call);
    return this.cachedParam("tiposTrib", async () => {
      const auth = await this.getAuth("wsfe", callOpts);
      return this.wsfe.getTiposTributo(auth, callOpts);
    });
  }

  /** Tipos de datos opcionales disponibles. Cacheado. */
  async getTiposOpcional(call?: CallOptions): Promise<ParamItem[]> {
    const callOpts = this.opts(call);
    return this.cachedParam("tiposOpc", async () => {
      const auth = await this.getAuth("wsfe", callOpts);
      return this.wsfe.getTiposOpcional(auth, callOpts);
    });
  }

  /** Puntos de venta habilitados. Cacheado. */
  async getPuntosVenta(call?: CallOptions): Promise<PtoVentaItem[]> {
    const callOpts = this.opts(call);
    return this.cachedParam("ptosVenta", async () => {
      const auth = await this.getAuth("wsfe", callOpts);
      return this.wsfe.getPuntosVenta(auth, callOpts);
    });
  }

  /** Cotización de una moneda. No cacheado (cambia frecuentemente). */
  async getCotizacion(monedaId: string, call?: CallOptions): Promise<CotizacionResult> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfe", callOpts);
    return this.wsfe.getCotizacion(auth, monedaId, callOpts);
  }

  /** Cantidad máxima de registros por request de FECAESolicitar. */
  async getCantMaxRegistros(call?: CallOptions): Promise<number> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth("wsfe", callOpts);
    return this.wsfe.getCantMaxRegistros(auth, callOpts);
  }

  // ============================================================
  // Utilidades estáticas
  // ============================================================

  /**
   * Genera la URL del QR oficial de ARCA para un comprobante autorizado.
   *
   * @example
   * ```ts
   * const url = Arca.generateQRUrl({
   *   fecha: "2026-03-28",
   *   cuit: 20123456789,
   *   ptoVta: 1,
   *   tipoCmp: CbteTipo.FACTURA_B,
   *   nroCmp: 150,
   *   importe: 121,
   *   moneda: "PES",
   *   ctz: 1,
   *   tipoDocRec: DocTipo.CONSUMIDOR_FINAL,
   *   nroDocRec: 0,
   *   codAut: 73429843294823,
   * });
   * ```
   */
  static generateQRUrl(input: QRInput): string {
    const payload = {
      ver: 1,
      fecha: input.fecha,
      cuit: input.cuit,
      ptoVta: input.ptoVta,
      tipoCmp: input.tipoCmp,
      nroCmp: input.nroCmp,
      importe: input.importe,
      moneda: input.moneda,
      ctz: input.ctz,
      tipoDocRec: input.tipoDocRec,
      nroDocRec: input.nroDocRec,
      tipoCodAut: input.tipoCodAut ?? "E",
      codAut: input.codAut,
    };
    const base64 = Buffer.from(JSON.stringify(payload)).toString("base64");
    return `${QR_URL}?p=${base64}`;
  }

  /** Extrae CAE del resultado raw de FECAESolicitar. */
  static extractCAE(result: FECAESolicitarResult): {
    approved: boolean;
    details: FECAEDetResponse[];
    cae?: string;
    caeFchVto?: string;
  } {
    const detArr = Array.isArray(result.FeDetResp.FECAEDetResponse)
      ? result.FeDetResp.FECAEDetResponse
      : [result.FeDetResp.FECAEDetResponse];
    const approved = result.FeCabResp.Resultado === "A";
    const firstApproved = detArr.find((d) => d.Resultado === "A");
    return {
      approved,
      details: detArr,
      cae: firstApproved?.CAE,
      caeFchVto: firstApproved?.CAEFchVto,
    };
  }

  /** Formatea Date a YYYYMMDD (timezone Argentina). */
  static formatDate(date: Date | string): string {
    return toDateString(date);
  }

  /** Calcula importes e IVA desde line items. Para previsualizar sin enviar. */
  static calcularTotales(
    items: LineItem[],
    opts?: { tributos?: { Importe: number }[]; tipoC?: boolean; descuentoGlobal?: number }
  ) {
    return calcularTotales(items, opts);
  }

  /** Invalida los tickets de acceso (en memoria y en el `ticketStorage`). */
  async clearAuthCache(): Promise<void> {
    await Promise.all(
      ["wsfe", "wsfex", PADRON_A5_SERVICE, PADRON_A13_SERVICE].map((s) => this.wsaa.clearTicket(s))
    );
  }

  /** Invalida el cache de parámetros (getTipos*, getMonedas, etc.). */
  clearParamCache(): void {
    this.paramCache.clear();
  }
}
