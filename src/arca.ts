import { WsaaClient } from "./wsaa.js";
import { WsfeClient } from "./wsfe.js";
import {
  buildInvoiceDetail,
  parseFacturaResult,
  toDateString,
  calcularTotales,
} from "./facturacion.js";
import { ArcaError } from "./errors.js";
import type {
  ArcaConfig,
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
  Importes,
} from "./types.js";
import {
  CbteTipo,
  Concepto,
  DocTipo,
  IvaTipo,
  Moneda,
  NOTA_CREDITO_MAP,
  NOTA_DEBITO_MAP,
} from "./constants.js";

export class Arca {
  private wsaa: WsaaClient;
  private wsfe: WsfeClient;
  private cuit: number;
  private production: boolean;

  constructor(config: ArcaConfig) {
    this.cuit = config.cuit;
    this.production = config.production ?? false;
    const timeoutMs = config.requestTimeoutMs ?? 30_000;

    this.wsaa = new WsaaClient({
      cert: config.cert,
      key: config.key,
      production: this.production,
      tokenTTLMinutes: config.tokenTTLMinutes ?? 720,
      timeoutMs,
    });

    this.wsfe = new WsfeClient(this.production, timeoutMs);
  }

  // ============================================================
  // Auth helpers
  // ============================================================

  /**
   * Obtiene las credenciales de autenticación para WSFE.
   */
  private async getAuth(): Promise<WsfeAuth> {
    const ticket = await this.wsaa.getAccessTicket("wsfe");
    return {
      Token: ticket.token,
      Sign: ticket.sign,
      Cuit: this.cuit,
    };
  }

  // ============================================================
  // Facturación - Métodos principales
  // ============================================================

  /**
   * Crea una factura y obtiene el CAE.
   *
   * @example
   * ```ts
   * const result = await arca.crearFactura({
   *   PtoVta: 1,
   *   CbteTipo: CbteTipo.FACTURA_B,
   *   invoices: [{
   *     Concepto: Concepto.PRODUCTOS,
   *     DocTipo: DocTipo.CONSUMIDOR_FINAL,
   *     DocNro: 0,
   *     CbteDesde: nextNum,
   *     CbteHasta: nextNum,
   *     CbteFch: "20260328",
   *     ImpTotal: 121,
   *     ImpTotConc: 0,
   *     ImpNeto: 100,
   *     ImpOpEx: 0,
   *     ImpTrib: 0,
   *     ImpIVA: 21,
   *     MonId: Moneda.PESOS,
   *     MonCotiz: 1,
   *     Iva: [{ Id: IvaTipo.IVA_21, BaseImp: 100, Importe: 21 }],
   *   }],
   * });
   * ```
   */
  async crearFactura(request: InvoiceRequest): Promise<FECAESolicitarResult> {
    const auth = await this.getAuth();
    return this.wsfe.solicitarCAE(auth, request);
  }

  /**
   * Obtiene el último número de comprobante autorizado.
   * Útil para calcular el siguiente número antes de crear una factura.
   */
  async ultimoComprobante(ptoVta: number, cbteTipo: number): Promise<number> {
    const auth = await this.getAuth();
    return this.wsfe.ultimoComprobante(auth, ptoVta, cbteTipo);
  }

  /**
   * Obtiene el siguiente número de comprobante (último + 1).
   */
  async siguienteComprobante(
    ptoVta: number,
    cbteTipo: number
  ): Promise<number> {
    const ultimo = await this.ultimoComprobante(ptoVta, cbteTipo);
    return ultimo + 1;
  }

  /**
   * Crea una factura automáticamente calculando el siguiente número de comprobante.
   * Simplifica el flujo más común: obtener número → crear factura.
   */
  async crearFacturaAuto(
    ptoVta: number,
    cbteTipo: number,
    invoice: Omit<InvoiceDetail, "CbteDesde" | "CbteHasta">
  ): Promise<FECAESolicitarResult> {
    const nextNum = await this.siguienteComprobante(ptoVta, cbteTipo);

    return this.crearFactura({
      PtoVta: ptoVta,
      CbteTipo: cbteTipo,
      invoices: [
        {
          ...invoice,
          CbteDesde: nextNum,
          CbteHasta: nextNum,
        },
      ],
    });
  }

  // ============================================================
  // Facturación - API Simplificada
  // ============================================================

  /**
   * Crea una factura con API simplificada.
   * Calcula automáticamente IVA, totales, y número de comprobante.
   *
   * @example
   * ```ts
   * const result = await arca.facturar({
   *   ptoVta: 1,
   *   cbteTipo: CbteTipo.FACTURA_B,
   *   items: [
   *     { neto: 1000, iva: IvaTipo.IVA_21 },
   *     { neto: 500, iva: IvaTipo.IVA_10_5 },
   *   ],
   * });
   *
   * if (result.aprobada) {
   *   console.log(`CAE: ${result.cae}, Cbte: ${result.cbteNro}`);
   * }
   * ```
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
   * Crea una nota de crédito asociada a un comprobante original.
   * El tipo de NC se infiere automáticamente del tipo del comprobante original.
   *
   * @example
   * ```ts
   * const result = await arca.notaCredito({
   *   ptoVta: 1,
   *   comprobanteOriginal: {
   *     tipo: CbteTipo.FACTURA_B,
   *     ptoVta: 1,
   *     nro: 5,
   *   },
   *   items: [{ neto: 500, iva: IvaTipo.IVA_21 }],
   * });
   * ```
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
   * Crea una nota de débito asociada a un comprobante original.
   * El tipo de ND se infiere automáticamente del tipo del comprobante original.
   *
   * @example
   * ```ts
   * const result = await arca.notaDebito({
   *   ptoVta: 1,
   *   comprobanteOriginal: {
   *     tipo: CbteTipo.FACTURA_A,
   *     ptoVta: 1,
   *     nro: 10,
   *     fecha: "20260301",
   *   },
   *   docTipo: DocTipo.CUIT,
   *   docNro: 20123456789,
   *   items: [{ neto: 200, iva: IvaTipo.IVA_21 }],
   * });
   * ```
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
    const fullOpts: FacturarOpts = {
      ...opts,
      cbteTipo,
    };

    const nextNum = await this.siguienteComprobante(opts.ptoVta, cbteTipo);
    const { detail, importes } = buildInvoiceDetail(fullOpts, nextNum);

    // Agregar comprobante asociado
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

  /**
   * Consulta un comprobante previamente autorizado.
   */
  async consultarComprobante(
    cbteTipo: number,
    ptoVta: number,
    cbteNro: number
  ): Promise<FECompConsultarResult> {
    const auth = await this.getAuth();
    return this.wsfe.consultarComprobante(auth, cbteTipo, ptoVta, cbteNro);
  }

  // ============================================================
  // Estado y parámetros
  // ============================================================

  /**
   * Verifica el estado de los servidores de ARCA.
   * No requiere autenticación.
   */
  async serverStatus(): Promise<ServerStatus> {
    return this.wsfe.serverStatus();
  }

  /** Obtiene los tipos de comprobante disponibles. */
  async getTiposComprobante(): Promise<ParamItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getTiposComprobante(auth);
  }

  /** Obtiene los tipos de concepto disponibles (Productos, Servicios, Productos y Servicios). */
  async getTiposConcepto(): Promise<ParamItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getTiposConcepto(auth);
  }

  /** Obtiene los tipos de documento disponibles. */
  async getTiposDocumento(): Promise<ParamItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getTiposDocumento(auth);
  }

  /** Obtiene los tipos de IVA disponibles. */
  async getTiposIva(): Promise<ParamItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getTiposIva(auth);
  }

  /** Obtiene las monedas disponibles. */
  async getMonedas(): Promise<MonedaItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getMonedas(auth);
  }

  /** Obtiene los tipos de tributo disponibles. */
  async getTiposTributo(): Promise<ParamItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getTiposTributo(auth);
  }

  /** Obtiene los tipos de datos opcionales disponibles. */
  async getTiposOpcional(): Promise<ParamItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getTiposOpcional(auth);
  }

  /** Obtiene los puntos de venta habilitados. */
  async getPuntosVenta(): Promise<PtoVentaItem[]> {
    const auth = await this.getAuth();
    return this.wsfe.getPuntosVenta(auth);
  }

  /** Obtiene la cotización de una moneda. */
  async getCotizacion(monedaId: string): Promise<CotizacionResult> {
    const auth = await this.getAuth();
    return this.wsfe.getCotizacion(auth, monedaId);
  }

  /** Obtiene la cantidad máxima de registros por request. */
  async getCantMaxRegistros(): Promise<number> {
    const auth = await this.getAuth();
    return this.wsfe.getCantMaxRegistros(auth);
  }

  // ============================================================
  // Utilidades
  // ============================================================

  /**
   * Extrae el CAE y detalles de respuesta de FECAESolicitar.
   * Helper para simplificar el procesamiento del resultado.
   */
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

  /**
   * Formatea una fecha Date a formato YYYYMMDD requerido por ARCA.
   * Usa timezone America/Argentina/Buenos_Aires.
   */
  static formatDate(date: Date | string): string {
    return toDateString(date);
  }

  /**
   * Calcula los importes de una factura a partir de line items.
   * Útil para previsualizar totales antes de enviar a ARCA.
   *
   * @example
   * ```ts
   * const { importes } = Arca.calcularTotales([
   *   { neto: 1000, iva: IvaTipo.IVA_21 },
   *   { neto: 500, iva: IvaTipo.IVA_10_5 },
   * ]);
   * console.log(importes.total); // 1762.5
   * ```
   */
  static calcularTotales(
    items: LineItem[],
    opts?: { tributos?: { Importe: number }[]; tipoC?: boolean }
  ) {
    return calcularTotales(items, opts);
  }

  /**
   * Invalida los tickets de acceso cacheados.
   */
  clearAuthCache(): void {
    this.wsaa.clearTicket("wsfe");
  }
}
