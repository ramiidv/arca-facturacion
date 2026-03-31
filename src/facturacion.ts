import { IVA_RATES, Concepto, DocTipo, CondicionIva, Moneda, isTipoC } from "./constants.js";
import type {
  LineItem,
  FacturarOpts,
  Importes,
  FacturaResult,
  InvoiceDetail,
  AlicuotaIva,
  FECAESolicitarResult,
  WsError,
} from "./types.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

/**
 * Calcula los importes de una factura a partir de line items.
 *
 * - Items con `iva` → gravados (ImpNeto + ImpIVA), agrupados por alícuota en el array Iva
 * - Items con `exento: true` → exentos (ImpOpEx)
 * - Items sin `iva` ni `exento` → no gravados (ImpTotConc)
 * - Para comprobantes tipo C (monotributista): no discrimina IVA, todo va a ImpNeto
 *
 * @param items - Line items con importe neto
 * @param opts - Opciones: tributos y si es tipo C
 * @returns Importes calculados e array de alícuotas IVA
 */
export function calcularTotales(
  items: LineItem[],
  opts?: { tributos?: { Importe: number }[]; tipoC?: boolean }
): { importes: Importes; iva: AlicuotaIva[] } {
  const tipoC = opts?.tipoC ?? false;

  // Para tipo C, no discriminar IVA: todo va a ImpNeto
  if (tipoC) {
    let impNeto = 0;
    for (const item of items) {
      impNeto = round2(impNeto + item.neto);
    }
    let impTrib = 0;
    if (opts?.tributos) {
      for (const t of opts.tributos) {
        impTrib = round2(impTrib + t.Importe);
      }
    }
    const impTotal = round2(impNeto + impTrib);
    return {
      importes: {
        total: impTotal,
        neto: impNeto,
        iva: 0,
        exento: 0,
        noGravado: 0,
        tributos: impTrib,
      },
      iva: [],
    };
  }

  let impNeto = 0;
  let impIVA = 0;
  let impOpEx = 0;
  let impTotConc = 0;
  const ivaMap = new Map<number, { baseImp: number; importe: number }>();

  for (const item of items) {
    if (item.exento) {
      impOpEx = round2(impOpEx + item.neto);
    } else if (item.iva !== undefined) {
      impNeto = round2(impNeto + item.neto);
      const rate = IVA_RATES[item.iva as keyof typeof IVA_RATES];
      if (rate === undefined) {
        throw new Error(`Tipo de IVA desconocido: ${item.iva}`);
      }
      const ivaAmount = round2((item.neto * rate) / 100);
      impIVA = round2(impIVA + ivaAmount);

      const existing = ivaMap.get(item.iva);
      if (existing) {
        existing.baseImp = round2(existing.baseImp + item.neto);
        existing.importe = round2(existing.importe + ivaAmount);
      } else {
        ivaMap.set(item.iva, { baseImp: item.neto, importe: ivaAmount });
      }
    } else {
      // No gravado
      impTotConc = round2(impTotConc + item.neto);
    }
  }

  let impTrib = 0;
  if (opts?.tributos) {
    for (const t of opts.tributos) {
      impTrib = round2(impTrib + t.Importe);
    }
  }

  const impTotal = round2(impNeto + impIVA + impOpEx + impTotConc + impTrib);

  const ivaArray: AlicuotaIva[] = Array.from(ivaMap.entries()).map(
    ([id, { baseImp, importe }]) => ({
      Id: id,
      BaseImp: baseImp,
      Importe: importe,
    })
  );

  return {
    importes: {
      total: impTotal,
      neto: impNeto,
      iva: impIVA,
      exento: impOpEx,
      noGravado: impTotConc,
      tributos: impTrib,
    },
    iva: ivaArray,
  };
}

/**
 * Construye un InvoiceDetail a partir de FacturarOpts y un número de comprobante.
 */
export function buildInvoiceDetail(
  opts: FacturarOpts,
  cbteNum: number
): { detail: InvoiceDetail; importes: Importes } {
  const esServicio = opts.servicio !== undefined;
  const concepto =
    opts.concepto ?? (esServicio ? Concepto.SERVICIOS : Concepto.PRODUCTOS);
  const tipoC = isTipoC(opts.cbteTipo);

  const { importes, iva: ivaArray } = calcularTotales(opts.items, {
    tributos: opts.tributos,
    tipoC,
  });

  const fecha = opts.fecha ? toDateString(opts.fecha) : toDateString(new Date());

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

  // CondicionIVAReceptorId: obligatorio desde abril 2026
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

  if (opts.opcionales && opts.opcionales.length > 0) {
    detail.Opcionales = opts.opcionales;
  }

  return { detail, importes };
}

/**
 * Parsea el resultado crudo de FECAESolicitar a un FacturaResult limpio.
 */
export function parseFacturaResult(
  result: FECAESolicitarResult,
  importes: Importes
): FacturaResult {
  const detArr = Array.isArray(result.FeDetResp.FECAEDetResponse)
    ? result.FeDetResp.FECAEDetResponse
    : [result.FeDetResp.FECAEDetResponse];

  const det = detArr[0];
  const aprobada = det.Resultado === "A";

  const observaciones: { code: number; msg: string }[] = [];
  if (det.Observaciones) {
    const obs: WsError[] = Array.isArray(det.Observaciones.Obs)
      ? det.Observaciones.Obs
      : [det.Observaciones.Obs];
    for (const o of obs) {
      observaciones.push({ code: o.Code, msg: o.Msg });
    }
  }

  return {
    aprobada,
    cae: aprobada ? det.CAE : undefined,
    caeVencimiento: aprobada ? det.CAEFchVto : undefined,
    cbteNro: Number(det.CbteDesde),
    ptoVta: Number(result.FeCabResp.PtoVta),
    cbteTipo: Number(result.FeCabResp.CbteTipo),
    importes,
    observaciones,
    raw: result,
  };
}
