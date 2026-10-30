// Base errors re-exported from common
export {
  ArcaError,
  ArcaAuthError,
  ArcaSoapError,
  ArcaValidationError,
  ArcaTicketVigenteError,
} from "@ramiidv/arca-common";
import { ArcaError } from "@ramiidv/arca-common";
import type { IntentoComprobante } from "./types.js";

/**
 * Error de WSFE/WSFEX con códigos de error de ARCA.
 *
 * En una emisión, este error significa que ARCA **rechazó** el comprobante:
 * no se emitió. Ojo con el código 10016 ("el número o fecha del comprobante no
 * se corresponde con el próximo a autorizar"): suele indicar que un intento
 * anterior con ese número sí se autorizó. En ese caso usar `recuperarComprobante`.
 */
export class ArcaWSFEError extends ArcaError {
  public override readonly code: string = "ARCA_WSFE_ERROR";
  public readonly errors: { code: number; msg: string }[];

  constructor(errors: { code: number; msg: string }[]) {
    const msg = errors.map((e) => `[${e.code}] ${e.msg}`).join("; ");
    super(`WSFE Error: ${msg}`);
    this.name = "ArcaWSFEError";
    this.errors = errors;
  }

  /** `true` si ARCA devolvió el código de error indicado. */
  tieneCodigo(code: number): boolean {
    return this.errors.some((e) => Number(e.code) === code);
  }
}

/** Operaciones de emisión que pueden terminar con resultado incierto. */
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
 */
export class ArcaResultadoIncierto extends ArcaError {
  public override readonly code: string = "ARCA_RESULTADO_INCIERTO";
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
