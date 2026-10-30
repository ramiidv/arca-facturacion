import { afterEach, describe, expect, it, vi } from "vitest";
import { arcaDePrueba, mockArcaFetch } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Respuestas con la forma que devuelve JAX-WS en Padrón: tag de respuesta con
// prefijo (ns2:getPersonaResponse) y contenido sin namespace (personaReturn).
const A13_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns2:getPersonaResponse xmlns:ns2="http://a13.soap.ws.server.puc.sr/">
      <personaReturn>
        <metadata><fechaHora>2026-10-30T12:00:00.000-03:00</fechaHora><servidor>linux11b</servidor></metadata>
        <persona>
          <apellido>PEREZ</apellido>
          <descripcionActividadPrincipal>SERVICIOS DE RESTAURANTES Y CANTINAS SIN ESPECTACULO</descripcionActividadPrincipal>
          <domicilio>
            <codigoPostal>1414</codigoPostal>
            <descripcionProvincia>CIUDAD AUTONOMA BUENOS AIRES</descripcionProvincia>
            <direccion>AV CORRIENTES 1234</direccion>
            <idProvincia>0</idProvincia>
            <localidad>CAPITAL FEDERAL</localidad>
            <tipoDomicilio>LEGAL/REAL</tipoDomicilio>
          </domicilio>
          <domicilio>
            <codigoPostal>1414</codigoPostal>
            <direccion>AV SCALABRINI ORTIZ 500</direccion>
            <idProvincia>0</idProvincia>
            <tipoDomicilio>FISCAL</tipoDomicilio>
          </domicilio>
          <estadoClave>ACTIVO</estadoClave>
          <idActividadPrincipal>561011</idActividadPrincipal>
          <idPersona>20111111112</idPersona>
          <nombre>JUAN</nombre>
          <numeroDocumento>11111111</numeroDocumento>
          <tipoClave>CUIT</tipoClave>
          <tipoDocumento>DNI</tipoDocumento>
          <tipoPersona>FISICA</tipoPersona>
        </persona>
      </personaReturn>
    </ns2:getPersonaResponse>
  </soap:Body>
</soap:Envelope>`;

const A5_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns2:getPersona_v2Response xmlns:ns2="http://a5.soap.ws.server.puc.sr/">
      <personaReturn>
        <datosGenerales>
          <domicilioFiscal>
            <codPostal>5000</codPostal>
            <descripcionProvincia>CORDOBA</descripcionProvincia>
            <direccion>SAN MARTIN 100</direccion>
            <idProvincia>3</idProvincia>
            <localidad>CORDOBA</localidad>
            <tipoDomicilio>FISCAL</tipoDomicilio>
          </domicilioFiscal>
          <estadoClave>ACTIVO</estadoClave>
          <idPersona>30712345674</idPersona>
          <razonSocial>RESTO SA</razonSocial>
          <tipoClave>CUIT</tipoClave>
          <tipoPersona>JURIDICA</tipoPersona>
        </datosGenerales>
        <datosRegimenGeneral>
          <impuesto><descripcionImpuesto>GANANCIAS SOCIEDADES</descripcionImpuesto><estadoImpuesto>AC</estadoImpuesto><idImpuesto>10</idImpuesto><periodo>201901</periodo></impuesto>
          <impuesto><descripcionImpuesto>IVA</descripcionImpuesto><estadoImpuesto>AC</estadoImpuesto><idImpuesto>30</idImpuesto><periodo>201901</periodo></impuesto>
        </datosRegimenGeneral>
        <metadata><fechaHora>2026-10-30T12:00:00.000-03:00</fechaHora><servidor>linux11b</servidor></metadata>
      </personaReturn>
    </ns2:getPersona_v2Response>
  </soap:Body>
</soap:Envelope>`;

const xml = (body: string) => new Response(body, { headers: { "content-type": "text/xml" } });

describe("padrón en arca-facturacion (issue #1)", () => {
  it("A13: request con parámetros sin namespace y respuesta con prefijo", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ "": xml(A13_RESPONSE) });

    const persona = await arca.consultarCuit(20111111112);

    const body = mock.calls[0].body;
    // El método va prefijado y los hijos NO heredan el namespace.
    expect(body).toContain('<ser:getPersona xmlns:ser="http://a13.soap.ws.server.puc.sr/">');
    expect(body).not.toMatch(/<getPersona xmlns=/);
    // Orden según el WSDL: token, sign, cuitRepresentada, idPersona.
    expect(body).toMatch(
      /<token>TOKEN<\/token>\s*<sign>SIGN<\/sign>\s*<cuitRepresentada>20123456786<\/cuitRepresentada>\s*<idPersona>20111111112<\/idPersona>/
    );

    expect(persona).toMatchObject({
      cuit: 20111111112,
      nombre: "PEREZ JUAN",
      tipoPersona: "FISICA",
      estadoClave: "ACTIVO",
      domicilioFiscal: { direccion: "AV SCALABRINI ORTIZ 500", codPostal: "1414", tipoDomicilio: "FISCAL" },
    });
  });

  it("constancia de inscripción (ex A5): getPersona_v2 con impuestos y domicilio fiscal", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ "": xml(A5_RESPONSE) });

    const persona = await arca.consultarCuitDetalle(30712345674);

    expect(mock.calls[0].body).toContain('<ser:getPersona_v2 xmlns:ser="http://a5.soap.ws.server.puc.sr/">');
    expect(persona).toMatchObject({
      cuit: 30712345674,
      nombre: "RESTO SA",
      tipoPersona: "JURIDICA",
      domicilioFiscal: { direccion: "SAN MARTIN 100", localidad: "CORDOBA" },
      impuestos: [
        { id: 10, descripcion: "GANANCIAS SOCIEDADES", estado: "AC" },
        { id: 30, descripcion: "IVA", estado: "AC" },
      ],
    });
  });

  it("usa el servicio ws_sr_constancia_inscripcion para el detalle", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({ "": xml(A5_RESPONSE) });
    const spy = vi.spyOn(arca.wsaa, "getAccessTicket");
    await arca.consultarCuitDetalle(30712345674);
    expect(spy).toHaveBeenCalledWith("ws_sr_constancia_inscripcion", expect.anything());
  });
});
