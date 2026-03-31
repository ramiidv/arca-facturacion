import { ArcaError } from "./errors.js";
import type {
  FacturarOpts,
  FacturarExpoOpts,
  InvoiceRequest,
  LineItem,
  ExpoLineItem,
} from "./types.js";

function fail(msg: string): never {
  throw new ArcaError(`Validación: ${msg}`);
}

export function validateFacturarOpts(opts: FacturarOpts): void {
  if (!opts.ptoVta || opts.ptoVta < 1)
    fail("ptoVta debe ser >= 1");
  if (!opts.cbteTipo)
    fail("cbteTipo es requerido");
  if (!opts.items || opts.items.length === 0)
    fail("items no puede estar vacío");

  for (let i = 0; i < opts.items.length; i++) {
    validateLineItem(opts.items[i], i);
  }

  if (opts.servicio) {
    if (!opts.servicio.desde) fail("servicio.desde es requerido");
    if (!opts.servicio.hasta) fail("servicio.hasta es requerido");
    if (!opts.servicio.vtoPago) fail("servicio.vtoPago es requerido");
  }

  if (opts.moneda && opts.moneda !== "PES" && !opts.cotizacion)
    fail("cotizacion es requerido para moneda extranjera");

  if (opts.tributos) {
    for (const t of opts.tributos) {
      if (t.Id == null) fail("tributo.Id es requerido");
      if (t.Importe == null) fail("tributo.Importe es requerido");
    }
  }
}

function validateLineItem(item: LineItem, index: number): void {
  if (item.neto == null || typeof item.neto !== "number")
    fail(`items[${index}].neto es requerido y debe ser un número`);
  if (item.neto < 0)
    fail(`items[${index}].neto no puede ser negativo`);
  if (item.exento && item.iva !== undefined)
    fail(`items[${index}] no puede tener 'iva' y 'exento' a la vez`);
}

export function validateFacturarExpoOpts(opts: FacturarExpoOpts): void {
  if (!opts.ptoVta || opts.ptoVta < 1)
    fail("ptoVta debe ser >= 1");
  if (!opts.cbteTipo)
    fail("cbteTipo es requerido");
  if (!opts.items || opts.items.length === 0)
    fail("items no puede estar vacío");
  if (!opts.cliente)
    fail("cliente es requerido");
  if (!opts.cliente.nombre)
    fail("cliente.nombre es requerido");
  if (!opts.moneda)
    fail("moneda es requerido para exportación");
  if (!opts.cotizacion)
    fail("cotizacion es requerido para exportación");
  if (!opts.formaPago)
    fail("formaPago es requerido");
  if (!opts.pais)
    fail("pais (código de país destino) es requerido");

  for (let i = 0; i < opts.items.length; i++) {
    validateExpoLineItem(opts.items[i], i);
  }
}

function validateExpoLineItem(item: ExpoLineItem, index: number): void {
  if (!item.descripcion)
    fail(`items[${index}].descripcion es requerido`);
  if (item.cantidad == null || item.cantidad <= 0)
    fail(`items[${index}].cantidad debe ser > 0`);
  if (item.precioUnitario == null || item.precioUnitario < 0)
    fail(`items[${index}].precioUnitario debe ser >= 0`);
}

export function validateInvoiceRequest(req: InvoiceRequest): void {
  if (!req.PtoVta || req.PtoVta < 1)
    fail("PtoVta debe ser >= 1");
  if (!req.CbteTipo)
    fail("CbteTipo es requerido");
  if (!req.invoices || req.invoices.length === 0)
    fail("invoices no puede estar vacío");

  for (const inv of req.invoices) {
    if (inv.ImpTotal == null) fail("ImpTotal es requerido");
    if (inv.CbteDesde == null) fail("CbteDesde es requerido");
    if (inv.CbteHasta == null) fail("CbteHasta es requerido");
    if (!inv.CbteFch) fail("CbteFch es requerido");
    if (!inv.MonId) fail("MonId es requerido");
    if (inv.MonCotiz == null) fail("MonCotiz es requerido");
  }
}
