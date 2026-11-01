import { ArcaValidationError, formatDate, validateCuit } from "@ramiidv/arca-common";
import { CondicionIva } from "@ramiidv/arca-common";
import {
  CbteTipo,
  Concepto,
  DocTipo,
  IVA_RATES,
  Moneda,
  TipoExpo,
  isFCE,
  isNotaCreditoODebito,
  isTipoA,
  isTipoE,
} from "./constants.js";
import type {
  FacturarOpts,
  FacturarExpoOpts,
  InvoiceRequest,
  LineItem,
  ExpoLineItem,
} from "./types.js";

/** Lanza un ArcaValidationError con el formato común del SDK. */
export function fail(field: string, msg: string, value?: unknown): never {
  throw new ArcaValidationError(`Validación: ${msg}`, [{ field, message: msg, value }], field);
}

function isAmount(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Valida una fecha (Date o YYYYMMDD / YYYY-MM-DD existente) y la devuelve como YYYYMMDD. */
function checkFecha(field: string, fecha: unknown): string {
  try {
    return formatDate(fecha as Date | string);
  } catch {
    fail(field, `${field} debe ser un Date o una fecha existente con formato YYYYMMDD o YYYY-MM-DD`, fecha);
  }
}

function checkCuit(field: string, cuit: unknown): void {
  try {
    validateCuit(cuit as string | number);
  } catch {
    fail(field, `${field} no es un CUIT válido (dígito verificador)`, cuit);
  }
}

function checkEntero(field: string, n: unknown, min: number): void {
  if (typeof n !== "number" || !Number.isInteger(n) || n < min)
    fail(field, `${field} debe ser un entero >= ${min}`, n);
}

/** Receptores válidos para comprobantes clase A (manual WSFEv1, tabla de condición frente al IVA del receptor). */
const RECEPTORES_CLASE_A = new Set<number>([
  CondicionIva.RESPONSABLE_INSCRIPTO,
  CondicionIva.MONOTRIBUTISTA,
  CondicionIva.MONOTRIBUTO_SOCIAL,
  CondicionIva.MONOTRIBUTO_INDEPENDIENTE_PROMOVIDO,
]);

/**
 * Valida moneda, cotización y CanMisMonExt según el manual de WSFEv1:
 * - 10039: con PES, la cotización debe ser 1.
 * - 10038: con moneda extranjera la cotización es obligatoria (> 0) salvo CanMisMonExt = "S".
 * - 10239/10241: CanMisMonExt es "S" o "N", y con PES no puede ser "S".
 */
function checkMoneda(
  f: (name: string) => string,
  moneda: string,
  cotizacion: number | undefined,
  canMisMonExt: string | undefined,
  names: { cotizacion: string; canMisMonExt: string }
): void {
  if (cotizacion !== undefined && (!isAmount(cotizacion) || cotizacion <= 0))
    fail(f(names.cotizacion), `${names.cotizacion} debe ser un número mayor a 0`, cotizacion);
  if (canMisMonExt !== undefined && canMisMonExt !== "S" && canMisMonExt !== "N")
    fail(f(names.canMisMonExt), `${names.canMisMonExt} debe ser "S" o "N"`, canMisMonExt);
  if (moneda === Moneda.PESOS) {
    if (cotizacion !== undefined && cotizacion !== 1)
      fail(f(names.cotizacion), `con moneda PES ${names.cotizacion} debe ser 1 (validación 10039)`, cotizacion);
    if (canMisMonExt === "S")
      fail(f(names.canMisMonExt), `${names.canMisMonExt} "S" solo aplica a moneda extranjera (validación 10241)`, canMisMonExt);
  } else if (cotizacion === undefined && canMisMonExt !== "S") {
    fail(
      f(names.cotizacion),
      `${names.cotizacion} es requerido para moneda extranjera (salvo ${names.canMisMonExt} "S")`
    );
  }
}

export function validateFacturarOpts(opts: FacturarOpts): void {
  if (!opts.ptoVta || !Number.isInteger(opts.ptoVta) || opts.ptoVta < 1)
    fail("ptoVta", "ptoVta debe ser un entero >= 1", opts.ptoVta);
  if (!opts.cbteTipo)
    fail("cbteTipo", "cbteTipo es requerido");
  if (isTipoE(opts.cbteTipo))
    fail(
      "cbteTipo",
      `los comprobantes de exportación (clase E, tipo ${opts.cbteTipo}) se emiten por WSFEX: usar facturarExpo`,
      opts.cbteTipo
    );
  if (opts.cbteNro !== undefined && (!Number.isInteger(opts.cbteNro) || opts.cbteNro < 1))
    fail("cbteNro", "cbteNro debe ser un entero >= 1", opts.cbteNro);
  if (!opts.items || opts.items.length === 0)
    fail("items", "items no puede estar vacío");

  validateItems(opts.items, opts.descuentoGlobal);

  if (opts.fecha !== undefined) checkFecha("fecha", opts.fecha);

  // Concepto y fechas de servicio (validaciones 10031-10035 y 10049).
  if (opts.concepto !== undefined && ![Concepto.PRODUCTOS, Concepto.SERVICIOS, Concepto.PRODUCTOS_Y_SERVICIOS].includes(opts.concepto))
    fail("concepto", "concepto debe ser 1 (productos), 2 (servicios) o 3 (productos y servicios)", opts.concepto);
  const concepto = opts.concepto ?? (opts.servicio !== undefined ? Concepto.SERVICIOS : Concepto.PRODUCTOS);
  if (concepto === Concepto.PRODUCTOS && opts.servicio !== undefined)
    fail("servicio", "servicio (FchServDesde/FchServHasta/FchVtoPago) solo se informa con concepto 2 o 3");
  if (concepto !== Concepto.PRODUCTOS && opts.servicio === undefined)
    fail("servicio", `servicio (desde, hasta, vtoPago) es requerido para concepto ${concepto}`);
  if (opts.servicio) {
    if (!opts.servicio.desde) fail("servicio.desde", "servicio.desde es requerido");
    if (!opts.servicio.hasta) fail("servicio.hasta", "servicio.hasta es requerido");
    if (!opts.servicio.vtoPago) fail("servicio.vtoPago", "servicio.vtoPago es requerido");
    const desde = checkFecha("servicio.desde", opts.servicio.desde);
    const hasta = checkFecha("servicio.hasta", opts.servicio.hasta);
    checkFecha("servicio.vtoPago", opts.servicio.vtoPago);
    if (desde > hasta)
      fail("servicio.hasta", "servicio.hasta no puede ser anterior a servicio.desde (validación 10032)", opts.servicio.hasta);
  }

  checkMoneda((n) => n, opts.moneda ?? Moneda.PESOS, opts.cotizacion, opts.canMisMonExt, {
    cotizacion: "cotizacion",
    canMisMonExt: "canMisMonExt",
  });

  // Receptor.
  const docTipo = opts.docTipo ?? DocTipo.CONSUMIDOR_FINAL;
  if (opts.docNro !== undefined && (!Number.isInteger(opts.docNro) || opts.docNro < 0))
    fail("docNro", "docNro debe ser un entero >= 0", opts.docNro);
  if (docTipo === DocTipo.CUIT || docTipo === DocTipo.CUIL) checkCuit("docNro", opts.docNro);

  // CondicionIVAReceptorId es obligatorio según RG 5616 (ARCA rechaza sin él desde el
  // 01/12/2026). Solo se completa por defecto para consumidor final sin identificar
  // (docTipo 99): un CUIT puede ser RI, monotributista o exento, así que no se infiere.
  if (docTipo !== DocTipo.CONSUMIDOR_FINAL && opts.condicionIva == null)
    fail(
      "condicionIva",
      `condicionIva es requerido cuando el receptor está identificado (docTipo ${docTipo}). ` +
        "Usar enum CondicionIva; se puede obtener del padrón con condicionIvaDesdePadron (@ramiidv/arca-padron)."
    );
  if (isTipoA(opts.cbteTipo)) {
    if (docTipo === DocTipo.CONSUMIDOR_FINAL)
      fail("docTipo", "un comprobante clase A requiere un receptor identificado (docTipo 80 CUIT), no 99 (validación 10243)", docTipo);
    if (opts.condicionIva != null && !RECEPTORES_CLASE_A.has(opts.condicionIva))
      fail(
        "condicionIva",
        `la condición frente al IVA ${opts.condicionIva} no es válida para comprobantes clase A (validación 10243)`,
        opts.condicionIva
      );
  }

  if (opts.tributos) {
    opts.tributos.forEach((t, i) => {
      const f = (n: string) => `tributos[${i}].${n}`;
      if (t.Id == null || !Number.isInteger(t.Id)) fail(f("Id"), "tributo.Id es requerido y debe ser un entero", t.Id);
      if (!isAmount(t.Importe) || t.Importe < 0) fail(f("Importe"), "tributo.Importe debe ser un número >= 0", t.Importe);
      if (!isAmount(t.BaseImp) || t.BaseImp < 0) fail(f("BaseImp"), "tributo.BaseImp debe ser un número >= 0", t.BaseImp);
      if (!isAmount(t.Alic) || t.Alic < 0) fail(f("Alic"), "tributo.Alic debe ser un número >= 0", t.Alic);
    });
  }

  if (opts.cbtesAsoc) {
    opts.cbtesAsoc.forEach((c, i) => {
      if (!c.tipo) fail(`cbtesAsoc[${i}].tipo`, "cbtesAsoc.tipo es requerido");
      if (!c.ptoVta) fail(`cbtesAsoc[${i}].ptoVta`, "cbtesAsoc.ptoVta es requerido");
      if (!c.nro) fail(`cbtesAsoc[${i}].nro`, "cbtesAsoc.nro es requerido");
      if (c.fecha !== undefined) checkFecha(`cbtesAsoc[${i}].fecha`, c.fecha);
      if (c.cuit !== undefined) checkCuit(`cbtesAsoc[${i}].cuit`, c.cuit);
    });
  }

  if (opts.periodoAsoc) {
    if (!isNotaCreditoODebito(opts.cbteTipo))
      fail("periodoAsoc", "periodoAsoc solo se informa en notas de crédito o débito (validación 10198)");
    if (isFCE(opts.cbteTipo))
      fail("periodoAsoc", "los comprobantes FCE MiPyME no admiten periodoAsoc (validación 10196)");
    const desde = checkFecha("periodoAsoc.desde", opts.periodoAsoc.desde);
    const hasta = checkFecha("periodoAsoc.hasta", opts.periodoAsoc.hasta);
    if (desde > hasta)
      fail("periodoAsoc.hasta", "periodoAsoc.hasta debe ser igual o posterior a periodoAsoc.desde (validación 10207)");
  }

  opts.actividades?.forEach((a, i) => checkEntero(`actividades[${i}]`, a, 1));
}

/**
 * Valida la forma de los items y del descuento global. Que el descuento no
 * supere el total se valida al calcular los importes (al centavo).
 */
export function validateItems(items: LineItem[], descuentoGlobal?: number): void {
  items.forEach(validateLineItem);
  if (descuentoGlobal !== undefined && (!isAmount(descuentoGlobal) || descuentoGlobal < 0))
    fail("descuentoGlobal", "descuentoGlobal debe ser un número >= 0", descuentoGlobal);
}

function validateLineItem(item: LineItem, index: number): void {
  const field = `items[${index}]`;
  const hasNeto = item.neto !== undefined;
  const hasTotal = item.total !== undefined;

  if (hasNeto && hasTotal)
    fail(field, `${field} no puede tener 'neto' y 'total' a la vez`);
  if (!hasNeto && !hasTotal)
    fail(`${field}.neto`, `${field}.neto o ${field}.total es requerido y debe ser un número`);

  const amount = hasTotal ? item.total : item.neto;
  const amountField = hasTotal ? "total" : "neto";
  if (!isAmount(amount))
    fail(`${field}.${amountField}`, `${field}.${amountField} es requerido y debe ser un número`, amount);
  if (amount < 0)
    fail(`${field}.${amountField}`, `${field}.${amountField} no puede ser negativo`, amount);
  if (item.exento && item.iva !== undefined)
    fail(field, `${field} no puede tener 'iva' y 'exento' a la vez`);

  if (item.iva !== undefined && IVA_RATES[item.iva as keyof typeof IVA_RATES] === undefined)
    fail(`${field}.iva`, `Tipo de IVA desconocido: ${item.iva}`, item.iva);
}

export function validateFacturarExpoOpts(opts: FacturarExpoOpts): void {
  if (!opts.ptoVta || !Number.isInteger(opts.ptoVta) || opts.ptoVta < 1)
    fail("ptoVta", "ptoVta debe ser un entero >= 1", opts.ptoVta);
  if (!opts.cbteTipo)
    fail("cbteTipo", "cbteTipo es requerido");
  if (!isTipoE(opts.cbteTipo))
    fail("cbteTipo", "cbteTipo debe ser 19 (Factura E), 20 (Nota de Débito E) o 21 (Nota de Crédito E)", opts.cbteTipo);
  if (!opts.tipoExpo)
    fail("tipoExpo", "tipoExpo es requerido (1=Bienes, 2=Servicios, 4=Otros)");
  if (![TipoExpo.BIENES, TipoExpo.SERVICIOS, TipoExpo.OTROS].includes(opts.tipoExpo))
    fail("tipoExpo", "tipoExpo debe ser 1 (Bienes), 2 (Servicios) o 4 (Otros)", opts.tipoExpo);
  if (!opts.items || opts.items.length === 0)
    fail("items", "items no puede estar vacío");
  if (!opts.cliente)
    fail("cliente", "cliente es requerido");
  if (!opts.cliente.nombre)
    fail("cliente.nombre", "cliente.nombre es requerido");
  if (!opts.cliente.domicilio)
    fail("cliente.domicilio", "cliente.domicilio es requerido");
  if (!opts.cliente.cuitPais)
    fail("cliente.cuitPais", "cliente.cuitPais es requerido");
  if (!opts.moneda)
    fail("moneda", "moneda es requerido para exportación");
  if (!isAmount(opts.cotizacion) || opts.cotizacion <= 0)
    fail("cotizacion", "cotizacion es requerido para exportación y debe ser mayor a 0", opts.cotizacion);
  if (opts.canMisMonExt !== undefined && opts.canMisMonExt !== "S" && opts.canMisMonExt !== "N")
    fail("canMisMonExt", 'canMisMonExt debe ser "S" o "N"', opts.canMisMonExt);
  if (!opts.formaPago)
    fail("formaPago", "formaPago es requerido");
  if (!opts.pais)
    fail("pais", "pais (código de país destino) es requerido");
  if (opts.id !== undefined) checkEntero("id", opts.id, 1);
  if (opts.cbteNro !== undefined) checkEntero("cbteNro", opts.cbteNro, 1);

  const fecha = opts.fecha !== undefined ? checkFecha("fecha", opts.fecha) : undefined;

  // Permisos de embarque (manual WSFEX, tabla de validación 1720):
  // solo Factura E (19) de bienes lleva Permiso_existente S/N; con "S" los permisos son
  // obligatorios y con "N" no se envían. NC/ND de bienes pueden llevar permisos con
  // Permiso_existente vacío. Servicios y otros no llevan ni una cosa ni la otra.
  const esFacturaBienes = opts.cbteTipo === CbteTipo.FACTURA_E && opts.tipoExpo === TipoExpo.BIENES;
  const tienePermisos = (opts.permisos?.length ?? 0) > 0;
  if (opts.permisoExistente !== undefined) {
    if (!esFacturaBienes)
      fail(
        "permisoExistente",
        "permisoExistente solo se informa en Factura E (19) de bienes (tipoExpo 1); en los demás casos va vacío (validación 1720)",
        opts.permisoExistente
      );
    if (opts.permisoExistente !== "S" && opts.permisoExistente !== "N")
      fail("permisoExistente", 'permisoExistente debe ser "S" o "N"', opts.permisoExistente);
  }
  if (esFacturaBienes) {
    if (opts.permisoExistente === "S" && !tienePermisos)
      fail("permisos", 'con permisoExistente "S" los permisos son obligatorios (validación 1720)');
    if (opts.permisoExistente !== "S" && tienePermisos)
      fail("permisos", 'los permisos solo se informan con permisoExistente "S" (validación 1720)');
  } else if (opts.tipoExpo !== TipoExpo.BIENES && tienePermisos) {
    fail("permisos", "los comprobantes de servicios u otros no llevan permisos de embarque (validación 1720)");
  }

  // Fecha de pago (validaciones 1671-1674).
  if (opts.fechaPago !== undefined) {
    if (opts.cbteTipo !== CbteTipo.FACTURA_E)
      fail("fechaPago", "fechaPago solo se informa en Factura E (19), no en notas de crédito/débito (validación 1673)", opts.fechaPago);
    const pago = checkFecha("fechaPago", opts.fechaPago);
    if (opts.tipoExpo !== TipoExpo.BIENES && fecha !== undefined && pago < fecha)
      fail("fechaPago", "fechaPago debe ser igual o posterior a la fecha del comprobante (validación 1674)", opts.fechaPago);
  }

  opts.permisos?.forEach((p, i) => {
    if (!p.Id_permiso) fail(`permisos[${i}].Id_permiso`, "Id_permiso es requerido");
    checkEntero(`permisos[${i}].Dst_merc`, p.Dst_merc, 0);
  });
  opts.actividades?.forEach((a, i) => checkEntero(`actividades[${i}]`, a, 1));

  for (let i = 0; i < opts.items.length; i++) {
    validateExpoLineItem(opts.items[i], i);
  }
}

function validateExpoLineItem(item: ExpoLineItem, index: number): void {
  if (!item.descripcion)
    fail(`items[${index}].descripcion`, `items[${index}].descripcion es requerido`);
  if (!isAmount(item.cantidad) || item.cantidad <= 0)
    fail(`items[${index}].cantidad`, `items[${index}].cantidad debe ser > 0`, item.cantidad);
  if (!isAmount(item.precioUnitario) || item.precioUnitario < 0)
    fail(`items[${index}].precioUnitario`, `items[${index}].precioUnitario debe ser >= 0`, item.precioUnitario);
  if (item.bonificacion !== undefined && (!isAmount(item.bonificacion) || item.bonificacion < 0))
    fail(`items[${index}].bonificacion`, `items[${index}].bonificacion debe ser >= 0`, item.bonificacion);
}

const FECHA_HORA_RE = /^\d{14}$/;

export function validateInvoiceRequest(req: InvoiceRequest): void {
  if (!req.PtoVta || req.PtoVta < 1)
    fail("PtoVta", "PtoVta debe ser >= 1");
  if (!req.CbteTipo)
    fail("CbteTipo", "CbteTipo es requerido");
  if (isTipoE(req.CbteTipo))
    fail("CbteTipo", "los comprobantes clase E se emiten por WSFEX (crearFacturaExportacion)", req.CbteTipo);
  if (!req.invoices || req.invoices.length === 0)
    fail("invoices", "invoices no puede estar vacío");

  req.invoices.forEach((inv, i) => {
    const f = (name: string) => `invoices[${i}].${name}`;
    for (const k of ["ImpTotal", "ImpTotConc", "ImpNeto", "ImpOpEx", "ImpTrib", "ImpIVA"] as const) {
      if (inv[k] == null) fail(f(k), `${k} es requerido`);
      if (!isAmount(inv[k])) fail(f(k), `${k} debe ser un número finito`, inv[k]);
    }
    if (inv.CbteDesde == null) fail(f("CbteDesde"), "CbteDesde es requerido");
    if (inv.CbteHasta == null) fail(f("CbteHasta"), "CbteHasta es requerido");
    if (!inv.CbteFch) fail(f("CbteFch"), "CbteFch es requerido");
    if (!/^\d{8}$/.test(inv.CbteFch)) fail(f("CbteFch"), "CbteFch debe tener formato YYYYMMDD", inv.CbteFch);
    checkFecha(f("CbteFch"), inv.CbteFch);
    for (const k of ["FchServDesde", "FchServHasta", "FchVtoPago"] as const) {
      const v = inv[k];
      if (v !== undefined && v !== "") {
        if (!/^\d{8}$/.test(v)) fail(f(k), `${k} debe tener formato YYYYMMDD`, v);
        checkFecha(f(k), v);
      }
    }
    if (!inv.MonId) fail(f("MonId"), "MonId es requerido");
    if (inv.MonCotiz == null && inv.CanMisMonExt !== "S")
      fail(f("MonCotiz"), 'MonCotiz es requerido (salvo moneda extranjera con CanMisMonExt "S")');
    checkMoneda(f, inv.MonId, inv.MonCotiz ?? undefined, inv.CanMisMonExt, {
      cotizacion: "MonCotiz",
      canMisMonExt: "CanMisMonExt",
    });
    if (inv.DocTipo !== DocTipo.CONSUMIDOR_FINAL && inv.CondicionIVAReceptorId == null)
      fail(
        f("CondicionIVAReceptorId"),
        "CondicionIVAReceptorId es requerido cuando el receptor está identificado (RG 5616)"
      );
    if (inv.CbteFchHsGen !== undefined && !FECHA_HORA_RE.test(inv.CbteFchHsGen))
      fail(f("CbteFchHsGen"), "CbteFchHsGen debe tener formato yyyymmddhhmmss (validación 1441)", inv.CbteFchHsGen);
  });
}
