import { describe, it, expect } from "vitest";
import { buildInvoiceDetail, toDateString } from "../src/facturacion.js";
import { IvaTipo, DocTipo, Concepto, Moneda, CbteTipo, CondicionIva } from "../src/constants.js";

describe("buildInvoiceDetail", () => {
  it("construye factura B consumidor final con defaults", () => {
    const { detail, importes } = buildInvoiceDetail(
      {
        ptoVta: 1,
        cbteTipo: CbteTipo.FACTURA_B,
        items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
      },
      42
    );

    expect(detail.Concepto).toBe(Concepto.PRODUCTOS);
    expect(detail.DocTipo).toBe(DocTipo.CONSUMIDOR_FINAL);
    expect(detail.DocNro).toBe(0);
    expect(detail.CbteDesde).toBe(42);
    expect(detail.CbteHasta).toBe(42);
    expect(detail.MonId).toBe(Moneda.PESOS);
    expect(detail.MonCotiz).toBe(1);
    expect(detail.ImpNeto).toBe(100);
    expect(detail.ImpIVA).toBe(21);
    expect(detail.ImpTotal).toBe(121);
    expect(detail.ImpTotConc).toBe(0);
    expect(detail.ImpOpEx).toBe(0);
    expect(detail.ImpTrib).toBe(0);
    expect(detail.Iva).toHaveLength(1);
    expect(detail.CondicionIVAReceptorId).toBe(CondicionIva.CONSUMIDOR_FINAL);
    expect(importes.total).toBe(121);
  });

  it("auto-detecta SERVICIOS cuando se provee servicio", () => {
    const { detail } = buildInvoiceDetail(
      {
        ptoVta: 1,
        cbteTipo: CbteTipo.FACTURA_A,
        docTipo: DocTipo.CUIT,
        docNro: 30712345678,
        condicionIva: CondicionIva.RESPONSABLE_INSCRIPTO,
        items: [{ neto: 1000, iva: IvaTipo.IVA_21 }],
        servicio: {
          desde: "20260301",
          hasta: "20260331",
          vtoPago: "20260415",
        },
      },
      1
    );

    expect(detail.Concepto).toBe(Concepto.SERVICIOS);
    expect(detail.FchServDesde).toBe("20260301");
    expect(detail.FchServHasta).toBe("20260331");
    expect(detail.FchVtoPago).toBe("20260415");
    expect(detail.CondicionIVAReceptorId).toBe(CondicionIva.RESPONSABLE_INSCRIPTO);
  });

  it("tipo C no genera array Iva", () => {
    const { detail } = buildInvoiceDetail(
      {
        ptoVta: 1,
        cbteTipo: CbteTipo.FACTURA_C,
        items: [{ neto: 5000 }],
      },
      1
    );

    expect(detail.ImpNeto).toBe(5000);
    expect(detail.ImpIVA).toBe(0);
    expect(detail.ImpTotal).toBe(5000);
    expect(detail.Iva).toBeUndefined();
  });

  it("acepta Date objects para servicio y fecha", () => {
    const { detail } = buildInvoiceDetail(
      {
        ptoVta: 1,
        cbteTipo: CbteTipo.FACTURA_B,
        items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
        fecha: new Date("2026-03-28T12:00:00"),
        servicio: {
          desde: new Date("2026-03-01"),
          hasta: new Date("2026-03-31"),
          vtoPago: new Date("2026-04-15"),
        },
      },
      1
    );

    expect(detail.CbteFch).toMatch(/^\d{8}$/);
    expect(detail.FchServDesde).toMatch(/^\d{8}$/);
  });

  it("pasa CanMisMonExt cuando se especifica", () => {
    const { detail } = buildInvoiceDetail(
      {
        ptoVta: 1,
        cbteTipo: CbteTipo.FACTURA_A,
        items: [{ neto: 1000, iva: IvaTipo.IVA_21 }],
        moneda: "DOL",
        cotizacion: 1200,
        canMisMonExt: "S",
      },
      1
    );

    expect(detail.MonId).toBe("DOL");
    expect(detail.MonCotiz).toBe(1200);
    expect(detail.CanMisMonExt).toBe("S");
  });
});

describe("toDateString", () => {
  it("pasa strings YYYYMMDD sin cambio", () => {
    expect(toDateString("20260328")).toBe("20260328");
  });

  it("formatea Date a YYYYMMDD en timezone Argentina", () => {
    const result = toDateString(new Date("2026-03-28T12:00:00Z"));
    expect(result).toMatch(/^\d{8}$/);
    expect(result.startsWith("2026")).toBe(true);
  });
});
