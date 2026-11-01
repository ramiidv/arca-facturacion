// Base errors re-exported from common
export {
  ArcaError,
  ArcaAuthError,
  ArcaSoapError,
  ArcaServiceError,
  ArcaValidationError,
  ArcaTicketVigenteError,
} from "@ramiidv/arca-common";
import { ArcaError, ArcaServiceError } from "@ramiidv/arca-common";
import type { IntentoComprobante, IntentoExpo, WsfexInvoice } from "./types.js";

/**
 * Error de WSFE/WSFEX con códigos de error de ARCA. Extiende `ArcaServiceError`
 * de `@ramiidv/arca-common` (`instanceof ArcaServiceError` también es `true`).
 *
 * En una emisión, este error significa que ARCA **rechazó** el request: no se
 * emitió. Los errores internos de ARCA (WSFEv1: 500, 501, 502; WSFEX: 500,
 * 501, 502, 505) no llegan como este error sino como resultado incierto,
 * porque no garantizan nada.
 *
 * Los rechazos de un comprobante puntual (como 10016, "el número no se
 * corresponde con el próximo a autorizar") llegan como `aprobada: false` con
 * observaciones, no como este error: ver `requiereRecuperacion`.
 */
export class ArcaWSFEError extends ArcaServiceError {
  static override readonly code: string = "ARCA_WSFE_ERROR";
  declare public readonly errors: { code: number; msg: string }[];

  /**
   * @param errors - Errores tal cual los devolvió ARCA.
   * @param servicio - Servicio que respondió (para el mensaje). Default: `WSFE`.
   */
  constructor(errors: { code: number; msg: string }[], servicio: "WSFE" | "WSFEX" = "WSFE") {
    const msg = errors.map((e) => `[${e.code}] ${e.msg}`).join("; ");
    super(`${servicio} Error: ${msg}`, errors);
    this.name = "ArcaWSFEError";
  }

  /** `true` si ARCA devolvió el código de error indicado. */
  tieneCodigo(code: number): boolean {
    return this.errors.some((e) => Number(e.code) === code);
  }
}

/** Operaciones de emisión de WSFEv1 que pueden terminar con resultado incierto. */
export type OperacionEmision = "FECAESolicitar" | "FECAEARegInformativo";

/**
 * No se sabe si ARCA emitió el comprobante: hubo un timeout, un error de red,
 * un HTTP 5xx, la llamada se abortó después de enviarse, o la respuesta no se
 * pudo leer. El SDK **no reintenta** emisiones.
 *
 * Para resolverlo, llamar a `arca.recuperarComprobante(error.intento)`:
 * devuelve si quedó autorizado, si no se emitió (y se puede reintentar con el
 * mismo número) o si hay un conflicto.
 *
 * Si ARCA respondió con errores de negocio, el error es `ArcaWSFEError` (no se emitió).
 * Para exportación (WSFEX) el error es `ArcaResultadoInciertoExpo`.
 */
export class ArcaResultadoIncierto extends ArcaError {
  static override readonly code: string = "ARCA_RESULTADO_INCIERTO";
  /** Operación SOAP que quedó incierta */
  public readonly operacion: OperacionEmision;
  /** Datos del (primer) comprobante enviado, para `recuperarComprobante`. */
  public readonly intento: IntentoComprobante;
  /** Todos los comprobantes del request (más de uno solo en llamadas raw por lote). */
  public readonly intentos: IntentoComprobante[];

  constructor(
    operacion: OperacionEmision,
    intentos: IntentoComprobante[],
    options?: { cause?: unknown }
  ) {
    if (intentos.length === 0) {
      throw new TypeError("ArcaResultadoIncierto requiere al menos un intento");
    }
    const i = intentos[0];
    const causa = options?.cause instanceof Error ? `: ${options.cause.message}` : "";
    super(
      `Resultado incierto de ${operacion} para el comprobante ${i.cbteTipo}-${i.ptoVta}-${i.cbteNro}${causa}. ` +
        "No se reintentó. Usar recuperarComprobante(error.intento) para saber si quedó autorizado.",
      options
    );
    this.name = "ArcaResultadoIncierto";
    this.operacion = operacion;
    this.intento = i;
    this.intentos = intentos;
  }
}

/**
 * No se sabe si WSFEX autorizó el comprobante de exportación (`FEXAuthorize`):
 * timeout, error de red, HTTP 5xx, error interno de ARCA o respuesta sin
 * `FEXResultAuth`. El SDK no reintenta.
 *
 * WSFEX está diseñado para este caso (manual WSFEX, "Manejo transaccional"):
 * se reenvía **la misma solicitud con el mismo `Id`**. Si ya estaba aprobada,
 * WSFEX devuelve el CAE original con `Reproceso = "S"` sin duplicar nada.
 *
 * - API simplificada: `arca.facturarExpo({ ...mismasOpts, ...error.intento })`
 *   (fija `id`, `cbteNro` y `fecha`).
 * - API raw: `arca.crearFacturaExportacion(error.request)`.
 *
 * No reenvíes con otro `Id` ni otro número: eso sí podría autorizar otro comprobante.
 */
export class ArcaResultadoInciertoExpo extends ArcaError {
  static override readonly code: string = "ARCA_RESULTADO_INCIERTO_EXPO";
  /** Siempre `FEXAuthorize`. */
  public readonly operacion = "FEXAuthorize" as const;
  /** `Id` del request enviado: reenviar con el mismo `Id`. */
  public readonly id: number;
  public readonly cbteTipo: number;
  public readonly ptoVta: number;
  public readonly cbteNro: number;
  /** Datos para reenviar con `facturarExpo({ ...opts, ...error.intento })`. */
  public readonly intento: IntentoExpo;
  /** `Cmp` exacto que se envió, para reenviarlo con `crearFacturaExportacion`. */
  public readonly request: WsfexInvoice;

  constructor(request: WsfexInvoice, options?: { cause?: unknown }) {
    const causa = options?.cause instanceof Error ? `: ${options.cause.message}` : "";
    super(
      `Resultado incierto de FEXAuthorize (Id ${request.Id}) para el comprobante ` +
        `${request.Cbte_Tipo}-${request.Punto_vta}-${request.Cbte_nro}${causa}. No se reintentó. ` +
        "Reenviar la misma solicitud con el mismo Id (WSFEX responde Reproceso=\"S\" si ya estaba autorizada).",
      options
    );
    this.name = "ArcaResultadoInciertoExpo";
    this.id = request.Id;
    this.cbteTipo = request.Cbte_Tipo;
    this.ptoVta = request.Punto_vta;
    this.cbteNro = request.Cbte_nro;
    this.intento = { id: request.Id, cbteNro: request.Cbte_nro, fecha: request.Fecha_cbte };
    this.request = request;
  }
}
