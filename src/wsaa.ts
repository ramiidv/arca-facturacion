import forge from "node-forge";
import { ENDPOINTS, WSAA_NAMESPACE } from "./constants.js";
import type { AccessTicket } from "./types.js";
import { soapCall, parseXml, buildXml } from "./soap-client.js";

export class WsaaClient {
  private cert: string;
  private key: string;
  private production: boolean;
  private tokenTTLMinutes: number;
  private ticketCache: Map<string, AccessTicket> = new Map();

  constructor(opts: {
    cert: string;
    key: string;
    production: boolean;
    tokenTTLMinutes: number;
  }) {
    this.cert = opts.cert;
    this.key = opts.key;
    this.production = opts.production;
    this.tokenTTLMinutes = opts.tokenTTLMinutes;
  }

  /**
   * Obtiene un Ticket de Acceso (TA) para el servicio indicado.
   * Cachea el ticket y lo reutiliza si no expiró.
   */
  async getAccessTicket(service: string): Promise<AccessTicket> {
    const cached = this.ticketCache.get(service);
    if (cached && cached.expirationTime > new Date()) {
      return cached;
    }

    const tra = this.createTRA(service);
    const cms = this.signTRA(tra);
    const ticket = await this.loginCms(cms);

    this.ticketCache.set(service, ticket);
    return ticket;
  }

  /**
   * Invalida el ticket cacheado para un servicio.
   */
  clearTicket(service: string): void {
    this.ticketCache.delete(service);
  }

  /**
   * Crea el Ticket de Requerimiento de Acceso (TRA) XML.
   */
  private createTRA(service: string): string {
    const now = new Date();
    const uniqueId = Math.floor(now.getTime() / 1000);
    const generationTime = new Date(now.getTime() - 120_000).toISOString();
    const expirationTime = new Date(
      now.getTime() + this.tokenTTLMinutes * 60_000
    ).toISOString();

    const tra = {
      loginTicketRequest: {
        "@_version": "1.0",
        header: {
          uniqueId: uniqueId,
          generationTime: generationTime,
          expirationTime: expirationTime,
        },
        service: service,
      },
    };

    return '<?xml version="1.0" encoding="UTF-8"?>\n' + buildXml(tra);
  }

  /**
   * Firma el TRA con CMS/PKCS#7 usando el certificado y la clave privada.
   * Retorna el CMS en base64.
   */
  private signTRA(traXml: string): string {
    const cert = forge.pki.certificateFromPem(this.cert);
    const privateKey = forge.pki.privateKeyFromPem(this.key);

    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(traXml, "utf8");
    p7.addCertificate(cert);
    p7.addSigner({
      key: privateKey,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        {
          type: forge.pki.oids.contentType,
          value: forge.pki.oids.data,
        },
        {
          type: forge.pki.oids.messageDigest,
        },
        {
          type: forge.pki.oids.signingTime,
          value: new Date() as any,
        },
      ],
    });
    p7.sign();

    const asn1 = p7.toAsn1();
    const der = forge.asn1.toDer(asn1);
    return forge.util.encode64(der.getBytes());
  }

  /**
   * Envía el CMS al endpoint loginCms de WSAA y parsea el Ticket de Acceso.
   */
  private async loginCms(cmsBase64: string): Promise<AccessTicket> {
    const endpoint = this.production
      ? ENDPOINTS.wsaa.production
      : ENDPOINTS.wsaa.testing;

    const soapBody = `<loginCms xmlns="${WSAA_NAMESPACE}"><in0>${cmsBase64}</in0></loginCms>`;

    const responseXml = await soapCall(endpoint, soapBody, "loginCms");

    const parsed = parseXml(responseXml);

    // Navegar la estructura del response SOAP
    const envelope =
      parsed["soapenv:Envelope"] ||
      parsed["soap:Envelope"] ||
      parsed["S:Envelope"];
    const body =
      envelope?.["soapenv:Body"] ||
      envelope?.["soap:Body"] ||
      envelope?.["S:Body"];
    const loginResponse =
      body?.loginCmsResponse || body?.["ns2:loginCmsResponse"];
    const loginReturn =
      loginResponse?.loginCmsReturn || loginResponse?.["ns2:loginCmsReturn"];

    if (!loginReturn) {
      throw new Error(
        `WSAA: respuesta inesperada del servidor.\n${responseXml}`
      );
    }

    // loginReturn es un XML string embebido, parsearlo
    const taXml = parseXml(loginReturn);
    const credentials =
      taXml.loginTicketResponse?.credentials ||
      taXml?.loginTicketResponse?.header;

    const token =
      taXml.loginTicketResponse?.credentials?.token ?? credentials?.token;
    const sign =
      taXml.loginTicketResponse?.credentials?.sign ?? credentials?.sign;

    if (!token || !sign) {
      throw new Error(
        `WSAA: no se pudo obtener token/sign de la respuesta.\n${loginReturn}`
      );
    }

    const headerExp =
      taXml.loginTicketResponse?.header?.expirationTime ??
      credentials?.expirationTime;
    const expirationTime = headerExp ? new Date(headerExp) : new Date(Date.now() + this.tokenTTLMinutes * 60_000);

    return { token, sign, expirationTime };
  }
}
