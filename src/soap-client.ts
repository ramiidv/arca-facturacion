import { soapCall, extractMethodResult, buildXml } from "@ramiidv/arca-common";
import type { ArcaEvent, SoapOperationKind } from "@ramiidv/arca-common";

// Utilidades XML compartidas con el resto de los SDKs (mismas opciones de parseo).
export { parseXml, buildXml, ensureArray as toArray } from "@ramiidv/arca-common";

export interface SoapOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  onEvent?: (event: ArcaEvent) => void;
  /** `emision` nunca se reintenta (default: `consulta`). */
  kind?: SoapOperationKind;
  signal?: AbortSignal;
}

/**
 * Llamada SOAP a un web service de ARCA con elementos calificados
 * (`elementFormDefault="qualified"`, como WSFEv1 y WSFEX): el método declara
 * el namespace por defecto y los parámetros lo heredan.
 *
 * El transporte (timeout, reintentos solo en consultas, SOAP Faults, signal,
 * resultado incierto) es el de `@ramiidv/arca-common`.
 */
export async function afipSoapCall(
  endpoint: string,
  namespace: string,
  method: string,
  params: Record<string, any>,
  opts?: SoapOptions
): Promise<Record<string, any>> {
  const bodyContent = buildXml({
    [method]: {
      "@_xmlns": namespace,
      ...params,
    },
  });

  const parsed = await soapCall(endpoint, bodyContent, {
    soapAction: `${namespace}${method}`,
    methodName: method,
    timeout: opts?.timeoutMs,
    retries: opts?.retries,
    retryDelayMs: opts?.retryDelayMs,
    onEvent: opts?.onEvent,
    kind: opts?.kind,
    signal: opts?.signal,
  });

  return extractMethodResult(parsed, method);
}
