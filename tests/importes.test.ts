import { describe, expect, it } from "vitest";
import { ArcaValidationError } from "@ramiidv/arca-common";
import { armarComprobante, calcularTotales } from "../src/facturacion.js";
import { CbteTipo, IvaTipo } from "../src/constants.js";
import type { InvoiceDetail, LineItem } from "../src/types.js";

const cents = (n: number) => Math.round(n * 100);

/** Invariante: BaseImp + Importe de cada alícuota + exento + no gravado + tributos = ImpTotal, al centavo. */
function sumaExacta(d: InvoiceDetail): boolean {
  const alicuotas = (d.Iva ?? []).reduce((a, i) => a + cents(i.BaseImp) + cents(i.Importe), 0);
  return alicuotas + cents(d.ImpOpEx) + cents(d.ImpTotConc) + cents(d.ImpTrib) === cents(d.ImpTotal) &&
    (d.Iva ?? []).reduce((a, i) => a + cents(i.BaseImp), 0) === cents(d.ImpNeto) &&
    (d.Iva ?? []).reduce((a, i) => a + cents(i.Importe), 0) === cents(d.ImpIVA);
}

function armar(items: LineItem[], extra: Record<string, unknown> = {}) {
  return armarComprobante({
    ptoVta: 1,
    cbteTipo: CbteTipo.FACTURA_B,
    cbteNro: 1,
    fecha: "20261030",
    items,
    ...extra,
  });
}

describe("precios con IVA incluido", () => {
  it("un solo ítem de $1 al 21%", () => {
    const { request } = armar([{ total: 1, iva: IvaTipo.IVA_21 }]);
    expect(request.ImpTotal).toBe(1);
    expect(request.Iva).toEqual([{ Id: IvaTipo.IVA_21, BaseImp: 0.83, Importe: 0.17 }]);
    expect(sumaExacta(request)).toBe(true);
  });

  it("mezcla de 21% y 10,5%", () => {
    const { request } = armar([
      { total: 1210, iva: IvaTipo.IVA_21 },
      { total: 99.99, iva: IvaTipo.IVA_21 },
      { total: 552.5, iva: IvaTipo.IVA_10_5 },
    ]);
    expect(request.ImpTotal).toBe(1862.49);
    const iva21 = request.Iva!.find((i) => i.Id === IvaTipo.IVA_21)!;
    const iva105 = request.Iva!.find((i) => i.Id === IvaTipo.IVA_10_5)!;
    expect(cents(iva21.BaseImp) + cents(iva21.Importe)).toBe(130999);
    expect(iva105).toEqual({ Id: IvaTipo.IVA_10_5, BaseImp: 500, Importe: 52.5 });
    expect(sumaExacta(request)).toBe(true);
  });

  it("exentos y no gravados con total: total = neto", () => {
    const { request } = armar([
      { total: 121, iva: IvaTipo.IVA_21 },
      { total: 50.5, exento: true },
      { total: 10 },
    ]);
    expect(request.ImpOpEx).toBe(50.5);
    expect(request.ImpTotConc).toBe(10);
    expect(request.ImpNeto).toBe(100);
    expect(request.ImpIVA).toBe(21);
    expect(request.ImpTotal).toBe(181.5);
    expect(sumaExacta(request)).toBe(true);
  });

  it("se pueden mezclar items con neto y con total", () => {
    const { request } = armar([
      { neto: 100, iva: IvaTipo.IVA_21 },
      { total: 121, iva: IvaTipo.IVA_21 },
    ]);
    expect(request.Iva).toEqual([{ Id: IvaTipo.IVA_21, BaseImp: 200, Importe: 42 }]);
    expect(request.ImpTotal).toBe(242);
  });

  it("tipo C con total: todo va a ImpNeto", () => {
    const { request } = armarComprobante({
      ptoVta: 1,
      cbteTipo: CbteTipo.FACTURA_C,
      cbteNro: 1,
      fecha: "20261030",
      items: [{ total: 1500.5 }],
    });
    expect(request.ImpNeto).toBe(1500.5);
    expect(request.ImpIVA).toBe(0);
    expect(request.ImpTotal).toBe(1500.5);
    expect(request.Iva).toBeUndefined();
  });
});

describe("descuento global", () => {
  it("se prorratea en proporción al total de cada grupo", () => {
    const { request, importes } = armar(
      [
        { total: 1210, iva: IvaTipo.IVA_21 },
        { total: 500, exento: true },
      ],
      { descuentoGlobal: 171 }
    );
    // 1210/1710 * 171 = 121 ; 500/1710 * 171 = 50
    expect(request.ImpTotal).toBe(1539);
    expect(request.ImpOpEx).toBe(450);
    expect(request.Iva).toEqual([{ Id: IvaTipo.IVA_21, BaseImp: 900, Importe: 189 }]);
    expect(importes.descuento).toBe(171);
    expect(sumaExacta(request)).toBe(true);
  });

  it("un descuento que deja centavos impares: el resto va al grupo de mayor base", () => {
    const { request } = armar(
      [
        { total: 100, iva: IvaTipo.IVA_21 },
        { total: 100, iva: IvaTipo.IVA_10_5 },
        { total: 100.01, exento: true },
      ],
      { descuentoGlobal: 0.01 * 7 }
    );
    expect(request.ImpTotal).toBe(299.94);
    expect(sumaExacta(request)).toBe(true);
  });

  it("no afecta los tributos", () => {
    const { request } = armar([{ total: 121, iva: IvaTipo.IVA_21 }], {
      descuentoGlobal: 21,
      tributos: [{ Id: 99, Desc: "Otro", BaseImp: 100, Alic: 0, Importe: 3.33 }],
    });
    expect(request.ImpTrib).toBe(3.33);
    expect(request.ImpTotal).toBe(103.33);
    expect(sumaExacta(request)).toBe(true);
  });

  it("con muchos ítems e importes irregulares la suma siempre es exacta", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const tasas = [IvaTipo.IVA_21, IvaTipo.IVA_10_5, IvaTipo.IVA_27, IvaTipo.IVA_5, IvaTipo.IVA_2_5, IvaTipo.IVA_0];
    for (let caso = 0; caso < 200; caso++) {
      const items: LineItem[] = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => {
        const monto = Math.round(rnd() * 100_000) / 100;
        const r = rnd();
        if (r < 0.1) return { total: monto, exento: true };
        if (r < 0.15) return { neto: monto };
        const iva = tasas[Math.floor(rnd() * tasas.length)];
        return rnd() < 0.5 ? { total: monto, iva } : { neto: monto, iva };
      });
      const bruto = calcularTotales(items).importes.total;
      const descuentoGlobal = Math.round(rnd() * bruto * 100) / 100;
      const { request } = armar(items, { descuentoGlobal });
      expect(sumaExacta(request)).toBe(true);
      expect(cents(request.ImpTotal)).toBe(cents(bruto) - cents(descuentoGlobal));
    }
  });
});

describe("validación de items y descuento", () => {
  it("neto y total son mutuamente excluyentes", () => {
    expect(() => armar([{ neto: 100, total: 121, iva: IvaTipo.IVA_21 } as unknown as LineItem])).toThrow(
      ArcaValidationError
    );
  });

  it("requiere neto o total", () => {
    expect(() => armar([{ iva: IvaTipo.IVA_21 } as unknown as LineItem])).toThrow(/neto o .*total es requerido/);
  });

  it("el descuento no puede superar el total ni ser negativo", () => {
    expect(() => armar([{ total: 100, iva: IvaTipo.IVA_21 }], { descuentoGlobal: 100.01 })).toThrow(ArcaValidationError);
    expect(() => armar([{ total: 100, iva: IvaTipo.IVA_21 }], { descuentoGlobal: -1 })).toThrow(ArcaValidationError);
  });
});

describe("armarComprobante", () => {
  it("es puro, no usa la red, y devuelve el intento", () => {
    const { request, importes, intento } = armar([{ total: 1210, iva: IvaTipo.IVA_21 }], { cbteNro: 77 });
    expect(request.CbteDesde).toBe(77);
    expect(request.CondicionIVAReceptorId).toBe(5);
    expect(importes.total).toBe(1210);
    expect(intento).toEqual({
      ptoVta: 1,
      cbteTipo: CbteTipo.FACTURA_B,
      cbteNro: 77,
      importeTotal: 1210,
      docTipo: 99,
      docNro: 0,
      fecha: "20261030",
    });
    expect(JSON.parse(JSON.stringify(intento))).toEqual(intento);
  });

  it("valida (ej: cbteNro inválido)", () => {
    expect(() => armar([{ total: 1, iva: IvaTipo.IVA_21 }], { cbteNro: 0 })).toThrow(ArcaValidationError);
  });
});
