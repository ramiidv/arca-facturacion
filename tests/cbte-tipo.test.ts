import { describe, expect, it } from "vitest";
import { ArcaValidationError } from "@ramiidv/arca-common";
import { resolverCbteTipo } from "../src/cbte-tipo.js";
import { CbteTipo, CondicionIva } from "../src/constants.js";

const RI = CondicionIva.RESPONSABLE_INSCRIPTO;

describe("resolverCbteTipo", () => {
  it.each([
    [CondicionIva.RESPONSABLE_INSCRIPTO, CbteTipo.FACTURA_A],
    [CondicionIva.MONOTRIBUTISTA, CbteTipo.FACTURA_A],
    [CondicionIva.MONOTRIBUTO_SOCIAL, CbteTipo.FACTURA_A],
    [CondicionIva.MONOTRIBUTO_INDEPENDIENTE_PROMOVIDO, CbteTipo.FACTURA_A],
    [CondicionIva.CONSUMIDOR_FINAL, CbteTipo.FACTURA_B],
    [CondicionIva.EXENTO, CbteTipo.FACTURA_B],
    [CondicionIva.NO_CATEGORIZADO, CbteTipo.FACTURA_B],
    [CondicionIva.CLIENTE_EXTERIOR, CbteTipo.FACTURA_B],
    [CondicionIva.PROVEEDOR_EXTERIOR, CbteTipo.FACTURA_B],
    [CondicionIva.IVA_LIBERADO, CbteTipo.FACTURA_B],
    [CondicionIva.IVA_NO_ALCANZADO, CbteTipo.FACTURA_B],
  ])("RI → receptor %i: %i", (receptor, esperado) => {
    expect(resolverCbteTipo(RI, receptor)).toBe(esperado);
  });

  it("emisor monotributista o exento: siempre C", () => {
    for (const emisor of [CondicionIva.MONOTRIBUTISTA, CondicionIva.MONOTRIBUTO_SOCIAL, CondicionIva.EXENTO]) {
      expect(resolverCbteTipo(emisor, RI)).toBe(CbteTipo.FACTURA_C);
      expect(resolverCbteTipo(emisor, CondicionIva.CONSUMIDOR_FINAL)).toBe(CbteTipo.FACTURA_C);
    }
  });

  it("notas de crédito y débito", () => {
    expect(resolverCbteTipo(RI, RI, "nota_credito")).toBe(CbteTipo.NOTA_CREDITO_A);
    expect(resolverCbteTipo(RI, CondicionIva.CONSUMIDOR_FINAL, "nota_debito")).toBe(CbteTipo.NOTA_DEBITO_B);
    expect(resolverCbteTipo(CondicionIva.MONOTRIBUTISTA, RI, "nota_credito")).toBe(CbteTipo.NOTA_CREDITO_C);
  });

  it("emisor que no puede emitir A/B/C", () => {
    expect(() => resolverCbteTipo(CondicionIva.CONSUMIDOR_FINAL, RI)).toThrow(ArcaValidationError);
  });
});
