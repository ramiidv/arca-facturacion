import { EventEmitter } from "node:events";
import { anySignal, ensureArray, formatDate, safeEmit, validateCuit } from "@ramiidv/arca-common";
import type { CallOptions } from "@ramiidv/arca-common";
import { WsaaClient } from "./wsaa.js";
import { WsfeClient } from "./wsfe.js";
import { WsfexClient } from "./wsfex.js";
import { PadronClient } from "./padron.js";
import {
  armarComprobante,
  buildInvoiceDetail,
  coincideConIntento,
  facturaResultDesdeConsulta,
  parseFacturaResult,
  calcularTotales,
  formatFechaHora,
  redondear2,
} from "./facturacion.js";
import { eventosWsfex } from "./wsfex.js";
import { ArcaResultadoInciertoExpo, ArcaSoapError } from "./errors.js";
import {
  fail,
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
  CondicionIvaItem,
  ActividadItem,
  PaisItem,
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
  WsfexCotizacion,
  WsfexPtoVenta,
  FacturarExpoOpts,
  FacturaExpoResult,
  CaeaSolicitarResult,
  CaeaRegInfRequest,
  CaeaRegInfResult,
  CaeaSinMovResult,
  CaeaSinMovItem,
  Contribuyente,
  ComprobanteArmado,
  ComprobanteRef,
  IntentoComprobante,
  ResultadoRecuperacion,
  QROptions,
  FacturarCAEAOpts,
} from "./types.js";
import { generarUrlQR, urlQRDesdeFactura } from "./qr.js";
import type { DatosQR } from "./qr.js";
import {
  CbteTipo,
  NOTA_CREDITO_MAP,
  NOTA_DEBITO_MAP,
  TipoExpo,
  WSAA_SERVICES,
  isTipoC,
  isTipoE,
} from "./constants.js";

/** TTL por defecto del cache de parámetros (24 horas). */
const DEFAULT_PARAM_CACHE_TTL_MS = 24 * 60 * 60_000;

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
  private readonly cuit: number;
  private production: boolean;
  private signal?: AbortSignal;
  private emitter = new EventEmitter();
  private onEventCb?: (event: ArcaEvent) => void;
  private paramCache = new Map<string, { data: unknown; expires: number }>();
  private paramCacheTTLMs: number;

  /**
   * @throws ArcaValidationError si el CUIT no es válido (dígito verificador).
   */
  constructor(config: ArcaConfig) {
    this.cuit = Number(validateCuit(config.cuit));
    this.production = config.production ?? false;
    this.onEventCb = config.onEvent;
    this.signal = config.signal;
    this.paramCacheTTLMs = config.paramCacheTTLMs ?? DEFAULT_PARAM_CACHE_TTL_MS;

    // Los defaults (timeout 30s, 1 reintento, 1s de backoff, TTL 12h) los aplica arca-common.
    const timeoutMs = config.timeout ?? config.requestTimeoutMs;
    const retries = config.retries;
    const retryDelayMs = config.retryDelayMs;
    const endpoints = config.endpoints ?? {};

    // Un listener que lanza nunca debe convertir una respuesta de ARCA en error.
    const emit = (event: ArcaEvent) => {
      safeEmit(this.onEventCb, event);
      safeEmit((e) => this.emitter.emit(e.type, e), event);
    };

    const clientOpts = {
      timeoutMs,
      retries,
      retryDelayMs,
      onEvent: emit,
      fetch: config.fetch,
      legacyTls: config.legacyTls,
    };

    this.wsaa =
      config.wsaa ??
      new WsaaClient({
        cert: config.cert,
        key: config.key,
        production: this.production,
        tokenTTLMinutes: config.tokenTTLMinutes,
        timeout: timeoutMs,
        retries,
        retryDelayMs,
        onEvent: emit,
        ticketStorage: config.ticketStorage,
        clockOffsetMs: config.clockOffsetMs,
        autoClockSkew: config.autoClockSkew,
        loginErrorCooldownMs: config.loginErrorCooldownMs,
        fetch: config.fetch,
        legacyTls: config.legacyTls,
        endpoint: endpoints.wsaa,
      });

    this.wsfe = new WsfeClient(this.production, { ...clientOpts, endpoint: endpoints.wsfe });
    this.wsfex = new WsfexClient(this.production, { ...clientOpts, endpoint: endpoints.wsfex });
    this.padron = new PadronClient(this.production, {
      ...clientOpts,
      endpoints: { padronA5: endpoints.padronA5, padronA13: endpoints.padronA13 },
    });
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

  private async getAuth(service: string, call?: CallOptions): Promise<WsfeAuth> {
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
    const auth = await this.getAuth(WSAA_SERVICES.wsfe, opts);
    return this.wsfe.solicitarCAE(auth, request, opts);
  }

  /** Último número de comprobante autorizado. */
  async ultimoComprobante(ptoVta: number, cbteTipo: number, call?: CallOptions): Promise<number> {
    const opts = this.opts(call);
    const auth = await this.getAuth(WSAA_SERVICES.wsfe, opts);
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
    this.rechazarClaseE(opts, "Crédito");
    const cbteTipo = NOTA_CREDITO_MAP[opts.comprobanteOriginal?.tipo];
    if (cbteTipo === undefined) {
      fail(
        "comprobanteOriginal.tipo",
        `No se puede inferir el tipo de Nota de Crédito para CbteTipo ${opts.comprobanteOriginal?.tipo}`,
        opts.comprobanteOriginal?.tipo
      );
    }
    return this.emitirComprobante(this.conAsociado(cbteTipo, opts), call);
  }

  /**
   * Crea una nota de débito. Tipo de ND inferido del comprobante original.
   */
  async notaDebito(opts: NotaDebitoOpts, call?: CallOptions): Promise<FacturaResult> {
    this.rechazarClaseE(opts, "Débito");
    const cbteTipo = NOTA_DEBITO_MAP[opts.comprobanteOriginal?.tipo];
    if (cbteTipo === undefined) {
      fail(
        "comprobanteOriginal.tipo",
        `No se puede inferir el tipo de Nota de Débito para CbteTipo ${opts.comprobanteOriginal?.tipo}`,
        opts.comprobanteOriginal?.tipo
      );
    }
    return this.emitirComprobante(this.conAsociado(cbteTipo, opts), call);
  }

  /** Las NC/ND de exportación (clase E) van por WSFEX, no por WSFEv1. */
  private rechazarClaseE(opts: NotaCreditoOpts | NotaDebitoOpts, clase: "Crédito" | "Débito"): void {
    const tipo = opts.comprobanteOriginal?.tipo;
    if (tipo !== undefined && isTipoE(tipo)) {
      const destino = clase === "Crédito" ? CbteTipo.NOTA_CREDITO_E : CbteTipo.NOTA_DEBITO_E;
      fail(
        "comprobanteOriginal.tipo",
        `las Notas de ${clase} de exportación (tipo ${destino}) se emiten por WSFEX: usar ` +
          `facturarExpo({ cbteTipo: ${destino}, cbtesAsoc: [...] })`,
        tipo
      );
    }
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
    const { detail, importes } = await this.prepararComprobante(opts, call);
    const result = await this.crearFactura(
      { PtoVta: opts.ptoVta, CbteTipo: opts.cbteTipo, invoices: [detail] },
      call
    );
    return parseFacturaResult(result, importes, { moneda: detail.MonId, cotizacion: detail.MonCotiz, tipoCodAut: "E" });
  }

  /**
   * Valida (antes de tocar la red), resuelve el número y arma el detalle.
   * Los importes se calculan antes de consultar el último comprobante, así un
   * descuento inválido no gasta una consulta.
   */
  private async prepararComprobante(opts: FacturarOpts, call?: CallOptions, ahora: Date = this.wsaa.now()) {
    validateFacturarOpts(opts);
    calcularTotales(opts.items, { descuentoGlobal: opts.descuentoGlobal, tipoC: isTipoC(opts.cbteTipo) });
    const cbteNro = opts.cbteNro ?? (await this.siguienteComprobante(opts.ptoVta, opts.cbteTipo, call));
    return buildInvoiceDetail(opts, cbteNro, ahora);
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
    const auth = await this.getAuth(WSAA_SERVICES.wsfe, opts);
    return this.wsfe.consultarComprobante(auth, cbteTipo, ptoVta, cbteNro, opts);
  }


  // ============================================================
  // WSFEX - Facturación de Exportación
  // ============================================================

  /**
   * Autoriza un comprobante de exportación (WSFEX, API raw). No se reintenta.
   *
   * - `ArcaResultadoInciertoExpo`: no se sabe si se autorizó. Reenviar el mismo
   *   request con el mismo `Id` (`crearFacturaExportacion(error.request)`):
   *   WSFEX devuelve `Reproceso = "S"` si ya estaba autorizado.
   * - `ArcaWSFEError`: WSFEX rechazó el request.
   */
  async crearFacturaExportacion(invoice: WsfexInvoice, call?: CallOptions): Promise<WsfexAuthResult> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth(WSAA_SERVICES.wsfex, callOpts);
    return this.wsfex.authorize(auth, invoice, callOpts);
  }

  /** Último número de comprobante de exportación autorizado. */
  async ultimoComprobanteExpo(ptoVta: number, cbteTipo: number, call?: CallOptions): Promise<number> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth(WSAA_SERVICES.wsfex, callOpts);
    return this.wsfex.getLastCmp(auth, ptoVta, cbteTipo, callOpts);
  }

  /** Siguiente número de comprobante de exportación. */
  async siguienteComprobanteExpo(ptoVta: number, cbteTipo: number, call?: CallOptions): Promise<number> {
    const ultimo = await this.ultimoComprobanteExpo(ptoVta, cbteTipo, call);
    return ultimo + 1;
  }

  /** Último ID de request WSFEX. */
  async ultimoIdExpo(call?: CallOptions): Promise<number> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth(WSAA_SERVICES.wsfex, callOpts);
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
    const auth = await this.getAuth(WSAA_SERVICES.wsfex, callOpts);
    return this.wsfex.getCmp(auth, cbteTipo, ptoVta, cbteNro, callOpts);
  }

  /** Estado de los servidores WSFEX. */
  async serverStatusExpo(call?: CallOptions): Promise<ServerStatus> {
    return this.wsfex.serverStatus(this.opts(call));
  }

  private async expo<T>(fn: (auth: WsfeAuth, opts: CallOptions) => Promise<T>, call?: CallOptions): Promise<T> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth(WSAA_SERVICES.wsfex, callOpts);
    return fn(auth, callOpts);
  }

  /** Tipos de comprobante de exportación. */
  async getTiposCbteExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    return this.expo((a, o) => this.wsfex.getTiposCbte(a, o), call);
  }

  /** Monedas (WSFEX). */
  async getMonedasExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    return this.expo((a, o) => this.wsfex.getMonedas(a, o), call);
  }

  /** Monedas con su cotización (`FEXGetPARAM_MON_CON_COTIZACION`). `fecha`: fecha de la cotización (opcional). */
  async getMonedasConCotizacionExpo(call?: CallOptions & { fecha?: Date | string }): Promise<WsfexParamItem[]> {
    const fecha = call?.fecha !== undefined ? formatDate(call.fecha) : undefined;
    return this.expo((a, o) => this.wsfex.getMonedasConCotizacion(a, { ...o, fechaCtz: fecha }), call);
  }

  /** Cotización de una moneda en WSFEX (`FEXGetPARAM_Ctz`). `fecha`: fecha de la cotización (opcional). */
  async getCotizacionExpo(monedaId: string, call?: CallOptions & { fecha?: Date | string }): Promise<WsfexCotizacion> {
    const fecha = call?.fecha !== undefined ? formatDate(call.fecha) : undefined;
    return this.expo((a, o) => this.wsfex.getCotizacion(a, monedaId, { ...o, fchCotiz: fecha }), call);
  }

  /** Verifica un permiso de embarque (`FEXCheck_Permiso`). Devuelve el `Status` de ARCA. */
  async checkPermisoExpo(idPermiso: string, dstMerc: number, call?: CallOptions): Promise<string> {
    return this.expo((a, o) => this.wsfex.checkPermiso(a, idPermiso, dstMerc, o), call);
  }

  /** Países destino de exportación. */
  async getPaisesExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    return this.expo((a, o) => this.wsfex.getPaises(a, o), call);
  }

  /** Idiomas disponibles (WSFEX). */
  async getIdiomasExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    return this.expo((a, o) => this.wsfex.getIdiomas(a, o), call);
  }

  /** Incoterms disponibles. */
  async getIncotermsExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    return this.expo((a, o) => this.wsfex.getIncoterms(a, o), call);
  }

  /** Unidades de medida (WSFEX). */
  async getUMedExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    return this.expo((a, o) => this.wsfex.getUMed(a, o), call);
  }

  /** Tipos de exportación. */
  async getTiposExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    return this.expo((a, o) => this.wsfex.getTiposExpo(a, o), call);
  }

  /** CUITs de países. */
  async getCuitsPaisExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    return this.expo((a, o) => this.wsfex.getCuitsPais(a, o), call);
  }

  /** Puntos de venta habilitados para exportación (`FEXGetPARAM_PtoVenta`). No se cachea. */
  async getPuntosVentaExpo(call?: CallOptions): Promise<WsfexPtoVenta[]> {
    return this.expo((a, o) => this.wsfex.getPuntosVenta(a, o), call);
  }

  /** Tipos de datos opcionales de exportación (`FEXGetPARAM_Opcionales`). */
  async getOpcionalesExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    return this.expo((a, o) => this.wsfex.getOpcionales(a, o), call);
  }

  /** Actividades del emisor para exportación (`FEXGetPARAM_Actividades`). */
  async getActividadesExpo(call?: CallOptions): Promise<WsfexParamItem[]> {
    return this.expo((a, o) => this.wsfex.getActividades(a, o), call);
  }

  /**
   * Crea un comprobante de exportación (Factura, NC o ND E) con API simplificada.
   * Si no vienen `id` y `cbteNro`, usa último + 1 (sin lock: serializá las
   * emisiones por ptoVta y cbteTipo).
   *
   * - `ArcaResultadoInciertoExpo`: no se sabe si se autorizó. Reenviar con
   *   `facturarExpo({ ...opts, ...error.intento })` (mismo `id`, `cbteNro` y
   *   `fecha`): WSFEX responde `reproceso: true` si ya estaba autorizado.
   * - `ArcaWSFEError`: WSFEX rechazó el comprobante.
   * - `aprobada: false`: resultado "R", ver `obs`.
   */
  async facturarExpo(opts: FacturarExpoOpts, call?: CallOptions): Promise<FacturaExpoResult> {
    validateFacturarExpoOpts(opts);
    const callOpts = this.opts(call);
    const auth = await this.getAuth(WSAA_SERVICES.wsfex, callOpts);
    const [id, cbteNro] = await Promise.all([
      opts.id ?? this.wsfex.getLastId(auth, callOpts).then((n) => n + 1),
      opts.cbteNro ?? this.wsfex.getLastCmp(auth, opts.ptoVta, opts.cbteTipo, callOpts).then((n) => n + 1),
    ]);

    const fecha = formatDate(opts.fecha ?? this.wsaa.now());

    let totalCents = 0;
    const items = opts.items.map((item) => {
      const totalItem = redondear2(item.cantidad * item.precioUnitario - (item.bonificacion ?? 0));
      totalCents += Math.round(totalItem * 100);
      return {
        Pro_codigo: item.codigo,
        Pro_ds: item.descripcion,
        Pro_qty: item.cantidad,
        Pro_umed: item.unidad,
        Pro_precio_uni: item.precioUnitario,
        Pro_bonificacion: item.bonificacion ?? 0,
        Pro_total_item: totalItem,
      };
    });
    if (totalCents < 0) fail("items", "el total de los items no puede ser negativo");

    // Permiso_existente: "S"/"N" solo para Factura E (19) de bienes; vacío en el resto
    // (tabla de validación 1720 del manual de WSFEX).
    const esFactura = opts.cbteTipo === CbteTipo.FACTURA_E;
    const esFacturaBienes = esFactura && opts.tipoExpo === TipoExpo.BIENES;
    const esServicios = opts.tipoExpo === TipoExpo.SERVICIOS || opts.tipoExpo === TipoExpo.OTROS;

    const invoice: WsfexInvoice = {
      Id: id,
      Cbte_Tipo: opts.cbteTipo,
      Fecha_cbte: fecha,
      Punto_vta: opts.ptoVta,
      Cbte_nro: cbteNro,
      Tipo_expo: opts.tipoExpo,
      Permiso_existente: esFacturaBienes ? (opts.permisoExistente ?? "N") : "",
      Dst_cmp: opts.pais,
      Cliente: opts.cliente.nombre,
      Cuit_pais_cliente: opts.cliente.cuitPais,
      Domicilio_cliente: opts.cliente.domicilio,
      Id_impositivo: opts.cliente.idImpositivo,
      Moneda_Id: opts.moneda,
      Moneda_ctz: opts.cotizacion,
      Idioma_cbte: opts.idioma ?? 1,
      Forma_pago: opts.formaPago,
      Imp_total: totalCents / 100,
      Items: items,
    };

    // Fecha_pago: solo Factura E (1673); obligatoria para servicios y otros (1672).
    if (esFactura) {
      if (opts.fechaPago !== undefined) invoice.Fecha_pago = formatDate(opts.fechaPago);
      else if (esServicios) invoice.Fecha_pago = fecha;
    }

    if (opts.incoterms) invoice.Incoterms = opts.incoterms;
    if (opts.incotermsDes) invoice.Incoterms_Ds = opts.incotermsDes;
    if (opts.obsComerciales) invoice.Obs_comerciales = opts.obsComerciales;
    if (opts.obs) invoice.Obs = opts.obs;
    if (opts.permisos?.length) invoice.Permisos = opts.permisos;
    if (opts.cbtesAsoc?.length) invoice.Cmps_asoc = opts.cbtesAsoc;
    if (opts.canMisMonExt) invoice.CanMisMonExt = opts.canMisMonExt;
    if (opts.opcionales?.length) invoice.Opcionales = opts.opcionales;
    if (opts.actividades?.length) invoice.Actividades = opts.actividades.map((a) => ({ Id: a }));

    // Emisión: no se reintenta. Un resultado incierto llega como ArcaResultadoInciertoExpo.
    const result = await this.wsfex.authorize(auth, invoice, callOpts);
    const r = result.FEXResultAuth!;
    const aprobada = r.Resultado === "A";
    const cae = aprobada && r.Cae !== undefined && r.Cae !== null && r.Cae !== "" ? String(r.Cae) : undefined;
    if (aprobada && cae === undefined) {
      throw new ArcaResultadoInciertoExpo(invoice, {
        cause: new ArcaSoapError("FEXAuthorize aprobó el comprobante sin informar el CAE", { uncertain: true }),
      });
    }

    return {
      aprobada,
      id: Number(r.Id ?? id),
      reproceso: r.Reproceso === "S",
      fecha,
      cae,
      caeVencimiento: aprobada && r.Fch_venc_Cae ? String(r.Fch_venc_Cae) : undefined,
      cbteNro: Number(r.Cbte_nro),
      ptoVta: Number(r.Punto_vta),
      cbteTipo: Number(r.Cbte_tipo),
      obs: r.Motivos_Obs === undefined || r.Motivos_Obs === null || r.Motivos_Obs === "" ? undefined : String(r.Motivos_Obs),
      eventos: eventosWsfex(result),
      raw: result,
    };
  }

  // ============================================================
  // CAEA - Autorización Anticipada
  // ============================================================

  private validarPeriodoCAEA(periodo: string, orden: number): void {
    const m = /^(\d{4})(\d{2})$/.exec(String(periodo));
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) fail("periodo", "periodo debe tener formato YYYYMM", periodo);
    if (orden !== 1 && orden !== 2) fail("orden", "orden debe ser 1 (primera quincena) o 2 (segunda quincena)", orden);
  }

  /**
   * Solicita un CAEA para un período y quincena. Desde la RG 5782 el CAEA es
   * solo para contingencias (ver README).
   * @param periodo - Período en formato YYYYMM
   * @param orden - 1 = primera quincena, 2 = segunda quincena
   */
  async solicitarCAEA(periodo: string, orden: number, call?: CallOptions): Promise<CaeaSolicitarResult> {
    this.validarPeriodoCAEA(periodo, orden);
    const callOpts = this.opts(call);
    const auth = await this.getAuth(WSAA_SERVICES.wsfe, callOpts);
    return this.wsfe.solicitarCAEA(auth, periodo, orden, callOpts);
  }

  /** Consulta un CAEA previamente solicitado. */
  async consultarCAEA(periodo: string, orden: number, call?: CallOptions): Promise<CaeaSolicitarResult> {
    this.validarPeriodoCAEA(periodo, orden);
    const callOpts = this.opts(call);
    const auth = await this.getAuth(WSAA_SERVICES.wsfe, callOpts);
    return this.wsfe.consultarCAEA(auth, periodo, orden, callOpts);
  }

  /**
   * Informa comprobantes emitidos con un CAEA (API raw). Cada comprobante
   * lleva `CAEA` y `CbteFchHsGen` (yyyymmddhhmmss, obligatorio desde la RG 5782).
   */
  async registrarCAEA(request: CaeaRegInfRequest, call?: CallOptions): Promise<CaeaRegInfResult> {
    validateInvoiceRequest(request);
    request.invoices.forEach((inv, i) => {
      if (!inv.CAEA) fail(`invoices[${i}].CAEA`, "CAEA es requerido");
      if (!inv.CbteFchHsGen)
        fail(`invoices[${i}].CbteFchHsGen`, "CbteFchHsGen (yyyymmddhhmmss) es requerido desde la RG 5782 (validación 1440)");
      formatFechaHora(inv.CbteFchHsGen, `invoices[${i}].CbteFchHsGen`);
    });
    const callOpts = this.opts(call);
    const auth = await this.getAuth(WSAA_SERVICES.wsfe, callOpts);
    return this.wsfe.registrarCAEA(auth, request, callOpts);
  }

  /**
   * Informa un comprobante emitido en contingencia con CAEA (API simplificada).
   * Calcula IVA y totales igual que `facturar()`.
   *
   * - `fechaHoraGeneracion` (obligatorio): cuándo se generó el comprobante en
   *   contingencia (`CbteFchHsGen`). Un `Date` se formatea en hora de Argentina.
   * - `fecha`: fecha del comprobante. Default: la fecha de `fechaHoraGeneracion`
   *   (nunca la fecha del informe).
   * - `cbteNro`: default último autorizado + 1.
   *
   * @example
   * ```ts
   * const result = await arca.registrarFacturaCAEA(caea.CAEA, {
   *   ptoVta: 5,
   *   cbteTipo: CbteTipo.FACTURA_B,
   *   cbteNro: 120,
   *   fechaHoraGeneracion: new Date("2026-11-03T14:32:10-03:00"),
   *   items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
   * });
   * ```
   */
  async registrarFacturaCAEA(caea: string, opts: FacturarCAEAOpts, call?: CallOptions): Promise<FacturaResult> {
    if (!caea) fail("caea", "caea es requerido");
    if (opts.fechaHoraGeneracion === undefined)
      fail(
        "fechaHoraGeneracion",
        "fechaHoraGeneracion (CbteFchHsGen) es requerido: fecha y hora en que se generó el comprobante de contingencia (RG 5782)"
      );
    const hsGen = formatFechaHora(opts.fechaHoraGeneracion, "fechaHoraGeneracion");
    const { fechaHoraGeneracion: _, ...facturarOpts } = opts;
    const fecha = opts.fecha ?? hsGen.slice(0, 8);
    const { detail, importes } = await this.prepararComprobante({ ...facturarOpts, fecha }, call);

    const result = await this.registrarCAEA(
      {
        PtoVta: opts.ptoVta,
        CbteTipo: opts.cbteTipo,
        invoices: [{ ...detail, CAEA: caea, CbteFchHsGen: hsGen }],
      },
      call
    );

    // CaeaRegInfResult usa FECAEADetResponse: adaptar para parseFacturaResult.
    const adapted = {
      ...result,
      FeDetResp: { FECAEDetResponse: result.FeDetResp.FECAEADetResponse },
    } as FECAESolicitarResult;
    return parseFacturaResult(adapted, importes, { moneda: detail.MonId, cotizacion: detail.MonCotiz, tipoCodAut: "A" });
  }

  /**
   * Informa que no hubo movimientos para un CAEA en un punto de venta (emisión,
   * no se reintenta). Si el error es incierto, verificar con `consultarSinMovimientoCAEA`.
   */
  async sinMovimientoCAEA(caea: string, ptoVta: number, call?: CallOptions): Promise<CaeaSinMovResult> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth(WSAA_SERVICES.wsfe, callOpts);
    return this.wsfe.sinMovimientoCAEA(auth, caea, ptoVta, callOpts);
  }

  /** Consulta los puntos de venta informados "sin movimiento" para un CAEA. */
  async consultarSinMovimientoCAEA(caea: string, ptoVta: number, call?: CallOptions): Promise<CaeaSinMovItem[]> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth(WSAA_SERVICES.wsfe, callOpts);
    return this.wsfe.consultarSinMovimientoCAEA(auth, caea, ptoVta, callOpts);
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
    const auth = await this.getAuth(WSAA_SERVICES.padronA13, callOpts);
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
    const auth = await this.getAuth(WSAA_SERVICES.padronA5, callOpts);
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

  private wsfeParam<T>(
    key: string,
    fn: (auth: WsfeAuth, opts: CallOptions) => Promise<T>,
    call?: CallOptions
  ): Promise<T> {
    const callOpts = this.opts(call);
    return this.cachedParam(key, async () => fn(await this.getAuth(WSAA_SERVICES.wsfe, callOpts), callOpts));
  }

  /** Estado de los servidores WSFE. No requiere autenticación. */
  async serverStatus(call?: CallOptions): Promise<ServerStatus> {
    return this.wsfe.serverStatus(this.opts(call));
  }

  /** Tipos de comprobante disponibles. Cacheado. */
  async getTiposComprobante(call?: CallOptions): Promise<ParamItem[]> {
    return this.wsfeParam("tiposCbte", (a, o) => this.wsfe.getTiposComprobante(a, o), call);
  }

  /** Tipos de concepto (Productos, Servicios, Ambos). Cacheado. */
  async getTiposConcepto(call?: CallOptions): Promise<ParamItem[]> {
    return this.wsfeParam("tiposConcepto", (a, o) => this.wsfe.getTiposConcepto(a, o), call);
  }

  /** Tipos de documento disponibles (CUIT, DNI, etc.). Cacheado. */
  async getTiposDocumento(call?: CallOptions): Promise<ParamItem[]> {
    return this.wsfeParam("tiposDoc", (a, o) => this.wsfe.getTiposDocumento(a, o), call);
  }

  /**
   * Condiciones de IVA válidas para el receptor. Cacheado.
   * `claseCmp` (opcional) filtra por clase de comprobante ("A", "B", "C", ...).
   */
  async getCondicionesIva(call?: CallOptions & { claseCmp?: string }): Promise<CondicionIvaItem[]> {
    const clase = call?.claseCmp;
    return this.wsfeParam(`condicionesIva:${clase ?? ""}`, (a, o) => this.wsfe.getCondicionesIva(a, o, clase), call);
  }

  /** Alícuotas de IVA disponibles (0%, 2.5%, 5%, 10.5%, 21%, 27%). Cacheado. */
  async getTiposIva(call?: CallOptions): Promise<ParamItem[]> {
    return this.wsfeParam("tiposIva", (a, o) => this.wsfe.getTiposIva(a, o), call);
  }

  /** Monedas disponibles. Cacheado. */
  async getMonedas(call?: CallOptions): Promise<MonedaItem[]> {
    return this.wsfeParam("monedas", (a, o) => this.wsfe.getMonedas(a, o), call);
  }

  /** Tipos de tributo disponibles. Cacheado. */
  async getTiposTributo(call?: CallOptions): Promise<ParamItem[]> {
    return this.wsfeParam("tiposTrib", (a, o) => this.wsfe.getTiposTributo(a, o), call);
  }

  /** Tipos de datos opcionales disponibles. Cacheado. */
  async getTiposOpcional(call?: CallOptions): Promise<ParamItem[]> {
    return this.wsfeParam("tiposOpc", (a, o) => this.wsfe.getTiposOpcional(a, o), call);
  }

  /** Actividades del emisor (`FEParamGetActividades`). Cacheado. */
  async getActividades(call?: CallOptions): Promise<ActividadItem[]> {
    return this.wsfeParam("actividades", (a, o) => this.wsfe.getActividades(a, o), call);
  }

  /** Países (`FEParamGetTiposPaises`). Cacheado. */
  async getTiposPaises(call?: CallOptions): Promise<PaisItem[]> {
    return this.wsfeParam("tiposPaises", (a, o) => this.wsfe.getTiposPaises(a, o), call);
  }

  /**
   * Puntos de venta habilitados. No se cachea: un punto de venta dado de alta
   * o bloqueado tiene que verse enseguida.
   */
  async getPuntosVenta(call?: CallOptions): Promise<PtoVentaItem[]> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth(WSAA_SERVICES.wsfe, callOpts);
    return this.wsfe.getPuntosVenta(auth, callOpts);
  }

  /**
   * Cotización oficial de una moneda (`FEParamGetCotizacion`). No se cachea.
   * `fecha` (opcional): fecha de la cotización (Date o YYYYMMDD).
   *
   * @example
   * ```ts
   * const { MonCotiz, FchCotiz } = await arca.getCotizacion("DOL");
   * ```
   */
  async getCotizacion(monedaId: string, call?: CallOptions & { fecha?: Date | string }): Promise<CotizacionResult> {
    const fecha = call?.fecha !== undefined ? formatDate(call.fecha) : undefined;
    const callOpts = this.opts(call);
    const auth = await this.getAuth(WSAA_SERVICES.wsfe, callOpts);
    return this.wsfe.getCotizacion(auth, monedaId, { ...callOpts, fchCotiz: fecha });
  }

  /** Cantidad máxima de registros por request de FECAESolicitar. */
  async getCantMaxRegistros(call?: CallOptions): Promise<number> {
    const callOpts = this.opts(call);
    const auth = await this.getAuth(WSAA_SERVICES.wsfe, callOpts);
    return this.wsfe.getCantMaxRegistros(auth, callOpts);
  }

  // ============================================================
  // QR
  // ============================================================

  /**
   * Genera la URL del QR oficial de ARCA para un comprobante autorizado.
   * Ver `generarUrlQR`.
   *
   * @example
   * ```ts
   * const url = Arca.generateQRUrl({
   *   fecha: "2026-03-28",
   *   cuit: 20123456786,
   *   ptoVta: 1,
   *   tipoCmp: CbteTipo.FACTURA_B,
   *   nroCmp: 150,
   *   importe: 121,
   *   moneda: "PES",
   *   ctz: 1,
   *   tipoDocRec: DocTipo.CONSUMIDOR_FINAL,
   *   nroDocRec: 0,
   *   codAut: "73429843294823",
   * });
   * ```
   */
  static generateQRUrl(input: QRInput, options?: QROptions): string {
    return generarUrlQR(input, options);
  }

  /**
   * URL del QR de un comprobante emitido con `facturar`, `notaCredito`,
   * `notaDebito`, `registrarFacturaCAEA` o recuperado con `recuperarComprobante`,
   * usando el CUIT de esta instancia.
   */
  urlQR(factura: FacturaResult, datos?: Omit<DatosQR, "cuit">, options?: QROptions): string {
    return urlQRDesdeFactura(factura, { ...datos, cuit: this.cuit }, options);
  }

  // ============================================================
  // Utilidades estáticas
  // ============================================================

  /**
   * Extrae CAE del resultado raw de FECAESolicitar.
   * @deprecated Usar la API simplificada (`facturar` devuelve `cae`) o leer `FeDetResp` directamente.
   */
  static extractCAE(result: FECAESolicitarResult): {
    approved: boolean;
    details: FECAEDetResponse[];
    cae?: string;
    caeFchVto?: string;
  } {
    const detArr = ensureArray(result.FeDetResp.FECAEDetResponse);
    const approved = result.FeCabResp.Resultado === "A";
    const firstApproved = detArr.find((d) => d.Resultado === "A");
    return {
      approved,
      details: detArr,
      cae: firstApproved?.CAE === undefined ? undefined : String(firstApproved.CAE),
      caeFchVto: firstApproved?.CAEFchVto,
    };
  }

  /**
   * Formatea Date a YYYYMMDD (timezone Argentina).
   * @deprecated Usar `formatDate` de `@ramiidv/arca-common`.
   */
  static formatDate(date: Date | string): string {
    return formatDate(date);
  }

  /**
   * Calcula importes e IVA desde line items. Para previsualizar sin enviar.
   * @deprecated Usar la función `calcularTotales` exportada por el paquete.
   */
  static calcularTotales(
    items: LineItem[],
    opts?: { tributos?: { Importe: number }[]; tipoC?: boolean; descuentoGlobal?: number }
  ) {
    return calcularTotales(items, opts);
  }

  /** Invalida los tickets de acceso (en memoria y en el `ticketStorage`). */
  async clearAuthCache(): Promise<void> {
    await Promise.all(Object.values(WSAA_SERVICES).map((service) => this.wsaa.clearTicket(service)));
  }

  /** Invalida el cache de parámetros (getTipos*, getMonedas, etc.). */
  clearParamCache(): void {
    this.paramCache.clear();
  }
}
