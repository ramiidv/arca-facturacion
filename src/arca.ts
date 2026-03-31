import { EventEmitter } from "node:events";
import { WsaaClient } from "./wsaa.js";
import { WsfeClient } from "./wsfe.js";
import { WsfexClient } from "./wsfex.js";
import { PadronClient } from "./padron.js";
import {
  buildInvoiceDetail,
  parseFacturaResult,
  toDateString,
  calcularTotales,
} from "./facturacion.js";
import { ArcaError } from "./errors.js";
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
  CaeaSinMovResult,
  Contribuyente,
} from "./types.js";
import { NOTA_CREDITO_MAP, NOTA_DEBITO_MAP } from "./constants.js";

export class Arca {
  private wsaa: WsaaClient;
  private wsfe: WsfeClient;
  private wsfex: WsfexClient;
  private padron: PadronClient;
  private cuit: number;
  private production: boolean;
  private emitter = new EventEmitter();
  private onEventCb?: (event: ArcaEvent) => void;

  constructor(config: ArcaConfig) {
    this.cuit = config.cuit;
    this.production = config.production ?? false;
    this.onEventCb = config.onEvent;

    const timeoutMs = config.requestTimeoutMs ?? 30_000;
    const retries = config.retries ?? 1;
    const retryDelayMs = config.retryDelayMs ?? 1_000;

    const emit = (event: ArcaEvent) => {
      this.onEventCb?.(event);
      this.emitter.emit(event.type, event);
    };

    const clientOpts = { timeoutMs, retries, retryDelayMs, onEvent: emit };

    this.wsaa = new WsaaClient({
      cert: config.cert,
      key: config.key,
      production: this.production,
      tokenTTLMinutes: config.tokenTTLMinutes ?? 720,
      ...clientOpts,
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

  private async getAuth(service: string = "wsfe"): Promise<WsfeAuth> {
    const ticket = await this.wsaa.getAccessTicket(service);
    return {
      Token: ticket.token,
      Sign: ticket.sign,
      Cuit: this.cuit,
    };
  }

  // ============================================================
  // Facturación - Métodos principales (raw)
  // ============================================================

  /** Solicita CAE para uno o más comprobantes (API raw). */
  async crearFactura(request: InvoiceRequest): Promise<FECAESolicitarResult> {
    const auth = await this.getAuth();
    return this.wsfe.solicitarCAE(auth, request);
  }

  /** Último número de comprobante autorizado. */
  async ultimoComprobante(ptoVta: number, cbteTipo: number): Promise<number> {
    const auth = await this.getAuth();
    return this.wsfe.ultimoComprobante(auth, ptoVta, cbteTipo);
  }

  /** Siguiente número de comprobante (último + 1). */
  async siguienteComprobante(
    ptoVta: number,
    cbteTipo: number
  ): Promise<number> {
    const ultimo = await this.ultimoComprobante(ptoVta, cbteTipo);
    return ultimo + 1;
  }

  /** Crea factura obteniendo el número automáticamente (API raw). */
  async crearFacturaAuto(
    ptoVta: number,
    cbteTipo: number,
    invoice: Omit<InvoiceDetail, "CbteDesde" | "CbteHasta">
  ): Promise<FECAESolicitarResult> {
    const nextNum = await this.siguienteComprobante(ptoVta, cbteTipo);
    return this.crearFactura({
      PtoVta: ptoVta,
      CbteTipo: cbteTipo,
      invoices: [{ ...invoice, CbteDesde: nextNum, CbteHasta: nextNum }],
    });
  }

  // ============================================================
  // Facturación - API Simplificada
  // ============================================================

  /**
   * Crea una factura con API simplificada.
   * Calcula automáticamente IVA, totales, y número de comprobante.
   */
  async facturar(opts: FacturarOpts): Promise<FacturaResult> {
    const nextNum = await this.siguienteComprobante(opts.ptoVta, opts.cbteTipo);
    const { detail, importes } = buildInvoiceDetail(opts, nextNum);
    const result = await this.crearFactura({
      PtoVta: opts.ptoVta,
      CbteTipo: opts.cbteTipo,
      invoices: [detail],
    });
    return parseFacturaResult(result, importes);
  }

  /**
   * Crea una nota de crédito. Tipo de NC inferido del comprobante original.
   */
  async notaCredito(opts: NotaCreditoOpts): Promise<FacturaResult> {
    const cbteTipo = NOTA_CREDITO_MAP[opts.comprobanteOriginal.tipo];
    if (cbteTipo === undefined) {
      throw new ArcaError(
        `No se puede inferir el tipo de Nota de Crédito para CbteTipo ${opts.comprobanteOriginal.tipo}`
      );
    }
    return this.facturarConAsociado(cbteTipo, opts);
  }

  /**
   * Crea una nota de débito. Tipo de ND inferido del comprobante original.
   */
  async notaDebito(opts: NotaDebitoOpts): Promise<FacturaResult> {
    const cbteTipo = NOTA_DEBITO_MAP[opts.comprobanteOriginal.tipo];
    if (cbteTipo === undefined) {
      throw new ArcaError(
        `No se puede inferir el tipo de Nota de Débito para CbteTipo ${opts.comprobanteOriginal.tipo}`
      );
    }
    return this.facturarConAsociado(cbteTipo, opts);
  }

  private async facturarConAsociado(
    cbteTipo: number,
    opts: NotaCreditoOpts | NotaDebitoOpts
  ): Promise<FacturaResult> {
    const orig = opts.comprobanteOriginal;
    const fullOpts: FacturarOpts = { ...opts, cbteTipo };

    const nextNum = await this.siguienteComprobante(opts.ptoVta, cbteTipo);
    const { detail, importes } = buildInvoiceDetail(fullOpts, nextNum);

    detail.CbtesAsoc = [
      {
        Tipo: orig.tipo,
        PtoVta: orig.ptoVta,
        Nro: orig.nro,
        ...(orig.cuit !== undefined && { Cuit: orig.cuit }),
        ...(orig.fecha !== undefined && { CbteFch: toDateString(orig.fecha) }),
      },
    ];

    const result = await this.crearFactura({
      PtoVta: opts.ptoVta,
      CbteTipo: cbteTipo,
      invoices: [detail],
    });

    return parseFacturaResult(result, importes);
  }

  /** Consulta un comprobante previamente autorizado. */
  async consultarComprobante(
    cbteTipo: number,
    ptoVta: number,
    cbteNro: number
  ): Promise<FECompConsultarResult> {
    const auth = await this.getAuth();
    return this.wsfe.consultarComprobante(auth, cbteTipo, ptoVta, cbteNro);
  }

  // ============================================================
  // WSFEX - Facturación de Exportación
  // ============================================================

  /** Autoriza un comprobante de exportación (WSFEX). */
  async crearFacturaExportacion(
    invoice: WsfexInvoice
  ): Promise<WsfexAuthResult> {
    const auth = await this.getAuth("wsfex");
    return this.wsfex.authorize(auth, invoice);
  }

  /** Último número de comprobante de exportación autorizado. */
  async ultimoComprobanteExpo(
    ptoVta: number,
    cbteTipo: number
  ): Promise<number> {
    const auth = await this.getAuth("wsfex");
    return this.wsfex.getLastCmp(auth, ptoVta, cbteTipo);
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
  async ultimoIdExpo(): Promise<number> {
    const auth = await this.getAuth("wsfex");
    return this.wsfex.getLastId(auth);
  }

  /** Consulta un comprobante de exportación. */
  async consultarComprobanteExpo(
    cbteTipo: number,
    ptoVta: number,
    cbteNro: number
  ): Promise<WsfexGetCmpResult> {
    const auth = await this.getAuth("wsfex");
    return this.wsfex.getCmp(auth, cbteTipo, ptoVta, cbteNro);
  }

  /** Estado de los servidores WSFEX. */
  async serverStatusExpo(): Promise<ServerStatus> {
    return this.wsfex.serverStatus();
  }

  /** Tipos de comprobante de exportación. */
  async getTiposCbteExpo(): Promise<WsfexParamItem[]> {
    const auth = await this.getAuth("wsfex");
    return this.wsfex.getTiposCbte(auth);
  }

  /** Monedas (WSFEX). */
  async getMonedasExpo(): Promise<WsfexParamItem[]> {
    const auth = await this.getAuth("wsfex");
    return this.wsfex.getMonedas(auth);
  }

  /** Países destino de exportación. */
  async getPaisesExpo(): Promise<WsfexParamItem[]> {
    const auth = await this.getAuth("wsfex");
    return this.wsfex.getPaises(auth);
  }

  /** Idiomas disponibles (WSFEX). */
  async getIdiomasExpo(): Promise<WsfexParamItem[]> {
    const auth = await this.getAuth("wsfex");
    return this.wsfex.getIdiomas(auth);
  }

  /** Incoterms disponibles. */
  async getIncotermsExpo(): Promise<WsfexParamItem[]> {
    const auth = await this.getAuth("wsfex");
    return this.wsfex.getIncoterms(auth);
  }

  /** Unidades de medida (WSFEX). */
  async getUMedExpo(): Promise<WsfexParamItem[]> {
    const auth = await this.getAuth("wsfex");
    return this.wsfex.getUMed(auth);
  }

  /** Tipos de exportación. */
  async getTiposExpo(): Promise<WsfexParamItem[]> {
    const auth = await this.getAuth("wsfex");
    return this.wsfex.getTiposExpo(auth);
  }

  /** CUITs de países. */
  async getCuitsPaisExpo(): Promise<WsfexParamItem[]> {
    const auth = await this.getAuth("wsfex");
    return this.wsfex.getCuitsPais(auth);
  }

  /**
   * Crea una factura de exportación con API simplificada.
   * Obtiene automáticamente el ID y número de comprobante.
   */
  async facturarExpo(opts: FacturarExpoOpts): Promise<FacturaExpoResult> {
    const auth = await this.getAuth("wsfex");
    const [lastId, nextNum] = await Promise.all([
      this.wsfex.getLastId(auth),
      this.wsfex.getLastCmp(auth, opts.ptoVta, opts.cbteTipo).then((n) => n + 1),
    ]);

    const fecha = opts.fecha ? toDateString(opts.fecha) : toDateString(new Date());

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

    const invoice: WsfexInvoice = {
      Id: lastId + 1,
      Cbte_Tipo: opts.cbteTipo,
      Fecha_cbte: fecha,
      Punto_vta: opts.ptoVta,
      Cbte_nro: nextNum,
      Tipo_expo: opts.tipoExpo,
      Permiso_existente: opts.permisoExistente ?? "N",
      Dst_cmp: opts.pais,
      Cliente: opts.cliente.nombre,
      Cuit_pais_cliente: opts.cliente.cuitPais,
      Domicilio_cliente: opts.cliente.domicilio,
      Id_impositivo: opts.cliente.idImpositivo,
      Moneda_Id: opts.moneda,
      Moneda_ctz: opts.cotizacion,
      Idioma_cbte: opts.idioma ?? 1,
      Forma_pago: opts.formaPago,
      Imp_total: items.reduce((sum, i) => sum + i.Pro_total_item, 0),
      Items: items,
    };

    if (opts.incoterms) invoice.Incoterms = opts.incoterms;
    if (opts.incotermsDes) invoice.Incoterms_Ds = opts.incotermsDes;
    if (opts.obsComerciales) invoice.Obs_comerciales = opts.obsComerciales;
    if (opts.obs) invoice.Obs = opts.obs;
    if (opts.permisos) invoice.Permisos = opts.permisos;
    if (opts.cbtesAsoc) invoice.Cmps_asoc = opts.cbtesAsoc;
    if (opts.fechaPago)
      invoice.Fecha_pago = toDateString(opts.fechaPago);
    if (opts.canMisMonExt) invoice.CanMisMonExt = opts.canMisMonExt;

    const result = await this.wsfex.authorize(auth, invoice);
    const authResult = result.FEXResultAuth;
    const aprobada = authResult?.Resultado === "A";

    return {
      aprobada,
      cae: aprobada ? authResult?.Cae : undefined,
      caeVencimiento: aprobada ? authResult?.Fch_venc_Cae : undefined,
      cbteNro: Number(authResult?.Cbte_nro ?? nextNum),
      ptoVta: Number(authResult?.Punto_vta ?? opts.ptoVta),
      cbteTipo: Number(authResult?.Cbte_tipo ?? opts.cbteTipo),
      obs: authResult?.Obs,
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
    orden: number
  ): Promise<CaeaSolicitarResult> {
    const auth = await this.getAuth();
    return this.wsfe.solicitarCAEA(auth, periodo, orden);
  }

  /** Consulta un CAEA previamente solicitado. */
  async consultarCAEA(
    periodo: string,
    orden: number
  ): Promise<CaeaSolicitarResult> {
    const auth = await this.getAuth();
    return this.wsfe.consultarCAEA(auth, periodo, orden);
  }

  /** Informa comprobantes emitidos con un CAEA. */
  async registrarCAEA(
    request: CaeaRegInfRequest
  ): Promise<FECAESolicitarResult> {
    const auth = await this.getAuth();
    return this.wsfe.registrarCAEA(auth, request);
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
    opts: FacturarOpts
  ): Promise<FacturaResult> {
    const nextNum = await this.siguienteComprobante(opts.ptoVta, opts.cbteTipo);
    const { detail, importes } = buildInvoiceDetail(opts, nextNum);

    const result = await this.registrarCAEA({
      PtoVta: opts.ptoVta,
      CbteTipo: opts.cbteTipo,
      invoices: [{ ...detail, CAEA: caea }],
    });

    return parseFacturaResult(result, importes);
  }

  /** Informa que no hubo movimientos para un CAEA en un punto de venta. */
  async sinMovimientoCAEA(
    caea: string,
    ptoVta: number
  ): Promise<CaeaSinMovResult> {
    const auth = await this.getAuth();
    return this.wsfe.sinMovimientoCAEA(auth, caea, ptoVta);
  }

  // ============================================================
  // Padrón - Consulta de contribuyentes
  // ============================================================

  /**
   * Consulta datos de un contribuyente por CUIT (padrón A13 - básico).
   * Retorna nombre, tipo de persona, estado, impuestos.
   */
  async consultarCuit(cuit: number): Promise<Contribuyente> {
    const auth = await this.getAuth("ws_sr_padron_a13");
    return this.padron.getPersonaA13(auth, cuit);
  }

  /**
   * Consulta datos detallados de un contribuyente (padrón A5).
   * Requiere autorización adicional en el certificado.
   * Incluye domicilio fiscal, actividades, etc.
   */
  async consultarCuitDetalle(cuit: number): Promise<Contribuyente> {
    const auth = await this.getAuth("ws_sr_padron_a5");
    return this.padron.getPersonaA5(auth, cuit);
  }

  // ============================================================
  // Estado y parámetros WSFE
  // ============================================================

  /** Estado de los servidores WSFE. No requiere autenticación. */
  async serverStatus(): Promise<ServerStatus> {
    return this.wsfe.serverStatus();
  }

  async getTiposComprobante(): Promise<ParamItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getTiposComprobante(auth);
  }

  async getTiposConcepto(): Promise<ParamItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getTiposConcepto(auth);
  }

  async getTiposDocumento(): Promise<ParamItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getTiposDocumento(auth);
  }

  /** Obtiene las condiciones de IVA válidas para el receptor. */
  async getCondicionesIva(): Promise<ParamItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getCondicionesIva(auth);
  }

  async getTiposIva(): Promise<ParamItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getTiposIva(auth);
  }

  async getMonedas(): Promise<MonedaItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getMonedas(auth);
  }

  async getTiposTributo(): Promise<ParamItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getTiposTributo(auth);
  }

  async getTiposOpcional(): Promise<ParamItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getTiposOpcional(auth);
  }

  async getPuntosVenta(): Promise<PtoVentaItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getPuntosVenta(auth);
  }

  async getCotizacion(monedaId: string): Promise<CotizacionResult> {
    const auth = await this.getAuth();
    return this.wsfe.getCotizacion(auth, monedaId);
  }

  async getCantMaxRegistros(): Promise<number> {
    const auth = await this.getAuth();
    return this.wsfe.getCantMaxRegistros(auth);
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
    return `https://www.afip.gob.ar/fe/qr/?p=${base64}`;
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
    opts?: { tributos?: { Importe: number }[]; tipoC?: boolean }
  ) {
    return calcularTotales(items, opts);
  }

  /** Invalida los tickets de acceso cacheados. */
  clearAuthCache(): void {
    this.wsaa.clearTicket("wsfe");
    this.wsaa.clearTicket("wsfex");
    this.wsaa.clearTicket("ws_sr_padron_a5");
    this.wsaa.clearTicket("ws_sr_padron_a13");
  }
}
