/**
 * Ejemplo: emisión segura con número explícito y recuperación
 *
 * Patrón para un worker que emite facturas desde una cola: cada factura termina
 * autorizada o con la certeza de que no se emitió, nunca en un estado ambiguo.
 *
 * 1. Reservar el número (cbteNro) y persistir el intento ANTES de enviar.
 * 2. Emitir. Si el resultado es incierto (timeout, corte de red, HTTP 5xx),
 *    el SDK no reintenta y lanza ArcaResultadoIncierto.
 * 3. Resolver con recuperarComprobante: autorizado, no_emitido (reintentar
 *    con el mismo número es seguro) o conflicto.
 */

import fs from "fs";
import {
  Arca,
  ArcaResultadoIncierto,
  ArcaWSFEError,
  CbteTipo,
  FileTicketStorage,
  IvaTipo,
  requiereRecuperacion,
} from "@ramiidv/arca-facturacion";
import type { FacturarOpts, IntentoComprobante } from "@ramiidv/arca-facturacion";

const arca = new Arca({
  cuit: 20123456789,
  cert: fs.readFileSync("./certs/certificado.crt", "utf-8"),
  key: fs.readFileSync("./certs/clave.key", "utf-8"),
  production: false,
  // Sin storage, un reinicio deja sin poder loguearse hasta que venza el TA anterior.
  ticketStorage: new FileTicketStorage("./.arca-tickets"),
});

/** Simula la persistencia del worker (en una app real: la DB). */
const db = new Map<string, { estado: string; opts: FacturarOpts; intento: IntentoComprobante; cae?: string }>();

/** Envíos máximos de un mismo comprobante antes de dejarlo para revisión manual. */
const MAX_ENVIOS = 3;

async function emitir(jobId: string, opts: FacturarOpts & { cbteNro: number }, envio = 1) {
  try {
    const res = await arca.facturar(opts);
    if (!res.aprobada && requiereRecuperacion(res)) {
      // 10016: el número ya se usó; si fue un envío anterior nuestro, quedó autorizado.
      db.set(jobId, { ...db.get(jobId)!, estado: "incierto" });
      return resolver(jobId, envio);
    }
    db.set(jobId, { ...db.get(jobId)!, estado: res.aprobada ? "autorizado" : "rechazado", cae: res.cae });
  } catch (e) {
    if (e instanceof ArcaResultadoIncierto) {
      db.set(jobId, { ...db.get(jobId)!, estado: "incierto" });
      return resolver(jobId, envio);
    }
    if (e instanceof ArcaWSFEError) {
      db.set(jobId, { ...db.get(jobId)!, estado: "rechazado" });
      return;
    }
    throw e; // validación, auth, sin conexión: no se envió nada; reintentar el job más tarde
  }
}

/** Resuelve un job "enviando" (el proceso se cayó) o "incierto". */
async function resolver(jobId: string, envio = 1) {
  const job = db.get(jobId)!;
  // ARCA puede seguir procesando el request original: esperar unos segundos.
  await new Promise((r) => setTimeout(r, 5_000));

  const r = await arca.recuperarComprobante(job.intento);
  switch (r.estado) {
    case "autorizado":
      db.set(jobId, { ...job, estado: "autorizado", cae: r.resultado.cae });
      console.log(`Recuperado: CAE ${r.resultado.cae}`);
      break;
    case "no_emitido":
      if (envio >= MAX_ENVIOS) {
        db.set(jobId, { ...job, estado: "incierto" }); // reintentar más tarde (ARCA puede estar caído)
        break;
      }
      // Seguro: mismo número. Si el original se autorizara después, ARCA rechaza este (10016).
      await emitir(jobId, { ...job.opts, cbteNro: job.intento.cbteNro }, envio + 1);
      break;
    case "conflicto":
      db.set(jobId, { ...job, estado: "conflicto" });
      console.error("El número lo usó otra emisión:", r.encontrado.ResultGet);
      break;
  }
}

async function main() {
  const ptoVta = 1;
  const cbteTipo = CbteTipo.FACTURA_B;

  // 1. Reservar número y persistir el intento antes de enviar.
  const cbteNro = (await arca.ultimoComprobante(ptoVta, cbteTipo)) + 1;
  const opts = {
    ptoVta,
    cbteTipo,
    cbteNro,
    // Fijar la fecha: así el intento guardado y lo que se envía coinciden aunque pase la medianoche.
    fecha: Arca.formatDate(arca.wsaa.now()),
    items: [
      { total: 4500, iva: IvaTipo.IVA_21 }, // precios finales, IVA incluido
      { total: 1800.5, iva: IvaTipo.IVA_21 },
    ],
    descuentoGlobal: 300,
  };
  const { intento, importes } = arca.armarComprobante(opts);
  db.set("job-1", { estado: "enviando", opts, intento });
  console.log("Total a facturar:", importes.total);

  // 2 y 3. Emitir y, si hace falta, recuperar.
  await emitir("job-1", opts);
  console.log(db.get("job-1"));
}

main().catch(console.error);
