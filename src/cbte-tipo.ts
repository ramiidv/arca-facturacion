import { ArcaValidationError, CondicionIva } from "@ramiidv/arca-common";
import { CbteTipo } from "./constants.js";

export type ClaseComprobante = "factura" | "nota_credito" | "nota_debito";

/*
 * Fuentes:
 * - RG 1415 (AFIP), Anexo II: los responsables inscriptos emiten clase A a otros
 *   responsables inscriptos y clase B al resto; monotributistas y exentos emiten clase C.
 * - RG 5003/2021, art. 2: los responsables inscriptos emiten clase A a los
 *   monotributistas (antes era B).
 * - Manual del desarrollador WSFEv1 (v4.7, 01/09/2026), tabla "Condición Frente
 *   al IVA del receptor" por clase de comprobante:
 *     A: 1 (RI), 6 (Monotributo), 13 (Monotributista Social), 16 (Monotributo Trabajador
 *        Independiente Promovido)
 *     B: 4 (Exento), 5 (Consumidor Final), 7 (No Categorizado), 8 (Proveedor del Exterior),
 *        9 (Cliente del Exterior), 10 (IVA Liberado Ley 19.640), 15 (IVA No Alcanzado)
 *     C: todas
 */
const RECEPTORES_CLASE_A = new Set<number>([
  CondicionIva.RESPONSABLE_INSCRIPTO,
  CondicionIva.MONOTRIBUTISTA,
  CondicionIva.MONOTRIBUTO_SOCIAL,
  CondicionIva.MONOTRIBUTO_INDEPENDIENTE_PROMOVIDO,
]);

const RECEPTORES_CLASE_B = new Set<number>([
  CondicionIva.EXENTO,
  CondicionIva.CONSUMIDOR_FINAL,
  CondicionIva.NO_CATEGORIZADO,
  CondicionIva.PROVEEDOR_EXTERIOR,
  CondicionIva.CLIENTE_EXTERIOR,
  CondicionIva.IVA_LIBERADO,
  CondicionIva.IVA_NO_ALCANZADO,
]);

const EMISORES_CLASE_C = new Set<number>([
  CondicionIva.MONOTRIBUTISTA,
  CondicionIva.MONOTRIBUTO_SOCIAL,
  CondicionIva.MONOTRIBUTO_INDEPENDIENTE_PROMOVIDO,
  CondicionIva.EXENTO,
]);

const POR_CLASE: Record<"A" | "B" | "C", Record<ClaseComprobante, CbteTipo>> = {
  A: { factura: CbteTipo.FACTURA_A, nota_credito: CbteTipo.NOTA_CREDITO_A, nota_debito: CbteTipo.NOTA_DEBITO_A },
  B: { factura: CbteTipo.FACTURA_B, nota_credito: CbteTipo.NOTA_CREDITO_B, nota_debito: CbteTipo.NOTA_DEBITO_B },
  C: { factura: CbteTipo.FACTURA_C, nota_credito: CbteTipo.NOTA_CREDITO_C, nota_debito: CbteTipo.NOTA_DEBITO_C },
};

function invalido(field: string, message: string, value: unknown): never {
  throw new ArcaValidationError(`Validación: ${message}`, [{ field, message, value }], field);
}

/**
 * Determina el tipo de comprobante (A, B o C) según la condición frente al IVA
 * del emisor y del receptor, para WSFEv1 (mercado interno).
 *
 * - Emisor Responsable Inscripto → A a RI y monotributistas; B al resto
 *   (consumidor final, exento, no categorizado, exterior, IVA liberado, no alcanzado).
 * - Emisor Monotributista o Exento → siempre C.
 *
 * No cubre comprobantes de exportación (clase E, WSFEX), FCE MiPyME ni clase M.
 *
 * @example
 * ```ts
 * resolverCbteTipo(CondicionIva.RESPONSABLE_INSCRIPTO, CondicionIva.CONSUMIDOR_FINAL); // FACTURA_B
 * resolverCbteTipo(CondicionIva.RESPONSABLE_INSCRIPTO, CondicionIva.MONOTRIBUTISTA, "nota_credito"); // NOTA_CREDITO_A
 * ```
 */
export function resolverCbteTipo(
  emisor: CondicionIva,
  receptor: CondicionIva,
  clase: ClaseComprobante = "factura"
): CbteTipo {
  if (!(clase in POR_CLASE.A)) invalido("clase", `clase de comprobante desconocida: ${clase}`, clase);

  if (EMISORES_CLASE_C.has(emisor)) return POR_CLASE.C[clase];

  if (emisor !== CondicionIva.RESPONSABLE_INSCRIPTO) {
    invalido(
      "emisor",
      `la condición frente al IVA ${emisor} no puede emitir comprobantes A, B ni C ` +
        "(solo Responsable Inscripto, Monotributista o Exento)",
      emisor
    );
  }

  if (RECEPTORES_CLASE_A.has(receptor)) return POR_CLASE.A[clase];
  if (RECEPTORES_CLASE_B.has(receptor)) return POR_CLASE.B[clase];
  return invalido("receptor", `condición frente al IVA del receptor desconocida: ${receptor}`, receptor);
}
