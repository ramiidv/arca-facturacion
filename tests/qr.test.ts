import { describe, it, expect } from "vitest";
import { ArcaValidationError } from "@ramiidv/arca-common";
import { Arca } from "../src/arca.js";
import { generarUrlQR, urlQRDesdeFactura } from "../src/qr.js";
import type { FacturaResult } from "../src/types.js";

const decode = (url: string) => JSON.parse(Buffer.from(url.split("?p=")[1], "base64").toString());

const base = {
  fecha: "2026-03-28",
  cuit: 20123456786,
  ptoVta: 1,
  tipoCmp: 6,
  nroCmp: 150,
  importe: 121,
  moneda: "PES",
  ctz: 1,
  tipoDocRec: 99,
  nroDocRec: 0,
  codAut: 74512345678901,
};

describe("generarUrlQR / Arca.generateQRUrl", () => {
  it("URL de la especificación vigente (arca.gob.ar) con el JSON versión 1", () => {
    const url = Arca.generateQRUrl(base);
    expect(url).toMatch(/^https:\/\/www\.arca\.gob\.ar\/fe\/qr\/\?p=.+$/);
    expect(decode(url)).toEqual({
      ver: 1,
      fecha: "2026-03-28",
      cuit: 20123456786,
      ptoVta: 1,
      tipoCmp: 6,
      nroCmp: 150,
      importe: 121,
      moneda: "PES",
      ctz: 1,
      tipoDocRec: 99,
      nroDocRec: 0,
      tipoCodAut: "E",
      codAut: 74512345678901,
    });
  });

  it("reproduce el ejemplo de la especificación", () => {
    const url = generarUrlQR(
      {
        fecha: "20201013",
        cuit: "30-00000000-7",
        ptoVta: 10,
        tipoCmp: 1,
        nroCmp: 94,
        importe: 12100,
        moneda: "DOL",
        ctz: 65,
        tipoDocRec: 80,
        nroDocRec: "20000000001",
        codAut: "70417054367476",
      },
      { baseUrl: "https://www.afip.gob.ar/fe/qr/" }
    );
    // Texto codificado del ejemplo oficial (sin los saltos de línea del PDF).
    expect(url).toBe(
      "https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyMC0xMC0xMyIsImN1aXQiOjMwMDAwMDAwMDA3LCJwdG9WdGEiOjEwLCJ0aXBvQ21wIjoxLCJucm9DbXAiOjk0LCJpbXBvcnRlIjoxMjEwMCwibW9uZWRhIjoiRE9MIiwiY3R6Ijo2NSwidGlwb0RvY1JlYyI6ODAsIm5yb0RvY1JlYyI6MjAwMDAwMDAwMDEsInRpcG9Db2RBdXQiOiJFIiwiY29kQXV0Ijo3MDQxNzA1NDM2NzQ3Nn0="
    );
  });

  it("convierte la fecha YYYYMMDD o Date a YYYY-MM-DD y el CAE string a número", () => {
    const p = decode(generarUrlQR({ ...base, fecha: "20261030", codAut: "04512345678901" }));
    expect(p.fecha).toBe("2026-10-30");
    expect(p.codAut).toBe(4512345678901);
    expect(decode(generarUrlQR({ ...base, fecha: new Date("2026-10-30T15:00:00Z") })).fecha).toBe("2026-10-30");
  });

  it("omite tipoDocRec/nroDocRec si no corresponden", () => {
    const { tipoDocRec, nroDocRec, ...sinReceptor } = base;
    const p = decode(generarUrlQR(sinReceptor));
    expect(p).not.toHaveProperty("tipoDocRec");
    expect(p).not.toHaveProperty("nroDocRec");
  });

  it("respeta tipoCodAut=A para CAEA", () => {
    expect(decode(generarUrlQR({ ...base, tipoCodAut: "A" })).tipoCodAut).toBe("A");
  });

  it("rechaza fecha inexistente, CAE que no es de 14 dígitos y CUIT inválido", () => {
    expect(() => generarUrlQR({ ...base, fecha: "20261399" })).toThrow(ArcaValidationError);
    expect(() => generarUrlQR({ ...base, codAut: "123" })).toThrow(ArcaValidationError);
    expect(() => generarUrlQR({ ...base, cuit: 20123456789 })).toThrow(ArcaValidationError);
  });
});

describe("urlQRDesdeFactura", () => {
  const factura: FacturaResult = {
    aprobada: true,
    cae: "76123456789012",
    caeVencimiento: "20261109",
    cbteNro: 151,
    ptoVta: 3,
    cbteTipo: 1,
    importes: { total: 1210, neto: 1000, iva: 210, exento: 0, noGravado: 0, tributos: 0 },
    observaciones: [],
    eventos: [],
    fecha: "20261030",
    docTipo: 80,
    docNro: 30712345671,
    moneda: "PES",
    cotizacion: 1,
    tipoCodAut: "E",
    raw: {} as FacturaResult["raw"],
  };

  it("arma el QR con los datos del resultado", () => {
    const p = decode(urlQRDesdeFactura(factura, { cuit: 20123456786 }));
    expect(p).toEqual({
      ver: 1,
      fecha: "2026-10-30",
      cuit: 20123456786,
      ptoVta: 3,
      tipoCmp: 1,
      nroCmp: 151,
      importe: 1210,
      moneda: "PES",
      ctz: 1,
      tipoDocRec: 80,
      nroDocRec: 30712345671,
      tipoCodAut: "E",
      codAut: 76123456789012,
    });
  });

  it("rechaza un comprobante no aprobado", () => {
    expect(() => urlQRDesdeFactura({ ...factura, aprobada: false, cae: undefined }, { cuit: 20123456786 })).toThrow(
      ArcaValidationError
    );
  });

  it("moneda extranjera sin cotización conocida exige datos.ctz", () => {
    const f = { ...factura, moneda: "DOL", cotizacion: undefined };
    expect(() => urlQRDesdeFactura(f, { cuit: 20123456786 })).toThrow(/ctz/);
    expect(decode(urlQRDesdeFactura(f, { cuit: 20123456786, ctz: 1000.5 })).ctz).toBe(1000.5);
  });
});
