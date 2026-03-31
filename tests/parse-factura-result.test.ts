import { describe, it, expect } from "vitest";
import { parseFacturaResult } from "../src/facturacion.js";
import type { FECAESolicitarResult, Importes } from "../src/types.js";

const importes: Importes = {
  total: 121,
  neto: 100,
  iva: 21,
  exento: 0,
  noGravado: 0,
  tributos: 0,
};

describe("parseFacturaResult", () => {
  it("parsea resultado aprobado", () => {
    const raw: FECAESolicitarResult = {
      FeCabResp: {
        Cuit: 20123456789,
        PtoVta: 1,
        CbteTipo: 6,
        FchProceso: "20260328120000",
        CantReg: 1,
        Resultado: "A",
        Reproceso: "N",
      },
      FeDetResp: {
        FECAEDetResponse: {
          Concepto: 1,
          DocTipo: 99,
          DocNro: 0,
          CbteDesde: 150,
          CbteHasta: 150,
          CbteFch: "20260328",
          Resultado: "A",
          CAE: "74512345678901",
          CAEFchVto: "20260407",
        },
      },
    };

    const result = parseFacturaResult(raw, importes);

    expect(result.aprobada).toBe(true);
    expect(result.cae).toBe("74512345678901");
    expect(result.caeVencimiento).toBe("20260407");
    expect(result.cbteNro).toBe(150);
    expect(result.ptoVta).toBe(1);
    expect(result.cbteTipo).toBe(6);
    expect(result.importes).toEqual(importes);
    expect(result.observaciones).toEqual([]);
    expect(result.raw).toBe(raw);
  });

  it("parsea resultado rechazado con observaciones", () => {
    const raw: FECAESolicitarResult = {
      FeCabResp: {
        Cuit: 20123456789,
        PtoVta: 1,
        CbteTipo: 6,
        FchProceso: "20260328120000",
        CantReg: 1,
        Resultado: "R",
        Reproceso: "N",
      },
      FeDetResp: {
        FECAEDetResponse: {
          Concepto: 1,
          DocTipo: 99,
          DocNro: 0,
          CbteDesde: 150,
          CbteHasta: 150,
          CbteFch: "20260328",
          Resultado: "R",
          CAE: "",
          CAEFchVto: "",
          Observaciones: {
            Obs: { Code: 10016, Msg: "Error de test" },
          },
        },
      },
    };

    const result = parseFacturaResult(raw, importes);

    expect(result.aprobada).toBe(false);
    expect(result.cae).toBeUndefined();
    expect(result.observaciones).toHaveLength(1);
    expect(result.observaciones[0]).toEqual({
      code: 10016,
      msg: "Error de test",
    });
  });

  it("maneja array de FECAEDetResponse", () => {
    const raw: FECAESolicitarResult = {
      FeCabResp: {
        Cuit: 20123456789,
        PtoVta: 1,
        CbteTipo: 6,
        FchProceso: "20260328120000",
        CantReg: 2,
        Resultado: "A",
        Reproceso: "N",
      },
      FeDetResp: {
        FECAEDetResponse: [
          {
            Concepto: 1, DocTipo: 99, DocNro: 0,
            CbteDesde: 150, CbteHasta: 150, CbteFch: "20260328",
            Resultado: "A", CAE: "11111111111111", CAEFchVto: "20260407",
          },
          {
            Concepto: 1, DocTipo: 99, DocNro: 0,
            CbteDesde: 151, CbteHasta: 151, CbteFch: "20260328",
            Resultado: "A", CAE: "22222222222222", CAEFchVto: "20260407",
          },
        ],
      },
    };

    const result = parseFacturaResult(raw, importes);
    expect(result.aprobada).toBe(true);
    expect(result.cbteNro).toBe(150); // first one
  });

  it("maneja observaciones como array", () => {
    const raw: FECAESolicitarResult = {
      FeCabResp: {
        Cuit: 20123456789, PtoVta: 1, CbteTipo: 6,
        FchProceso: "20260328120000", CantReg: 1, Resultado: "R", Reproceso: "N",
      },
      FeDetResp: {
        FECAEDetResponse: {
          Concepto: 1, DocTipo: 99, DocNro: 0,
          CbteDesde: 150, CbteHasta: 150, CbteFch: "20260328",
          Resultado: "R", CAE: "", CAEFchVto: "",
          Observaciones: {
            Obs: [
              { Code: 10001, Msg: "Error 1" },
              { Code: 10002, Msg: "Error 2" },
            ],
          },
        },
      },
    };

    const result = parseFacturaResult(raw, importes);
    expect(result.observaciones).toHaveLength(2);
  });
});
