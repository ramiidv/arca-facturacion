import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { ArcaSoapError } from "./errors.js";
import type { ArcaEvent } from "@ramiidv/arca-common";

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
  soapAction?: string;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  onEvent?: (event: ArcaEvent) => void;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ArcaSoapError) {
    // Retry on 5xx and timeouts (no statusCode), not on 4xx
    return !err.statusCode || err.statusCode >= 500;
  }
  return true; // Network errors
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Realiza una llamada SOAP genérica con retry y eventos.
 */
export async function soapCall(
  endpoint: string,
  bodyContent: string,
  opts?: SoapOptions
): Promise<string> {
  const soapAction = opts?.soapAction;
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const retries = opts?.retries ?? 0;
  const retryDelayMs = opts?.retryDelayMs ?? 1_000;
  const onEvent = opts?.onEvent;
  const method = soapAction ?? endpoint;

  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    ${bodyContent}
  </soap:Body>
</soap:Envelope>`;

  const headers: Record<string, string> = {
    "Content-Type": "text/xml; charset=utf-8",
  };

  if (soapAction) {
    headers["SOAPAction"] = `"${soapAction}"`;
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    onEvent?.({ type: "request:start", method, endpoint });
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: soapEnvelope,
          signal: controller.signal,
        });
      } catch (err: any) {
        if (err?.name === "AbortError") {
          throw new ArcaSoapError(
            `SOAP request timeout after ${timeoutMs}ms: ${endpoint}`
          );
        }
        throw new ArcaSoapError(
          `SOAP request failed: ${err?.message ?? err}`
        );
      } finally {
        clearTimeout(timer);
      }

      const responseText = await response.text();

      if (!response.ok) {
        throw new ArcaSoapError(
          `SOAP HTTP ${response.status}: ${response.statusText}\n${responseText}`,
          response.status
        );
      }

      onEvent?.({
        type: "request:end",
        method,
        endpoint,
        durationMs: Date.now() - start,
      });
      return responseText;
    } catch (err) {
      lastError = err;
      const errMsg =
        err instanceof Error ? err.message : String(err);

      onEvent?.({ type: "request:error", method, endpoint, error: errMsg });

      if (attempt < retries && isRetryable(err)) {
        const delay = retryDelayMs * Math.pow(2, attempt);
        onEvent?.({
          type: "request:retry",
          method,
          endpoint,
          attempt: attempt + 1,
          error: errMsg,
        });
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }

  throw lastError; // unreachable
}

/**
 * Realiza una llamada SOAP a un web service de AFIP (WSFE, WSFEX, etc.).
 * Construye el envelope con namespace y SOAPAction, y parsea la respuesta.
 */
export async function afipSoapCall(
  endpoint: string,
  namespace: string,
  method: string,
  params: Record<string, any>,
  opts?: Omit<SoapOptions, "soapAction">
): Promise<Record<string, any>> {
  const bodyContent = buildXml({
    [method]: {
      "@_xmlns": namespace,
      ...params,
    },
  });

  const soapAction = `${namespace}${method}`;
  const responseXml = await soapCall(endpoint, bodyContent, {
    ...opts,
    soapAction,
  });
  const parsed = parseXml(responseXml);

  // Extraer el body del SOAP envelope
  const envelope =
    parsed["soap:Envelope"] ||
    parsed["soapenv:Envelope"] ||
    parsed["S:Envelope"];

  if (!envelope) {
    throw new ArcaSoapError(`Respuesta SOAP inválida:\n${responseXml}`);
  }

  const body =
    envelope["soap:Body"] || envelope["soapenv:Body"] || envelope["S:Body"];

  if (!body) {
    throw new ArcaSoapError(
      `SOAP Body no encontrado en la respuesta:\n${responseXml}`
    );
  }

  // Verificar SOAP Fault
  const fault =
    body["soap:Fault"] || body["soapenv:Fault"] || body["S:Fault"];
  if (fault) {
    const faultString =
      fault.faultstring || fault.Reason || "Error desconocido";
    throw new ArcaSoapError(`SOAP Fault: ${faultString}`);
  }

  const responseKey = `${method}Response`;
  const resultKey = `${method}Result`;
  const methodResponse = body[responseKey];

  if (!methodResponse) {
    throw new ArcaSoapError(
      `Respuesta del método ${method} no encontrada:\n${responseXml}`
    );
  }

  return methodResponse[resultKey] ?? methodResponse;
}
