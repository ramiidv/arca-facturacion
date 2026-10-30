import {
  IVA_RATES,
  Concepto,
  DocTipo,
  CondicionIva,
  Moneda,
  isTipoC,
  WSFE_NUMERO_NO_CORRESPONDE,
} from "./constants.js";
import { ArcaWSFEError } from "./errors.js";
import { fail, validateFacturarOpts, validateItems } from "./validation.js";
import type {
  LineItem,
  FacturarOpts,
  Importes,
  FacturaResult,
  InvoiceDetail,
  AlicuotaIva,
  FECAESolicitarResult,
  FECompConsultarResult,
  WsError,
  ComprobanteArmado,
  IntentoComprobante,
  ComprobanteAsociado,
} from "./types.js";
import { toArray } from "./soap-client.js";

/**
 * Pasa un importe a centavos enteros. Desplaza la coma en la representación
 * decimal para evitar errores de punto flotante (1.005 → 101, no 100).
 */
function toCents(n: number): number {
  const s = String(n);
  return s.includes("e") ? Math.round(n * 100) : Math.round(Number(`${s}e2`));
}

const optString = (v: unknown): string | undefined =>
  v === undefined || v === null || v === "" ? undefined : String(v);

function fromCents(c: number): number {
  return c / 100;
}

/** Alícuota en puntos básicos (21% → 2100, 10,5% → 1050) para operar con enteros. */
function rateBasisPoints(ivaId: number): number {
  return Math.round(IVA_RATES[ivaId as keyof typeof IVA_RATES] * 100);
}

/**
 * Convierte un Date o string YYYYMMDD a string YYYYMMDD.
 * Si recibe un Date, lo formatea en timezone Argentina.
 */
export function toDateString(d: Date | string): string {
  if (typeof d === "string") return d;
  return d
    .toLocaleDateString("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    .replace(/-/g, "");
}

type BucketKey = number | "exento" | "noGravado" | "tipoC";

interface Bucket {
  key: BucketKey;
  /** Alícuota en puntos básicos (0 para exento, no gravado y tipo C) */
  rateBp: number;
  /** Base informada por items con `neto` (centavos) */
  netoCents: number;
  /** Precio final informado por items con `total` (centavos) */
  totalCents: number;
}

function itemAmountCents(item: LineItem): { neto: number; total: number } {
  return item.total !== undefined
    ? { neto: 0, total: toCents(item.total) }
    : { neto: toCents(item.neto), total: 0 };
}

/**
 * Calcula los importes de una factura a partir de line items.
 *
 * - Items con `iva` → gravados (ImpNeto + ImpIVA), agrupados por alícuota en el array Iva
 * - Items con `exento: true` → exentos (ImpOpEx)
 * - Items sin `iva` ni `exento` → no gravados (ImpTotConc)
 * - Para comprobantes tipo C (monotributista): no discrimina IVA, todo va a ImpNeto
 *
 * Cada item lleva `neto` (sin IVA) o `total` (IVA incluido). Con `total`, la
 * base se despeja como `total / (1 + alícuota)` redondeada, y el IVA es la
 * diferencia, así que base + IVA = total exacto.
 *
 * `descuentoGlobal` (monto final, IVA incluido) se prorratea entre alícuotas,
 * exento y no gravado en proporción a su total; el resto de redondeo del
 * prorrateo se asigna al grupo de mayor base. No afecta tributos.
 *
 * Todo se calcula en centavos enteros: la suma de BaseImp + Importe de todas
 * las alícuotas + exento + no gravado + tributos es exactamente ImpTotal.
 *
 * @param items - Line items
 * @param opts - Opciones: tributos, si es tipo C, y descuento global
 * @returns Importes calculados e array de alícuotas IVA
 * @throws ArcaValidationError si un item es inválido o el descuento supera el total
 */
export function calcularTotales(
  items: LineItem[],
  opts?: { tributos?: { Importe: number }[]; tipoC?: boolean; descuentoGlobal?: number }
): { importes: Importes; iva: AlicuotaIva[] } {
  validateItems(items, opts?.descuentoGlobal);
  const tipoC = opts?.tipoC ?? false;
  const buckets = new Map<BucketKey, Bucket>();

  const bucketFor = (key: BucketKey, rateBp: number): Bucket => {
    let b = buckets.get(key);
    if (!b) {
      b = { key, rateBp, netoCents: 0, totalCents: 0 };
      buckets.set(key, b);
    }
    return b;
  };

  for (const item of items) {
    const { neto, total } = itemAmountCents(item);
    let bucket: Bucket;
    if (tipoC) {
      bucket = bucketFor("tipoC", 0);
    } else if (item.exento) {
      bucket = bucketFor("exento", 0);
    } else if (item.iva !== undefined) {
      bucket = bucketFor(item.iva, rateBasisPoints(item.iva));
    } else {
      bucket = bucketFor("noGravado", 0);
    }
    bucket.netoCents += neto;
    bucket.totalCents += total;
  }

  const list = [...buckets.values()];

  // Precio final de cada grupo antes del descuento.
  const finals = list.map((b) => {
    const ivaSobreNeto = Math.round((b.netoCents * b.rateBp) / 10_000);
    return b.netoCents + ivaSobreNeto + b.totalCents;
  });
  // Base de cada grupo antes del descuento (para elegir el grupo que absorbe el resto).
  const basesPrevias = list.map((b) => b.netoCents + baseDesdeTotal(b.totalCents, b.rateBp));

  const descuentoCents = toCents(opts?.descuentoGlobal ?? 0);
  const totalItemsCents = finals.reduce((a, b) => a + b, 0);
  if (descuentoCents > totalItemsCents) {
    fail(
      "descuentoGlobal",
      `descuentoGlobal (${fromCents(descuentoCents)}) no puede superar el total de los items (${fromCents(totalItemsCents)})`,
      opts?.descuentoGlobal
    );
  }
  const shares = prorratear(descuentoCents, finals, basesPrevias);

  let impNeto = 0;
  let impIVA = 0;
  let impOpEx = 0;
  let impTotConc = 0;
  const ivaArray: AlicuotaIva[] = [];

  list.forEach((b, i) => {
    let base: number;
    let iva: number;
    if (descuentoCents > 0) {
      const final = finals[i] - shares[i];
      base = baseDesdeTotal(final, b.rateBp);
      iva = final - base;
    } else {
      base = basesPrevias[i];
      iva = finals[i] - base;
    }

    if (b.key === "tipoC") {
      impNeto += base;
    } else if (b.key === "exento") {
      impOpEx += base;
    } else if (b.key === "noGravado") {
      impTotConc += base;
    } else {
      impNeto += base;
      impIVA += iva;
      ivaArray.push({ Id: b.key, BaseImp: fromCents(base), Importe: fromCents(iva) });
    }
  });

  let impTrib = 0;
  for (const t of opts?.tributos ?? []) {
    impTrib += toCents(t.Importe);
  }

  const impTotal = impNeto + impIVA + impOpEx + impTotConc + impTrib;

  const importes: Importes = {
    total: fromCents(impTotal),
    neto: fromCents(impNeto),
    iva: fromCents(impIVA),
    exento: fromCents(impOpEx),
    noGravado: fromCents(impTotConc),
    tributos: fromCents(impTrib),
  };
  if (descuentoCents > 0) importes.descuento = fromCents(descuentoCents);

  return { importes, iva: ivaArray };
}

/** Despeja la base de un precio final: total / (1 + alícuota), redondeada al centavo. */
function baseDesdeTotal(totalCents: number, rateBp: number): number {
  if (rateBp === 0) return totalCents;
  return Math.round((totalCents * 10_000) / (10_000 + rateBp));
}

/**
 * Reparte `monto` centavos (<= suma de `pesos`) en proporción a `pesos`. Los
 * centavos que sobran del redondeo se asignan de a uno, empezando por el
 * índice de mayor `base` y sin que ninguna parte supere su peso (ningún grupo
 * queda negativo). Usa BigInt para no perder precisión con montos grandes.
 */
function prorratear(monto: number, pesos: number[], bases: number[]): number[] {
  const shares = pesos.map(() => 0);
  const totalPesos = pesos.reduce((a, b) => a + b, 0);
  if (monto === 0 || totalPesos <= 0) return shares;

  pesos.forEach((p, i) => {
    shares[i] = Number((BigInt(monto) * BigInt(p)) / BigInt(totalPesos));
  });

  let resto = monto - shares.reduce((a, b) => a + b, 0);
  const porBase = bases.map((_, i) => i).sort((a, b) => bases[b] - bases[a]);
  while (resto > 0) {
    for (const i of porBase) {
      if (resto === 0) break;
      if (shares[i] < pesos[i]) {
        shares[i]++;
        resto--;
      }
    }
  }
  return shares;
}

/**
 * Construye un InvoiceDetail a partir de FacturarOpts y un número de comprobante.
 * No valida: usar `armarComprobante` para validar y armar.
 *
 * @param ahora - Fecha a usar si `opts.fecha` no viene (default: ahora). Permite
 *   aplicar el desfase de reloj.
 */
export function buildInvoiceDetail(
  opts: FacturarOpts,
  cbteNum: number,
  ahora: Date = new Date()
): { detail: InvoiceDetail; importes: Importes } {
  const esServicio = opts.servicio !== undefined;
  const concepto =
    opts.concepto ?? (esServicio ? Concepto.SERVICIOS : Concepto.PRODUCTOS);
  const tipoC = isTipoC(opts.cbteTipo);

  const { importes, iva: ivaArray } = calcularTotales(opts.items, {
    tributos: opts.tributos,
    tipoC,
    descuentoGlobal: opts.descuentoGlobal,
  });

  const fecha = toDateString(opts.fecha ?? ahora);

  const detail: InvoiceDetail = {
    Concepto: concepto,
    DocTipo: opts.docTipo ?? DocTipo.CONSUMIDOR_FINAL,
    DocNro: opts.docNro ?? 0,
    CbteDesde: cbteNum,
    CbteHasta: cbteNum,
    CbteFch: fecha,
    ImpTotal: importes.total,
    ImpTotConc: importes.noGravado,
    ImpNeto: importes.neto,
    ImpOpEx: importes.exento,
    ImpTrib: importes.tributos,
    ImpIVA: importes.iva,
    MonId: opts.moneda ?? Moneda.PESOS,
    MonCotiz: opts.cotizacion ?? 1,
  };

  // CondicionIVAReceptorId: obligatorio según RG 5616 (ARCA rechaza sin él desde el
  // 01/12/2026). Solo se completa por defecto para consumidor final sin identificar.
  const docTipo = opts.docTipo ?? DocTipo.CONSUMIDOR_FINAL;
  if (opts.condicionIva != null) {
    detail.CondicionIVAReceptorId = opts.condicionIva;
  } else if (docTipo === DocTipo.CONSUMIDOR_FINAL) {
    detail.CondicionIVAReceptorId = CondicionIva.CONSUMIDOR_FINAL;
  }

  // CanMisMonExt: requerido para moneda extranjera
  if (opts.canMisMonExt) {
    detail.CanMisMonExt = opts.canMisMonExt;
  }

  if (ivaArray.length > 0) {
    detail.Iva = ivaArray;
  }

  if (opts.servicio) {
    detail.FchServDesde = toDateString(opts.servicio.desde);
    detail.FchServHasta = toDateString(opts.servicio.hasta);
    detail.FchVtoPago = toDateString(opts.servicio.vtoPago);
  }

  if (opts.tributos && opts.tributos.length > 0) {
    detail.Tributos = opts.tributos;
  }

  if (opts.cbtesAsoc && opts.cbtesAsoc.length > 0) {
    detail.CbtesAsoc = opts.cbtesAsoc.map(
      (c): ComprobanteAsociado => ({
        Tipo: c.tipo,
        PtoVta: c.ptoVta,
        Nro: c.nro,
        ...(c.cuit !== undefined && { Cuit: c.cuit }),
        ...(c.fecha !== undefined && { CbteFch: toDateString(c.fecha) }),
      })
    );
  }

  if (opts.opcionales && opts.opcionales.length > 0) {
    detail.Opcionales = opts.opcionales;
  }

  return { detail, importes };
}

/**
 * Valida y arma un comprobante listo para enviar, sin tocar la red.
 *
 * Devuelve también el `intento`: persistilo antes de enviar, y si el proceso se
 * cae o el resultado es incierto, pasalo a `recuperarComprobante`.
 *
 * @example
 * ```ts
 * const { request, importes, intento } = armarComprobante({
 *   ptoVta: 1, cbteTipo: CbteTipo.FACTURA_B, cbteNro: 151,
 *   items: [{ total: 1210, iva: IvaTipo.IVA_21 }],
 * });
 * ```
 */
export function armarComprobante(
  opts: FacturarOpts & { cbteNro: number },
  ctx?: { ahora?: Date }
): ComprobanteArmado {
  validateFacturarOpts(opts);
  const { detail, importes } = buildInvoiceDetail(opts, opts.cbteNro, ctx?.ahora);
  return {
    request: detail,
    importes,
    intento: intentoDesdeComprobante(opts.ptoVta, opts.cbteTipo, detail),
  };
}

/** Arma el `IntentoComprobante` de un detalle ya armado (ej: uno persistido). */
export function intentoDesdeComprobante(
  ptoVta: number,
  cbteTipo: number,
  detail: InvoiceDetail
): IntentoComprobante {
  return {
    ptoVta,
    cbteTipo,
    cbteNro: detail.CbteDesde,
    importeTotal: detail.ImpTotal,
    docTipo: detail.DocTipo,
    docNro: Number(detail.DocNro),
    fecha: detail.CbteFch,
  };
}

/**
 * Compara un comprobante consultado en ARCA con un intento de emisión.
 * Coincide si son iguales DocTipo, DocNro, CbteFch e ImpTotal (con tolerancia
 * de 0,01) y el comprobante está aprobado.
 */
export function coincideConIntento(
  consulta: FECompConsultarResult,
  intento: IntentoComprobante
): boolean {
  const r = consulta.ResultGet;
  if (!r) return false;
  return (
    (r.Resultado === undefined || r.Resultado === "A") &&
    Math.abs(Number(r.ImpTotal) - intento.importeTotal) <= 0.01 + 1e-9 &&
    Number(r.DocTipo) === Number(intento.docTipo) &&
    Number(r.DocNro) === Number(intento.docNro) &&
    String(r.CbteFch) === String(intento.fecha)
  );
}

function parseObservaciones(obs?: { Obs: WsError | WsError[] }): { code: number; msg: string }[] {
  return toArray(obs?.Obs).map((o) => ({ code: Number(o.Code), msg: String(o.Msg) }));
}

/**
 * Parsea el resultado crudo de FECAESolicitar a un FacturaResult limpio.
 */
export function parseFacturaResult(
  result: FECAESolicitarResult,
  importes: Importes
): FacturaResult {
  const det = toArray(result.FeDetResp.FECAEDetResponse)[0];
  const aprobada = det.Resultado === "A";

  return {
    aprobada,
    // En FECAEARegInformativo el código es el CAEA y no hay vencimiento por comprobante.
    cae: aprobada ? optString(det.CAE ?? det.CAEA) : undefined,
    caeVencimiento: aprobada ? optString(det.CAEFchVto) : undefined,
    cbteNro: Number(det.CbteDesde),
    ptoVta: Number(result.FeCabResp.PtoVta),
    cbteTipo: Number(result.FeCabResp.CbteTipo),
    importes,
    observaciones: parseObservaciones(det.Observaciones),
    raw: result,
  };
}

/**
 * Arma un FacturaResult a partir de un comprobante consultado con FECompConsultar
 * (lo usa `recuperarComprobante`).
 */
export function facturaResultDesdeConsulta(consulta: FECompConsultarResult): FacturaResult {
  const r = consulta.ResultGet;
  const aprobada = r.Resultado === undefined || r.Resultado === "A";
  return {
    aprobada,
    cae: aprobada ? optString(r.CodAutorizacion) : undefined,
    caeVencimiento: aprobada ? optString(r.FchVto) : undefined,
    cbteNro: Number(r.CbteDesde),
    ptoVta: Number(r.PtoVta),
    cbteTipo: Number(r.CbteTipo),
    importes: {
      total: Number(r.ImpTotal),
      neto: Number(r.ImpNeto),
      iva: Number(r.ImpIVA),
      exento: Number(r.ImpOpEx),
      noGravado: Number(r.ImpTotConc),
      tributos: Number(r.ImpTrib),
    },
    observaciones: parseObservaciones(r.Observaciones),
    raw: consulta,
  };
}

/**
 * `true` si el resultado de una emisión indica que el número ya fue usado
 * (validación 10016): ARCA rechazó este envío, pero un intento anterior con el
 * mismo número pudo haberse autorizado. Resolverlo con `recuperarComprobante`
 * antes de marcar el comprobante como rechazado.
 *
 * Acepta un `FacturaResult` (rechazo con observaciones) o el error lanzado.
 */
export function requiereRecuperacion(resultadoOError: FacturaResult | unknown): boolean {
  if (resultadoOError instanceof ArcaWSFEError) {
    return resultadoOError.tieneCodigo(WSFE_NUMERO_NO_CORRESPONDE);
  }
  const r = resultadoOError as Partial<FacturaResult> | null;
  return (
    !!r &&
    r.aprobada === false &&
    Array.isArray(r.observaciones) &&
    r.observaciones.some((o) => Number(o.code) === WSFE_NUMERO_NO_CORRESPONDE)
  );
}
