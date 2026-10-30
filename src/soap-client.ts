import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { soapCall, extractMethodResult } from "@ramiidv/arca-common";
import type { ArcaEvent, SoapOperationKind } from "@ramiidv/arca-common";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: true,
  trimValues: true,
  numberParseOptions: {
    hex: false,
    leadingZeros: false,
    skipLike: /^\d{8,}$/,
  },
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  format: true,
  suppressEmptyNode: true,
});

/**
 * Parsea un string XML a objeto JS.
 */
export function parseXml(xml: string): Record<string, any> {
  return xmlParser.parse(xml);
}

/**
 * Construye XML desde un objeto JS.
 */
export function buildXml(obj: Record<string, any>): string {
  return xmlBuilder.build(obj);
}

/**
 * Normaliza un valor que puede ser un item, un array, o undefined a un array.
 * Útil para respuestas SOAP donde un solo elemento no viene wrapeado en array.
 */
export function toArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

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
