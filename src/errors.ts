/**
 * Error base para todos los errores del SDK de ARCA.
 */
export class ArcaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArcaError";
  }
}

/**
 * Error de autenticación WSAA.
 * Se lanza cuando falla el login o la respuesta de WSAA es inválida.
 */
export class ArcaAuthError extends ArcaError {
  constructor(message: string) {
    super(message);
    this.name = "ArcaAuthError";
  }
}

/**
 * Error de WSFE con códigos de error de AFIP.
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

/**
 * Error a nivel SOAP/HTTP.
 * Se lanza cuando el request HTTP falla o hay un SOAP Fault.
 */
export class ArcaSoapError extends ArcaError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "ArcaSoapError";
    this.statusCode = statusCode;
  }
}
