import { vi } from "vitest";
import { MemoryTicketStorage } from "@ramiidv/arca-common";
import { Arca } from "../src/arca.js";
import type { ArcaConfig } from "../src/types.js";

export const CUIT_EMISOR = 20123456786;

type Handler = Response | Error | ((body: string) => Response | Promise<Response>);

/**
 * Mock de fetch que despacha por SOAPAction (método) y registra las llamadas.
 * Cada método tiene una cola de respuestas; la última se repite.
 */
export function mockArcaFetch(handlers: Record<string, Handler | Handler[]>) {
  const queues = new Map(
    Object.entries(handlers).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]])
  );
  const calls: { method: string; body: string }[] = [];

  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    const action = String((init.headers as Record<string, string>)["SOAPAction"] ?? "");
    const method = action.replace(/"/g, "").split("/").pop()!;
    const body = String(init.body);
    calls.push({ method, body });

    const queue = queues.get(method);
    if (!queue || queue.length === 0) throw new Error(`fetch inesperado: ${method}`);
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next(body);
    return next.clone();
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls, count: (method: string) => calls.filter((c) => c.method === method).length };
}

export function wsfeResponse(method: string, inner: string, status = 200): Response {
  const xml =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
    `<soap:Body><${method}Response xmlns="http://ar.gov.afip.dif.FEV1/">` +
    `<${method}Result>${inner}</${method}Result>` +
    `</${method}Response></soap:Body></soap:Envelope>`;
  return new Response(xml, { status, headers: { "content-type": "text/xml" } });
}

export function ultimoAutorizado(ptoVta: number, cbteTipo: number, cbteNro: number): Response {
  return wsfeResponse(
    "FECompUltimoAutorizado",
    `<PtoVta>${ptoVta}</PtoVta><CbteTipo>${cbteTipo}</CbteTipo><CbteNro>${cbteNro}</CbteNro>`
  );
}

export function caeAprobado(o: {
  ptoVta: number;
  cbteTipo: number;
  cbteNro: number;
  docTipo?: number;
  docNro?: number | string;
  fecha?: string;
  cae?: string;
}): Response {
  return wsfeResponse(
    "FECAESolicitar",
    `<FeCabResp><Cuit>${CUIT_EMISOR}</Cuit><PtoVta>${o.ptoVta}</PtoVta><CbteTipo>${o.cbteTipo}</CbteTipo>` +
      "<FchProceso>20261030120000</FchProceso><CantReg>1</CantReg><Resultado>A</Resultado><Reproceso>N</Reproceso></FeCabResp>" +
      "<FeDetResp><FECAEDetResponse>" +
      `<Concepto>1</Concepto><DocTipo>${o.docTipo ?? 99}</DocTipo><DocNro>${o.docNro ?? 0}</DocNro>` +
      `<CbteDesde>${o.cbteNro}</CbteDesde><CbteHasta>${o.cbteNro}</CbteHasta><CbteFch>${o.fecha ?? "20261030"}</CbteFch>` +
      `<Resultado>A</Resultado><CAE>${o.cae ?? "76123456789012"}</CAE><CAEFchVto>20261109</CAEFchVto>` +
      "</FECAEDetResponse></FeDetResp>"
  );
}

export function wsfeErrores(method: string, errors: { code: number; msg: string }[]): Response {
  return wsfeResponse(
    method,
    "<Errors>" + errors.map((e) => `<Err><Code>${e.code}</Code><Msg>${e.msg}</Msg></Err>`).join("") + "</Errors>"
  );
}

export function comprobanteConsultado(o: {
  ptoVta: number;
  cbteTipo: number;
  cbteNro: number;
  docTipo: number;
  docNro: number | string;
  fecha: string;
  total: number;
  neto: number;
  iva: number;
  cae?: string;
}): Response {
  return wsfeResponse(
    "FECompConsultar",
    "<ResultGet>" +
      `<Concepto>1</Concepto><DocTipo>${o.docTipo}</DocTipo><DocNro>${o.docNro}</DocNro>` +
      `<CbteDesde>${o.cbteNro}</CbteDesde><CbteHasta>${o.cbteNro}</CbteHasta><CbteFch>${o.fecha}</CbteFch>` +
      `<ImpTotal>${o.total}</ImpTotal><ImpTotConc>0</ImpTotConc><ImpNeto>${o.neto}</ImpNeto><ImpOpEx>0</ImpOpEx>` +
      `<ImpTrib>0</ImpTrib><ImpIVA>${o.iva}</ImpIVA><FchServDesde/><FchServHasta/><FchVtoPago/>` +
      "<MonId>PES</MonId><MonCotiz>1</MonCotiz>" +
      `<Iva><AlicIva><Id>5</Id><BaseImp>${o.neto}</BaseImp><Importe>${o.iva}</Importe></AlicIva></Iva>` +
      `<Resultado>A</Resultado><CodAutorizacion>${o.cae ?? "76123456789012"}</CodAutorizacion>` +
      "<EmisionTipo>CAE</EmisionTipo><FchVto>20261109</FchVto><FchProceso>20261030120000</FchProceso>" +
      `<PtoVta>${o.ptoVta}</PtoVta><CbteTipo>${o.cbteTipo}</CbteTipo>` +
      "</ResultGet>"
  );
}

/** Arca con un ticket ya guardado en el storage (los tests no pasan por WSAA). */
export async function arcaDePrueba(extra: Partial<ArcaConfig> = {}): Promise<Arca> {
  const storage = new MemoryTicketStorage();
  const arca = new Arca({
    cuit: CUIT_EMISOR,
    cert: "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----",
    key: "KEY",
    ticketStorage: storage,
    retries: 3,
    retryDelayMs: 1,
    ...extra,
  });
  const expirationTime = new Date(Date.now() + 12 * 3_600_000).toISOString();
  for (const service of ["wsfe", "wsfex", "ws_sr_padron_a13", "ws_sr_constancia_inscripcion"]) {
    await storage.set(arca.wsaa.ticketKey(service), { token: "TOKEN", sign: "SIGN", expirationTime });
  }
  return arca;
}

export function networkError(code: string): TypeError {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
}
