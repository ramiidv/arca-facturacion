import { XMLParser, XMLBuilder } from "fast-xml-parser";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: true,
  trimValues: true,
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
 * Realiza una llamada SOAP genérica usando fetch nativo.
 * Retorna el XML de respuesta completo.
 */
export async function soapCall(
  endpoint: string,
  bodyContent: string,
  soapAction?: string
): Promise<string> {
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

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: soapEnvelope,
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `SOAP HTTP ${response.status}: ${response.statusText}\n${responseText}`
    );
  }

  return responseText;
}

/**
 * Realiza una llamada SOAP al WSFE (WSFEv1).
 * Construye el envelope con el namespace correcto y el SOAPAction.
 */
export async function wsfeSoapCall(
  endpoint: string,
  method: string,
  params: Record<string, any>
): Promise<Record<string, any>> {
  const namespace = "http://ar.gov.afip.dif.FEV1/";

  const bodyContent = buildXml({
    [method]: {
      "@_xmlns": namespace,
      ...params,
    },
  });

  const soapAction = `${namespace}${method}`;
  const responseXml = await soapCall(endpoint, bodyContent, soapAction);
  const parsed = parseXml(responseXml);

  // Extraer el body del SOAP envelope
  const envelope =
    parsed["soap:Envelope"] ||
    parsed["soapenv:Envelope"] ||
    parsed["S:Envelope"];

  if (!envelope) {
    throw new Error(`Respuesta SOAP inválida:\n${responseXml}`);
  }

  const body =
    envelope["soap:Body"] || envelope["soapenv:Body"] || envelope["S:Body"];

  if (!body) {
    // Verificar si hay un SOAP Fault
    throw new Error(`SOAP Body no encontrado en la respuesta:\n${responseXml}`);
  }

  // Verificar SOAP Fault
  const fault = body["soap:Fault"] || body["soapenv:Fault"] || body["S:Fault"];
  if (fault) {
    const faultString = fault.faultstring || fault.Reason || "Error desconocido";
    throw new Error(`SOAP Fault: ${faultString}`);
  }

  const responseKey = `${method}Response`;
  const resultKey = `${method}Result`;
  const methodResponse = body[responseKey];

  if (!methodResponse) {
    throw new Error(
      `Respuesta del método ${method} no encontrada:\n${responseXml}`
    );
  }

  return methodResponse[resultKey] ?? methodResponse;
}
