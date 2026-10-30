import { ArcaValidationError } from "@ramiidv/arca-common";
import { DocTipo, IVA_RATES } from "./constants.js";
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

export function validateFacturarOpts(opts: FacturarOpts): void {
  if (!opts.ptoVta || opts.ptoVta < 1)
    fail("ptoVta", "ptoVta debe ser >= 1", opts.ptoVta);
  if (!opts.cbteTipo)
    fail("cbteTipo", "cbteTipo es requerido");
  if (opts.cbteNro !== undefined && (!Number.isInteger(opts.cbteNro) || opts.cbteNro < 1))
    fail("cbteNro", "cbteNro debe ser un entero >= 1", opts.cbteNro);
  if (!opts.items || opts.items.length === 0)
    fail("items", "items no puede estar vacío");

  validateItems(opts.items, opts.descuentoGlobal);

  if (opts.fecha !== undefined) validateFecha("fecha", opts.fecha);

  if (opts.servicio) {
    if (!opts.servicio.desde) fail("servicio.desde", "servicio.desde es requerido");
    if (!opts.servicio.hasta) fail("servicio.hasta", "servicio.hasta es requerido");
    if (!opts.servicio.vtoPago) fail("servicio.vtoPago", "servicio.vtoPago es requerido");
  }

  if (opts.moneda && opts.moneda !== "PES" && !opts.cotizacion)
    fail("cotizacion", "cotizacion es requerido para moneda extranjera");

  // CondicionIVAReceptorId es obligatorio según RG 5616 (ARCA rechaza sin él desde el
  // 01/12/2026). Solo se completa por defecto para consumidor final sin identificar
  // (docTipo 99): un CUIT puede ser RI, monotributista o exento, así que no se infiere.
  const docTipo = opts.docTipo ?? DocTipo.CONSUMIDOR_FINAL;
  if (docTipo !== DocTipo.CONSUMIDOR_FINAL && opts.condicionIva == null)
    fail(
      "condicionIva",
      `condicionIva es requerido cuando el receptor está identificado (docTipo ${docTipo}). ` +
        "Usar enum CondicionIva; se puede obtener del padrón con condicionIvaDesdePadron (@ramiidv/arca-padron)."
    );

  if (opts.tributos) {
    opts.tributos.forEach((t, i) => {
      if (t.Id == null) fail(`tributos[${i}].Id`, "tributo.Id es requerido");
      if (!isAmount(t.Importe)) fail(`tributos[${i}].Importe`, "tributo.Importe es requerido");
    });
  }

  if (opts.cbtesAsoc) {
    opts.cbtesAsoc.forEach((c, i) => {
      if (!c.tipo) fail(`cbtesAsoc[${i}].tipo`, "cbtesAsoc.tipo es requerido");
      if (!c.ptoVta) fail(`cbtesAsoc[${i}].ptoVta`, "cbtesAsoc.ptoVta es requerido");
      if (!c.nro) fail(`cbtesAsoc[${i}].nro`, "cbtesAsoc.nro es requerido");
    });
  }
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

function validateFecha(field: string, fecha: Date | string): void {
  if (fecha instanceof Date) {
    if (Number.isNaN(fecha.getTime())) fail(field, `${field} no es una fecha válida`);
    return;
  }
  if (!/^\d{8}$/.test(fecha)) fail(field, `${field} debe tener formato YYYYMMDD`, fecha);
}

export function validateFacturarExpoOpts(opts: FacturarExpoOpts): void {
  if (!opts.ptoVta || opts.ptoVta < 1)
    fail("ptoVta", "ptoVta debe ser >= 1");
  if (!opts.cbteTipo)
    fail("cbteTipo", "cbteTipo es requerido");
  if (!opts.tipoExpo)
    fail("tipoExpo", "tipoExpo es requerido (1=Bienes, 2=Servicios, 4=Otros)");
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
  if (!opts.cotizacion)
    fail("cotizacion", "cotizacion es requerido para exportación");
  if (!opts.formaPago)
    fail("formaPago", "formaPago es requerido");
  if (!opts.pais)
    fail("pais", "pais (código de país destino) es requerido");

  for (let i = 0; i < opts.items.length; i++) {
    validateExpoLineItem(opts.items[i], i);
  }
}

function validateExpoLineItem(item: ExpoLineItem, index: number): void {
  if (!item.descripcion)
    fail(`items[${index}].descripcion`, `items[${index}].descripcion es requerido`);
  if (item.cantidad == null || item.cantidad <= 0)
    fail(`items[${index}].cantidad`, `items[${index}].cantidad debe ser > 0`);
  if (item.precioUnitario == null || item.precioUnitario < 0)
    fail(`items[${index}].precioUnitario`, `items[${index}].precioUnitario debe ser >= 0`);
}

export function validateInvoiceRequest(req: InvoiceRequest): void {
  if (!req.PtoVta || req.PtoVta < 1)
    fail("PtoVta", "PtoVta debe ser >= 1");
  if (!req.CbteTipo)
    fail("CbteTipo", "CbteTipo es requerido");
  if (!req.invoices || req.invoices.length === 0)
    fail("invoices", "invoices no puede estar vacío");

  req.invoices.forEach((inv, i) => {
    const f = (name: string) => `invoices[${i}].${name}`;
    if (inv.ImpTotal == null) fail(f("ImpTotal"), "ImpTotal es requerido");
    if (inv.CbteDesde == null) fail(f("CbteDesde"), "CbteDesde es requerido");
    if (inv.CbteHasta == null) fail(f("CbteHasta"), "CbteHasta es requerido");
    if (!inv.CbteFch) fail(f("CbteFch"), "CbteFch es requerido");
    if (!inv.MonId) fail(f("MonId"), "MonId es requerido");
    if (inv.MonCotiz == null) fail(f("MonCotiz"), "MonCotiz es requerido");
    if (inv.DocTipo !== DocTipo.CONSUMIDOR_FINAL && inv.CondicionIVAReceptorId == null)
      fail(
        f("CondicionIVAReceptorId"),
        "CondicionIVAReceptorId es requerido cuando el receptor está identificado (RG 5616)"
      );
  });
}
