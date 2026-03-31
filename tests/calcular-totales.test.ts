import { describe, it, expect } from "vitest";
import { calcularTotales } from "../src/facturacion.js";
import { IvaTipo } from "../src/constants.js";

describe("calcularTotales", () => {
  it("calcula IVA 21% correctamente", () => {
    const { importes, iva } = calcularTotales([
      { neto: 100, iva: IvaTipo.IVA_21 },
    ]);

    expect(importes.neto).toBe(100);
    expect(importes.iva).toBe(21);
    expect(importes.total).toBe(121);
    expect(importes.exento).toBe(0);
    expect(importes.noGravado).toBe(0);
    expect(importes.tributos).toBe(0);
    expect(iva).toHaveLength(1);
    expect(iva[0]).toEqual({ Id: IvaTipo.IVA_21, BaseImp: 100, Importe: 21 });
  });

  it("agrupa múltiples items por alícuota", () => {
    const { importes, iva } = calcularTotales([
      { neto: 1000, iva: IvaTipo.IVA_21 },
      { neto: 500, iva: IvaTipo.IVA_21 },
      { neto: 200, iva: IvaTipo.IVA_10_5 },
    ]);

    expect(importes.neto).toBe(1700);
    expect(importes.iva).toBe(336); // 1500*0.21 + 200*0.105
    expect(importes.total).toBe(2036);
    expect(iva).toHaveLength(2);

    const iva21 = iva.find((i) => i.Id === IvaTipo.IVA_21)!;
    expect(iva21.BaseImp).toBe(1500);
    expect(iva21.Importe).toBe(315);

    const iva105 = iva.find((i) => i.Id === IvaTipo.IVA_10_5)!;
    expect(iva105.BaseImp).toBe(200);
    expect(iva105.Importe).toBe(21);
  });

  it("maneja items exentos", () => {
    const { importes, iva } = calcularTotales([
      { neto: 100, iva: IvaTipo.IVA_21 },
      { neto: 300, exento: true },
    ]);

    expect(importes.neto).toBe(100);
    expect(importes.exento).toBe(300);
    expect(importes.total).toBe(421);
    expect(iva).toHaveLength(1);
  });

  it("maneja items no gravados (sin iva ni exento)", () => {
    const { importes, iva } = calcularTotales([
      { neto: 100, iva: IvaTipo.IVA_21 },
      { neto: 150 },
    ]);

    expect(importes.neto).toBe(100);
    expect(importes.noGravado).toBe(150);
    expect(importes.total).toBe(271);
    expect(iva).toHaveLength(1);
  });

  it("incluye tributos en el total", () => {
    const { importes } = calcularTotales(
      [{ neto: 1000, iva: IvaTipo.IVA_21 }],
      { tributos: [{ Importe: 50 }, { Importe: 30 }] }
    );

    expect(importes.tributos).toBe(80);
    expect(importes.total).toBe(1000 + 210 + 80);
  });

  it("tipo C: no discrimina IVA", () => {
    const { importes, iva } = calcularTotales(
      [{ neto: 1000, iva: IvaTipo.IVA_21 }, { neto: 500 }],
      { tipoC: true }
    );

    expect(importes.neto).toBe(1500);
    expect(importes.iva).toBe(0);
    expect(importes.exento).toBe(0);
    expect(importes.noGravado).toBe(0);
    expect(importes.total).toBe(1500);
    expect(iva).toHaveLength(0);
  });

  it("IVA 0% se incluye en neto y en array Iva con importe 0", () => {
    const { importes, iva } = calcularTotales([
      { neto: 500, iva: IvaTipo.IVA_0 },
    ]);

    expect(importes.neto).toBe(500);
    expect(importes.iva).toBe(0);
    expect(importes.total).toBe(500);
    expect(iva).toHaveLength(1);
    expect(iva[0]).toEqual({ Id: IvaTipo.IVA_0, BaseImp: 500, Importe: 0 });
  });

  it("redondea a 2 decimales", () => {
    const { importes } = calcularTotales([
      { neto: 33.33, iva: IvaTipo.IVA_21 },
    ]);

    expect(importes.iva).toBe(7); // 33.33 * 0.21 = 6.9993 → 7.0
    expect(importes.total).toBe(40.33);
  });

  it("tira error con tipo de IVA desconocido", () => {
    expect(() =>
      calcularTotales([{ neto: 100, iva: 999 }])
    ).toThrow("Tipo de IVA desconocido: 999");
  });
});
