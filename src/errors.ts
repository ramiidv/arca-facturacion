// Base errors re-exported from common
export { ArcaError, ArcaAuthError, ArcaSoapError } from '@ramiidv/arca-common';
import { ArcaError } from '@ramiidv/arca-common';

/**
 * Error de WSFE/WSFEX con códigos de error de ARCA.
 */
export class ArcaWSFEError extends ArcaError {
  public readonly errors: { code: number; msg: string }[];

  constructor(errors: { code: number; msg: string }[]) {
    const msg = errors.map((e) => `[${e.code}] ${e.msg}`).join("; ");
    super(`WSFE Error: ${msg}`);
    this.name = "ArcaWSFEError";
    this.errors = errors;
  }
}
