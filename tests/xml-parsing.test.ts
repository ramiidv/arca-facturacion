import { describe, it, expect } from "vitest";
import { parseXml, buildXml, toArray } from "../src/soap-client.js";

describe("parseXml", () => {
  it("parsea XML simple", () => {
    const result = parseXml("<root><name>test</name><value>42</value></root>");
    expect(result.root.name).toBe("test");
    expect(result.root.value).toBe(42);
  });

  it("preserva strings de 8+ dígitos como string (fechas, CAE)", () => {
    const result = parseXml("<r><CAE>74512345678901</CAE><CbteFch>20260328</CbteFch></r>");
    expect(typeof result.r.CAE).toBe("string");
    expect(result.r.CAE).toBe("74512345678901");
    expect(typeof result.r.CbteFch).toBe("string");
    expect(result.r.CbteFch).toBe("20260328");
  });

  it("preserva CAE con leading zero", () => {
    const result = parseXml("<r><CAE>04512345678901</CAE></r>");
    expect(result.r.CAE).toBe("04512345678901");
  });

  it("parsea importes como números", () => {
    const result = parseXml("<r><ImpTotal>121.5</ImpTotal><ImpNeto>100</ImpNeto></r>");
    expect(typeof result.r.ImpTotal).toBe("number");
    expect(result.r.ImpTotal).toBe(121.5);
    expect(result.r.ImpNeto).toBe(100);
  });

  it("parsea números cortos (<8 dígitos) como number", () => {
    const result = parseXml("<r><CbteNro>12345</CbteNro><PtoVta>1</PtoVta></r>");
    expect(typeof result.r.CbteNro).toBe("number");
    expect(result.r.CbteNro).toBe(12345);
    expect(result.r.PtoVta).toBe(1);
  });

  it("parsea atributos con prefijo @_", () => {
    const result = parseXml('<loginTicketRequest version="1.0"><service>wsfe</service></loginTicketRequest>');
    expect(result.loginTicketRequest["@_version"]).toBe("1.0");
  });
});

describe("buildXml", () => {
  it("construye XML desde objeto", () => {
    const xml = buildXml({ root: { name: "test", value: 42 } });
    expect(xml).toContain("<name>test</name>");
    expect(xml).toContain("<value>42</value>");
  });

  it("serializa 0 correctamente (no lo suprime)", () => {
    const xml = buildXml({ r: { ImpTotConc: 0, DocNro: 0 } });
    expect(xml).toContain("<ImpTotConc>0</ImpTotConc>");
    expect(xml).toContain("<DocNro>0</DocNro>");
  });

  it("serializa decimales", () => {
    const xml = buildXml({ r: { ImpTotal: 121.5 } });
    expect(xml).toContain("<ImpTotal>121.5</ImpTotal>");
  });
});

describe("toArray", () => {
  it("retorna array si ya es array", () => {
    expect(toArray([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("wrappea item solo en array", () => {
    expect(toArray(42)).toEqual([42]);
  });

  it("retorna array vacío para undefined", () => {
    expect(toArray(undefined)).toEqual([]);
  });

  it("retorna array vacío para null", () => {
    expect(toArray(null as any)).toEqual([]);
  });
});
