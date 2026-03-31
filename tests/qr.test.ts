import { describe, it, expect } from "vitest";
import { Arca } from "../src/arca.js";

describe("Arca.generateQRUrl", () => {
  it("genera URL con payload base64", () => {
    const url = Arca.generateQRUrl({
      fecha: "2026-03-28",
      cuit: 20123456789,
      ptoVta: 1,
      tipoCmp: 6,
      nroCmp: 150,
      importe: 121,
      moneda: "PES",
      ctz: 1,
      tipoDocRec: 99,
      nroDocRec: 0,
      codAut: 74512345678901,
    });

    expect(url).toMatch(/^https:\/\/www\.afip\.gob\.ar\/fe\/qr\/\?p=.+$/);

    // Decode and verify payload
    const base64 = url.split("?p=")[1];
    const payload = JSON.parse(Buffer.from(base64, "base64").toString());

    expect(payload.ver).toBe(1);
    expect(payload.fecha).toBe("2026-03-28");
    expect(payload.cuit).toBe(20123456789);
    expect(payload.ptoVta).toBe(1);
    expect(payload.tipoCmp).toBe(6);
    expect(payload.nroCmp).toBe(150);
    expect(payload.importe).toBe(121);
    expect(payload.moneda).toBe("PES");
    expect(payload.ctz).toBe(1);
    expect(payload.tipoDocRec).toBe(99);
    expect(payload.nroDocRec).toBe(0);
    expect(payload.tipoCodAut).toBe("E"); // default
    expect(payload.codAut).toBe(74512345678901);
  });

  it("respeta tipoCodAut=A para CAEA", () => {
    const url = Arca.generateQRUrl({
      fecha: "2026-03-28",
      cuit: 20123456789,
      ptoVta: 1,
      tipoCmp: 6,
      nroCmp: 1,
      importe: 100,
      moneda: "PES",
      ctz: 1,
      tipoDocRec: 99,
      nroDocRec: 0,
      tipoCodAut: "A",
      codAut: 12345678901234,
    });

    const payload = JSON.parse(
      Buffer.from(url.split("?p=")[1], "base64").toString()
    );
    expect(payload.tipoCodAut).toBe("A");
  });
});
