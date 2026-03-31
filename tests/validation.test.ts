import { describe, it, expect } from "vitest";
import {
  validateFacturarOpts,
  validateFacturarExpoOpts,
  validateInvoiceRequest,
} from "../src/validation.js";
import { IvaTipo, CbteTipo } from "../src/constants.js";

describe("validateFacturarOpts", () => {
  const validOpts = {
    ptoVta: 1,
    cbteTipo: CbteTipo.FACTURA_B,
    items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
  };

  it("acepta opts válidos", () => {
    expect(() => validateFacturarOpts(validOpts)).not.toThrow();
  });

  it("rechaza ptoVta 0", () => {
    expect(() =>
      validateFacturarOpts({ ...validOpts, ptoVta: 0 })
    ).toThrow("ptoVta");
  });

  it("rechaza items vacío", () => {
    expect(() =>
      validateFacturarOpts({ ...validOpts, items: [] })
    ).toThrow("items");
  });

  it("rechaza neto negativo", () => {
    expect(() =>
      validateFacturarOpts({
        ...validOpts,
        items: [{ neto: -10, iva: IvaTipo.IVA_21 }],
      })
    ).toThrow("negativo");
  });

  it("rechaza iva + exento en mismo item", () => {
    expect(() =>
      validateFacturarOpts({
        ...validOpts,
        items: [{ neto: 100, iva: IvaTipo.IVA_21, exento: true }],
      })
    ).toThrow("iva");
  });

  it("rechaza moneda extranjera sin cotización", () => {
    expect(() =>
      validateFacturarOpts({
        ...validOpts,
        moneda: "DOL",
      })
    ).toThrow("cotizacion");
  });

  it("rechaza servicio incompleto", () => {
    expect(() =>
      validateFacturarOpts({
        ...validOpts,
        servicio: { desde: "20260301", hasta: "20260331", vtoPago: "" as any },
      })
    ).toThrow("vtoPago");
  });
});

describe("validateFacturarExpoOpts", () => {
  const validOpts = {
    ptoVta: 1,
    cbteTipo: CbteTipo.FACTURA_E,
    tipoExpo: 1,
    pais: 203,
    cliente: {
      nombre: "ACME",
      cuitPais: 50000000016,
      domicilio: "123 Main St",
      idImpositivo: "XX",
    },
    moneda: "DOL",
    cotizacion: 1200,
    formaPago: "Wire",
    items: [
      { codigo: "X", descripcion: "Y", cantidad: 1, unidad: 7, precioUnitario: 10 },
    ],
  };

  it("acepta opts válidos", () => {
    expect(() => validateFacturarExpoOpts(validOpts)).not.toThrow();
  });

  it("rechaza sin cliente", () => {
    expect(() =>
      validateFacturarExpoOpts({ ...validOpts, cliente: undefined as any })
    ).toThrow("cliente");
  });

  it("rechaza sin moneda", () => {
    expect(() =>
      validateFacturarExpoOpts({ ...validOpts, moneda: "" })
    ).toThrow("moneda");
  });

  it("rechaza item sin descripción", () => {
    expect(() =>
      validateFacturarExpoOpts({
        ...validOpts,
        items: [{ codigo: "X", descripcion: "", cantidad: 1, unidad: 7, precioUnitario: 10 }],
      })
    ).toThrow("descripcion");
  });
});

describe("validateInvoiceRequest", () => {
  it("rechaza sin PtoVta", () => {
    expect(() =>
      validateInvoiceRequest({
        PtoVta: 0,
        CbteTipo: 6,
        invoices: [{ CbteDesde: 1, CbteHasta: 1, CbteFch: "20260328", ImpTotal: 121, ImpTotConc: 0, ImpNeto: 100, ImpOpEx: 0, ImpTrib: 0, ImpIVA: 21, MonId: "PES", MonCotiz: 1, Concepto: 1, DocTipo: 99, DocNro: 0 }],
      })
    ).toThrow("PtoVta");
  });

  it("rechaza invoices vacío", () => {
    expect(() =>
      validateInvoiceRequest({ PtoVta: 1, CbteTipo: 6, invoices: [] })
    ).toThrow("invoices");
  });
});
