# @ramiidv/arca-facturacion

[![CI](https://github.com/ramiidv/arca-facturacion/actions/workflows/ci.yml/badge.svg)](https://github.com/ramiidv/arca-facturacion/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ramiidv/arca-facturacion)](https://www.npmjs.com/package/@ramiidv/arca-facturacion)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

SDK en TypeScript para interactuar con los Web Services de **ARCA** (ex AFIP) — Facturación Electrónica Argentina.

Soporta **todos los tipos de comprobante** de WSFEv1 y WSFEX: Facturas, Notas de Débito/Crédito, Recibos (A, B, C, E, M), Facturas de Crédito Electrónica MiPyME (FCE) y Facturas de Exportación.

## Instalación

```bash
npm install @ramiidv/arca-facturacion
```

## Requisitos

- Node.js >= 18. Se publica en ESM y CommonJS: funciona con `import` y con `require` (incluido TypeScript con `"module": "CommonJS"`).
- Certificado digital X.509 y clave privada de ARCA
  - **Testing**: generalo desde [WSASS Homologación](https://wsass-homo.afip.gob.ar/wsass/portal/main.aspx)
  - **Producción**: generalo desde [Administración de Certificados Digitales](https://www.afip.gob.ar/ws/documentacion/certificados.asp) (requiere clave fiscal en [arca.gob.ar](https://arca.gob.ar))

## Uso rápido

```typescript
import fs from "fs";
import { Arca, CbteTipo, IvaTipo } from "@ramiidv/arca-facturacion";

const arca = new Arca({
  cuit: 20123456789,
  cert: fs.readFileSync("./cert.crt", "utf-8"),
  key: fs.readFileSync("./key.key", "utf-8"),
  production: false, // true para producción
});

// Crear factura B para consumidor final
const result = await arca.facturar({
  ptoVta: 1,
  cbteTipo: CbteTipo.FACTURA_B,
  items: [
    { neto: 1000, iva: IvaTipo.IVA_21 },
    { neto: 500, iva: IvaTipo.IVA_10_5 },
  ],
});

if (result.aprobada) {
  console.log(`CAE: ${result.cae}`);
  console.log(`Vencimiento: ${result.caeVencimiento}`);
  console.log(`Comprobante #${result.cbteNro}`);
  console.log(`Total: $${result.importes.total}`); // 1762.5
}
```

El SDK calcula automáticamente: IVA, totales (neto, IVA, exento, no gravado, tributos), número de comprobante, fecha (timezone Argentina), agrupa alícuotas de IVA, y completa `CondicionIVAReceptorId` para consumidor final sin identificar. Valida todos los campos requeridos antes de enviar a ARCA.

> **`CondicionIVAReceptorId`** es obligatorio según la RG 5616: ARCA rechaza los comprobantes sin
> este dato desde el **01/12/2026** (manual WSFEv1 v4.8; el v4.7 publicado lo remite a la RG 5616).
> Si el receptor está identificado (`docTipo` distinto de 99), `condicionIva` es obligatoria: el SDK
> no la infiere porque un CUIT puede ser RI, monotributista o exento. Podés obtenerla del padrón con
> `condicionIvaDesdePadron` de [`@ramiidv/arca-padron`](https://github.com/ramiidv/arca-padron).

## Configuración

```typescript
const arca = new Arca({
  cuit: 20123456789,          // CUIT sin guiones
  cert: "...",                 // Certificado X.509 (PEM)
  key: "...",                  // Clave privada (PEM)
  production: false,           // Default: false (testing/homologación)
  tokenTTLMinutes: 720,        // Default: 720 (12 horas)
  requestTimeoutMs: 30_000,    // Default: 30000 (30 segundos)
  retries: 1,                  // Default: 1 (solo consultas; las emisiones nunca se reintentan)
  retryDelayMs: 1_000,         // Default: 1000 (backoff exponencial: 1s, 2s, ...)
  ticketStorage: new FileTicketStorage("./.arca-tickets"), // Recomendado: persistir el TA
  clockOffsetMs: 0,            // Default: 0. Desfase relojARCA - relojLocal
  autoClockSkew: true,         // Default: true. Ajusta el desfase si WSAA lo rechaza
  signal: shutdown.signal,     // Opcional: cancela todas las llamadas (ej: al apagar)
  onEvent: (e) => {            // Opcional: callback para logging/debugging
    console.log(e.type, e);
  },
});
```

> **Persistí el Ticket de Acceso.** WSAA rechaza el login si ya existe un TA vigente para el
> certificado. Sin `ticketStorage`, cada reinicio del proceso te deja sin poder facturar hasta
> que venza el TA anterior (hasta 12 horas, `ArcaTicketVigenteError`). Usá `FileTicketStorage`
> o implementá `TicketStorage` sobre tu base de datos (ver `@ramiidv/arca-common`).

## Emisión segura: nunca un estado ambiguo

Cuando una factura se envía a ARCA pueden pasar tres cosas:

| Resultado | Qué lanza / devuelve el SDK | ¿Se emitió? |
| --- | --- | --- |
| ARCA autorizó | `FacturaResult` con `aprobada: true` y `cae` | Sí |
| ARCA rechazó | `ArcaWSFEError` (errores) o `aprobada: false` (observaciones) | No |
| No se sabe (timeout, conexión cortada, HTTP 5xx, respuesta ilegible) | `ArcaResultadoIncierto` | **Hay que averiguarlo** |

Las emisiones (`FECAESolicitar`, `FECAEARegInformativo`, `FECAEASinMovimientoInformar`, `FEXAuthorize`)
**nunca se reintentan**: si ARCA otorgó el CAE y la respuesta se perdió, un reintento automático
chocaría con la numeración. `retries` aplica solo a consultas.

Para resolver un resultado incierto, `recuperarComprobante(intento)` devuelve:

- `{ estado: "autorizado", resultado }`: ARCA lo autorizó; `resultado` tiene el CAE.
- `{ estado: "no_emitido" }`: no existe; reintentar **con el mismo `cbteNro`** es seguro.
- `{ estado: "conflicto", encontrado }`: ese número existe con otros datos (lo usó otra emisión).

Pasar `cbteNro` explícito es lo que hace seguro el reintento: si el intento original llegara a
autorizarse más tarde, ARCA rechaza el duplicado (error 10016), nunca emite dos comprobantes.
Sin `cbteNro`, el SDK usa el último autorizado + 1 y **no hay lock**: serializá las emisiones por
(punto de venta, tipo de comprobante).

### Ejemplo: worker con cola

```typescript
import {
  Arca, ArcaResultadoIncierto, ArcaWSFEError, CbteTipo, IvaTipo, FileTicketStorage,
} from "@ramiidv/arca-facturacion";

const arca = new Arca({ cuit, cert, key, production: true, ticketStorage: new FileTicketStorage("./.arca") });

async function emitir(job: Job) {
  // 1. Reservar el número y guardar el intento ANTES de enviar.
  //    Si el proceso se cae a mitad del envío, el intento queda en la DB.
  const cbteNro = (await arca.ultimoComprobante(job.ptoVta, CbteTipo.FACTURA_B)) + 1;
  const opts = {
    ptoVta: job.ptoVta,
    cbteTipo: CbteTipo.FACTURA_B,
    cbteNro,
    items: job.items.map((i) => ({ total: i.precio, iva: IvaTipo.IVA_21 })), // precios con IVA
    descuentoGlobal: job.descuento,
  };
  const { intento } = arca.armarComprobante(opts);
  await db.jobs.update(job.id, { estado: "enviando", opts, intento });

  try {
    const res = await arca.facturar(opts);
    if (!res.aprobada) return db.jobs.update(job.id, { estado: "rechazado", obs: res.observaciones });
    return db.jobs.update(job.id, { estado: "autorizado", cae: res.cae, vto: res.caeVencimiento });
  } catch (e) {
    if (e instanceof ArcaWSFEError) return db.jobs.update(job.id, { estado: "rechazado", errores: e.errors });
    if (e instanceof ArcaResultadoIncierto) return db.jobs.update(job.id, { estado: "incierto" });
    throw e; // validación, auth, sin conexión (no se envió): reintentar el job más tarde
  }
}

// Al arrancar y periódicamente: resolver los "enviando" (proceso caído) y los "incierto".
async function resolver(job: Job) {
  const r = await arca.recuperarComprobante(job.intento);
  if (r.estado === "autorizado") return db.jobs.update(job.id, { estado: "autorizado", cae: r.resultado.cae });
  if (r.estado === "no_emitido") return emitirDeNuevoConElMismoNumero(job); // mismo opts, mismo cbteNro
  return db.jobs.update(job.id, { estado: "conflicto", encontrado: r.encontrado }); // revisión manual
}
```

> Si la respuesta se perdió por timeout, esperá unos segundos antes de `recuperarComprobante`:
> ARCA puede seguir procesando el request original. Aunque responda `no_emitido` antes de tiempo,
> el reintento con el mismo número es seguro.

## Ejemplos

### Factura B — Consumidor final (caso más común)

```typescript
const result = await arca.facturar({
  ptoVta: 1,
  cbteTipo: CbteTipo.FACTURA_B,
  items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
  // DocTipo, DocNro, fecha, moneda, concepto → se completan automáticamente
});
// result.importes.total === 121
```

### Factura A — Servicios a otra empresa

```typescript
const result = await arca.facturar({
  ptoVta: 1,
  cbteTipo: CbteTipo.FACTURA_A,
  docTipo: DocTipo.CUIT,
  docNro: 30712345678,
  condicionIva: CondicionIva.RESPONSABLE_INSCRIPTO,
  items: [{ neto: 50000, iva: IvaTipo.IVA_21 }],
  servicio: {
    desde: new Date("2026-03-01"),
    hasta: new Date("2026-03-31"),
    vtoPago: new Date("2026-04-15"),
  },
  // concepto se auto-detecta como SERVICIOS al proveer `servicio`
});
```

### Factura con múltiples alícuotas de IVA

```typescript
const result = await arca.facturar({
  ptoVta: 1,
  cbteTipo: CbteTipo.FACTURA_A,
  docTipo: DocTipo.CUIT,
  docNro: 30712345678,
  condicionIva: CondicionIva.RESPONSABLE_INSCRIPTO,
  items: [
    { neto: 1000, iva: IvaTipo.IVA_21 },   // IVA: 210
    { neto: 500, iva: IvaTipo.IVA_10_5 },   // IVA: 52.5
    { neto: 200, iva: IvaTipo.IVA_0 },      // IVA: 0 (gravado al 0%)
    { neto: 300, exento: true },             // Exento (ImpOpEx)
    { neto: 150 },                           // No gravado (ImpTotConc)
  ],
});
// result.importes:
//   neto: 1700, iva: 262.5, exento: 300, noGravado: 150, total: 2412.5
```

### Factura C — Monotributista

Para comprobantes tipo C, el SDK no discrimina IVA automáticamente.

```typescript
const result = await arca.facturar({
  ptoVta: 1,
  cbteTipo: CbteTipo.FACTURA_C,
  items: [{ neto: 5000 }],
});
// ImpNeto: 5000, ImpIVA: 0, ImpTotal: 5000
```

### Precios con IVA incluido y descuento global

En un punto de venta los precios suelen ser finales. Cada item lleva `neto` (sin IVA) **o**
`total` (IVA incluido), nunca ambos:

```typescript
const result = await arca.facturar({
  ptoVta: 1,
  cbteTipo: CbteTipo.FACTURA_B,
  items: [
    { total: 4500, iva: IvaTipo.IVA_21 },    // plato principal
    { total: 1800.5, iva: IvaTipo.IVA_21 },  // bebida
    { total: 300, exento: true },
  ],
  descuentoGlobal: 660.05, // monto final, se prorratea entre alícuotas, exento y no gravado
});
```

Los importes se calculan en centavos: la suma de `BaseImp` + `Importe` de las alícuotas + exento +
no gravado + tributos da exactamente `ImpTotal`. El resto de redondeo del prorrateo del descuento
se asigna al grupo de mayor base.

### Elegir el tipo de comprobante

```typescript
import { resolverCbteTipo, CondicionIva } from "@ramiidv/arca-facturacion";

resolverCbteTipo(CondicionIva.RESPONSABLE_INSCRIPTO, CondicionIva.CONSUMIDOR_FINAL); // FACTURA_B
resolverCbteTipo(CondicionIva.RESPONSABLE_INSCRIPTO, CondicionIva.MONOTRIBUTISTA);   // FACTURA_A
resolverCbteTipo(CondicionIva.MONOTRIBUTISTA, CondicionIva.RESPONSABLE_INSCRIPTO);   // FACTURA_C
resolverCbteTipo(CondicionIva.RESPONSABLE_INSCRIPTO, CondicionIva.RESPONSABLE_INSCRIPTO, "nota_credito"); // NOTA_CREDITO_A
```

Reglas según RG 1415, RG 5003/2021 y la tabla de condiciones por clase del manual WSFEv1.

### Nota de crédito

El tipo de NC se infiere automáticamente del comprobante original (FACTURA_B → NOTA_CREDITO_B).
Acepta las mismas opciones que `facturar` (incluidos `cbteNro`, `total` y `descuentoGlobal`).

```typescript
const result = await arca.notaCredito({
  ptoVta: 1,
  comprobanteOriginal: {
    tipo: CbteTipo.FACTURA_B,
    ptoVta: 1,
    nro: 150,
  },
  items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
});
```

### Nota de débito

```typescript
const result = await arca.notaDebito({
  ptoVta: 1,
  comprobanteOriginal: {
    tipo: CbteTipo.FACTURA_A,
    ptoVta: 1,
    nro: 200,
    fecha: "20260301",
  },
  docTipo: DocTipo.CUIT,
  docNro: 30712345678,
  condicionIva: CondicionIva.RESPONSABLE_INSCRIPTO,
  items: [{ neto: 500, iva: IvaTipo.IVA_21 }],
});
```

### Factura MiPyME (FCE)

```typescript
const result = await arca.facturar({
  ptoVta: 1,
  cbteTipo: CbteTipo.FCE_FACTURA_A,
  docTipo: DocTipo.CUIT,
  docNro: 30712345678,
  condicionIva: CondicionIva.RESPONSABLE_INSCRIPTO,
  items: [{ neto: 100000, iva: IvaTipo.IVA_21 }],
  opcionales: [{ Id: "2101", Valor: "0110012345678901234567" }], // CBU obligatorio
});
```

### Factura de exportación (WSFEX)

ID, número, `Imp_total` y `Fecha_pago` se calculan automáticamente. `Permiso_existente` se auto-ajusta a `""` para servicios/otros (solo válido `"S"`/`"N"` para bienes).

```typescript
const result = await arca.facturarExpo({
  ptoVta: 1,
  cbteTipo: CbteTipo.FACTURA_E,
  tipoExpo: 1, // 1=Bienes, 2=Servicios, 4=Otros
  pais: 203,   // País destino (203 = Estados Unidos)
  cliente: {
    nombre: "ACME Corp",
    cuitPais: 50000000016,
    domicilio: "123 Main St, New York",
    idImpositivo: "12-3456789",
  },
  moneda: "DOL",
  cotizacion: 1200,
  formaPago: "Wire Transfer",
  incoterms: "FOB",
  idioma: 2, // 1=Español, 2=Inglés, 3=Portugués
  items: [{
    codigo: "SKU001",
    descripcion: "Widget",
    cantidad: 100,
    unidad: 7,
    precioUnitario: 10,
  }],
});

if (result.aprobada) {
  console.log(`CAE: ${result.cae}, Cbte #${result.cbteNro}`);
}
```

### Consultar contribuyente (Padrón)

> **Deprecado**: usá [`@ramiidv/arca-padron`](https://github.com/ramiidv/arca-padron), que además
> tiene `condicionIvaDesdePadron`. Estos métodos se mantienen por compatibilidad.

```typescript
// Consulta básica por CUIT (padrón A13, servicio ws_sr_padron_a13)
const persona = await arca.consultarCuit(30712345678);
console.log(persona.nombre);       // "EMPRESA SA"
console.log(persona.tipoPersona);  // "JURIDICA"
console.log(persona.estadoClave);  // "ACTIVO"

// Constancia de inscripción (ex padrón A5, servicio ws_sr_constancia_inscripcion)
const detalle = await arca.consultarCuitDetalle(20123456789);
console.log(detalle.domicilioFiscal); // { direccion, localidad, codPostal }
console.log(detalle.impuestos);       // [{ id: 30, descripcion: "IVA", estado: "AC" }]
```

### CAEA — Facturación offline / contingencia

```typescript
// 1. Solicitar CAEA para un período (antes de que empiece)
const caea = await arca.solicitarCAEA("202604", 1); // abril, 1ra quincena
console.log(`CAEA: ${caea.CAEA}, vigencia: ${caea.FchVigDesde} - ${caea.FchVigHasta}`);

// 2. Emitir facturas offline usando el CAEA (misma interfaz que facturar())
const result = await arca.registrarFacturaCAEA(caea.CAEA, {
  ptoVta: 5,
  cbteTipo: CbteTipo.FACTURA_B,
  items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
});

// 3. Si no hubo movimientos en el período
await arca.sinMovimientoCAEA(caea.CAEA, 5);

// Consultar un CAEA existente
const existente = await arca.consultarCAEA("202604", 1);
```

### Previsualizar o armar sin enviar

```typescript
import { armarComprobante, calcularTotales } from "@ramiidv/arca-facturacion";

const { importes, iva } = calcularTotales([
  { neto: 1000, iva: IvaTipo.IVA_21 },
  { neto: 500, iva: IvaTipo.IVA_10_5 },
]);
console.log(importes);
// { total: 1762.5, neto: 1500, iva: 262.5, exento: 0, noGravado: 0, tributos: 0 }

// Detalle completo, listo para FECAESolicitar, sin red. Valida igual que facturar().
const { request, importes: imp, intento } = armarComprobante({
  ptoVta: 1,
  cbteTipo: CbteTipo.FACTURA_B,
  cbteNro: 151,
  items: [{ total: 1210, iva: IvaTipo.IVA_21 }],
});
```

`Arca.calcularTotales` y `arca.armarComprobante` (que usa el reloj de ARCA para la fecha) siguen disponibles.

### QR para factura impresa

```typescript
const url = Arca.generateQRUrl({
  fecha: "2026-03-28",
  cuit: 20123456789,
  ptoVta: 1,
  tipoCmp: CbteTipo.FACTURA_B,
  nroCmp: 150,
  importe: 121,
  moneda: "PES",
  ctz: 1,
  tipoDocRec: DocTipo.CONSUMIDOR_FINAL,
  nroDocRec: 0,
  codAut: 73429843294823, // CAE
});
// → "https://www.afip.gob.ar/fe/qr/?p=<base64>"
```

### Factura en moneda extranjera

```typescript
const cotiz = await arca.getCotizacion(Moneda.DOLARES);

const result = await arca.facturar({
  ptoVta: 1,
  cbteTipo: CbteTipo.FACTURA_A,
  docTipo: DocTipo.CUIT,
  docNro: 30712345678,
  condicionIva: CondicionIva.RESPONSABLE_INSCRIPTO,
  items: [{ neto: 1000, iva: IvaTipo.IVA_21 }],
  moneda: Moneda.DOLARES,
  cotizacion: cotiz.MonCotiz,
});
```

## Retry automático

El SDK reintenta automáticamente **las consultas** (último comprobante, consultas, parámetros, login
WSAA, padrón) en errores transitorios: timeout, errores de red y HTTP 5xx sin SOAP Fault. No reintenta
errores de negocio ni SOAP Faults. **Las emisiones nunca se reintentan** (ver "Emisión segura").

- **Default**: 1 reintento con backoff exponencial (1s, 2s, ...)
- **Configurable**: `retries: 0` para desactivar, `retries: 3` para más intentos

```typescript
const arca = new Arca({
  ...config,
  retries: 2,         // 2 reintentos (3 intentos totales)
  retryDelayMs: 2000, // empezar con 2s → 4s → 8s
});
```

## Eventos / Logging

El SDK emite eventos para debugging y monitoreo sin forzar un logger específico.

```typescript
// Opción 1: callback en config
const arca = new Arca({
  ...config,
  onEvent: (e) => console.log(`[${e.type}]`, e),
});

// Opción 2: suscripción por tipo de evento
arca.on("request:end", (e) => {
  if (e.type === "request:end") {
    metrics.histogram("arca.request.duration", e.durationMs);
  }
});

arca.on("request:retry", (e) => {
  if (e.type === "request:retry") {
    logger.warn(`Retry #${e.attempt} for ${e.method}: ${e.error}`);
  }
});
```

| Evento | Cuándo | Datos |
| --- | --- | --- |
| `auth:login` | Nuevo token obtenido | `service`, `durationMs` |
| `auth:cache-hit` | Token reutilizado | `service`, `source` (`memory` / `storage`) |
| `auth:clock-skew` | Se ajustó el desfase de reloj | `service`, `offsetMs`, `previousOffsetMs` |
| `auth:storage-error` | Falló el `ticketStorage` (no interrumpe) | `service`, `operation`, `error` |
| `request:start` | Antes de una llamada SOAP | `method`, `endpoint` |
| `request:end` | Llamada SOAP completada | `method`, `durationMs` |
| `request:retry` | Reintentando tras error (solo consultas) | `method`, `attempt`, `error` |
| `request:error` | Llamada SOAP falló | `method`, `error` |

## Manejo de errores

El SDK provee clases de error específicas para catch granular:

```typescript
import {
  Arca,
  ArcaAuthError,
  ArcaTicketVigenteError,
  ArcaResultadoIncierto,
  ArcaValidationError,
  ArcaWSFEError,
  ArcaSoapError,
} from "@ramiidv/arca-facturacion";

try {
  const result = await arca.facturar({ ... });
} catch (e) {
  if (e instanceof ArcaResultadoIncierto) {
    // No se sabe si se emitió: guardar e.intento y resolver con recuperarComprobante
    const r = await arca.recuperarComprobante(e.intento);
  } else if (e instanceof ArcaWSFEError) {
    // ARCA rechazó el comprobante (no se emitió)
    for (const err of e.errors) console.error(`[${err.code}] ${err.msg}`);
    if (e.tieneCodigo(10016)) {
      // "número no corresponde con el próximo": quizá un intento anterior sí se autorizó
    }
  } else if (e instanceof ArcaValidationError) {
    console.error(e.field, e.details); // datos inválidos, no se envió nada
  } else if (e instanceof ArcaTicketVigenteError) {
    // WSAA ya emitió un TA que no tenemos (falta ticketStorage): esperar a que venza
  } else if (e instanceof ArcaAuthError) {
    // Error de autenticación WSAA (certificado inválido, expirado, etc.)
  } else if (e instanceof ArcaSoapError) {
    // Error HTTP/SOAP en una consulta, o emisión que con certeza no se envió (sin conexión)
    console.error("HTTP status:", e.statusCode, "incierto:", e.uncertain);
  }
}
```

| Clase | `code` | Cuándo se lanza |
| --- | --- | --- |
| `ArcaResultadoIncierto` | `ARCA_RESULTADO_INCIERTO` | Emisión sin respuesta confiable. Contiene `intento`, `intentos`, `operacion` |
| `ArcaWSFEError` | `ARCA_WSFE_ERROR` | Error devuelto por WSFE/WSFEX (no se emitió). Contiene `errors: { code, msg }[]` y `tieneCodigo(code)` |
| `ArcaValidationError` | `ARCA_VALIDATION_ERROR` | Datos de entrada inválidos. Contiene `field` y `details` |
| `ArcaTicketVigenteError` | `ARCA_TICKET_VIGENTE` | WSAA ya emitió un TA vigente que no está en memoria ni en el storage |
| `ArcaAuthError` | `ARCA_AUTH_ERROR` | Falla en login WSAA, respuesta inesperada, token/sign inválidos |
| `ArcaSoapError` | `ARCA_SOAP_ERROR` | Error HTTP, timeout, SOAP Fault. Contiene `statusCode?`, `faultString?`, `uncertain`, `aborted` |
| `ArcaError` | `ARCA_ERROR` | Clase base para todos los errores del SDK |

`instanceof` funciona aunque haya más de una copia del paquete cargada (por ejemplo ESM y CommonJS en
el mismo proceso), y `code` sirve para persistir o comparar sin `instanceof`.

### Cancelación

Todos los métodos aceptan un último parámetro opcional `{ signal }`, que se combina con el `signal`
de la config:

```typescript
await arca.ultimoComprobante(1, CbteTipo.FACTURA_B, { signal: AbortSignal.timeout(10_000) });
```

Abortar una emisión **después de enviada** deja el resultado incierto (`ArcaResultadoIncierto`).
Abortar antes de enviar no envía nada.

## Consultas

```typescript
// Estado del servidor
const status = await arca.serverStatus();

// Último comprobante autorizado
const ultimo = await arca.ultimoComprobante(1, CbteTipo.FACTURA_B);

// Consultar un comprobante
const cbte = await arca.consultarComprobante(CbteTipo.FACTURA_B, 1, 150);

// Puntos de venta habilitados
const ptosVenta = await arca.getPuntosVenta();

// Cotización del dólar
const cotiz = await arca.getCotizacion(Moneda.DOLARES);

// Tipos disponibles
const tiposCbte = await arca.getTiposComprobante();
const tiposConcepto = await arca.getTiposConcepto();
const tiposDoc = await arca.getTiposDocumento();
const tiposIva = await arca.getTiposIva();
const monedas = await arca.getMonedas();
const tiposTrib = await arca.getTiposTributo();
const tiposOpc = await arca.getTiposOpcional();
const maxRegs = await arca.getCantMaxRegistros();
```

## API

### `new Arca(config)`

| Parámetro | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `cuit` | `number` | — | CUIT del contribuyente (sin guiones) |
| `cert` | `string` | — | Contenido del certificado X.509 (PEM) |
| `key` | `string` | — | Contenido de la clave privada (PEM) |
| `production` | `boolean` | `false` | Entorno de producción |
| `tokenTTLMinutes` | `number` | `720` | TTL del token en minutos |
| `requestTimeoutMs` | `number` | `30000` | Timeout HTTP en milisegundos |
| `retries` | `number` | `1` | Reintentos en consultas (las emisiones nunca se reintentan) |
| `retryDelayMs` | `number` | `1000` | Delay inicial entre reintentos (exponencial) |
| `onEvent` | `function` | — | Callback para eventos del SDK |
| `paramCacheTTLMs` | `number` | `86400000` | TTL del cache de parámetros (0 = sin cache) |
| `ticketStorage` | `TicketStorage` | — | Persistencia del TA entre reinicios (recomendado) |
| `clockOffsetMs` | `number` | `0` | Desfase `relojARCA - relojLocal` en ms |
| `autoClockSkew` | `boolean` | `true` | Ajustar el desfase si WSAA rechaza el login por reloj |
| `signal` | `AbortSignal` | — | Cancela todas las llamadas de la instancia |
| `wsaa` | `WsaaClient` | — | Cliente WSAA compartido (ej: con `ArcaPadron`) |

### Facturación — API simplificada

| Método | Descripción |
| --- | --- |
| `facturar(opts)` | Crea un comprobante con cálculo automático de IVA y totales |
| `notaCredito(opts)` | Crea nota de crédito asociada (tipo NC inferido automáticamente) |
| `notaDebito(opts)` | Crea nota de débito asociada (tipo ND inferido automáticamente) |
| `armarComprobante(opts)` | Valida y arma el comprobante sin enviarlo; devuelve `request`, `importes` e `intento` |
| `recuperarComprobante(intento)` | Resuelve un resultado incierto: `autorizado`, `no_emitido` o `conflicto` |
| `facturarExpo(opts)` | Factura de exportación con auto ID, numeración y cálculo de totales |
| `registrarFacturaCAEA(caea, opts)` | Registra factura con CAEA (misma interfaz que `facturar()`) |

Retornan `FacturaResult` / `FacturaExpoResult` con: `aprobada`, `cae`, `caeVencimiento`, `cbteNro`, `importes`/`obs`, `raw`.

### Facturación — API raw

| Método | Descripción |
| --- | --- |
| `crearFactura(request)` | Solicita CAE para uno o más comprobantes (sin auto-cálculo) |
| `crearFacturaAuto(ptoVta, cbteTipo, invoice)` | Como `crearFactura` pero obtiene el número automáticamente |
| `ultimoComprobante(ptoVta, cbteTipo)` | Último número autorizado |
| `siguienteComprobante(ptoVta, cbteTipo)` | Siguiente número (último + 1) |
| `consultarComprobante(cbteTipo, ptoVta, cbteNro)` | Consulta un comprobante existente |

### Exportación (WSFEX)

| Método | Descripción |
| --- | --- |
| `facturarExpo(opts)` | Factura de exportación simplificada (auto ID y numeración) |
| `crearFacturaExportacion(invoice)` | Autoriza un comprobante de exportación (API raw) |
| `ultimoComprobanteExpo(ptoVta, cbteTipo)` | Último número autorizado (WSFEX) |
| `siguienteComprobanteExpo(ptoVta, cbteTipo)` | Siguiente número (WSFEX) |
| `ultimoIdExpo()` | Último ID de request WSFEX |
| `consultarComprobanteExpo(cbteTipo, ptoVta, cbteNro)` | Consulta comprobante de exportación |
| `serverStatusExpo()` | Estado de los servidores WSFEX |
| `getTiposCbteExpo()` | Tipos de comprobante de exportación |
| `getMonedasExpo()` | Monedas (WSFEX) |
| `getPaisesExpo()` | Países destino |
| `getIdiomasExpo()` | Idiomas disponibles |
| `getIncotermsExpo()` | Incoterms |
| `getUMedExpo()` | Unidades de medida |
| `getTiposExpo()` | Tipos de exportación |
| `getCuitsPaisExpo()` | CUITs de países |

### CAEA (Autorización Anticipada)

| Método | Descripción |
| --- | --- |
| `solicitarCAEA(periodo, orden)` | Solicita un CAEA para un período y quincena |
| `consultarCAEA(periodo, orden)` | Consulta un CAEA existente |
| `registrarFacturaCAEA(caea, opts)` | Registra factura con CAEA (API simplificada) |
| `registrarCAEA(request)` | Informa comprobantes con CAEA (API raw) |
| `sinMovimientoCAEA(caea, ptoVta)` | Informa sin movimientos para un CAEA |

### Padrón (Consulta de contribuyentes)

| Método | Descripción |
| --- | --- |
| `consultarCuit(cuit)` | **Deprecado.** Datos básicos de un contribuyente (padrón A13) |
| `consultarCuitDetalle(cuit)` | **Deprecado.** Constancia de inscripción (ex A5): domicilio fiscal e impuestos |

Retornan `Contribuyente` con: `cuit`, `nombre`, `tipoPersona`, `estadoClave`, `domicilioFiscal?`, `impuestos?`, `raw`.

### Parámetros WSFE

| Método | Descripción |
| --- | --- |
| `serverStatus()` | Estado de los servidores |
| `getTiposComprobante()` | Lista de tipos de comprobante |
| `getTiposConcepto()` | Lista de tipos de concepto |
| `getTiposDocumento()` | Lista de tipos de documento |
| `getCondicionesIva()` | Condiciones de IVA válidas para el receptor |
| `getTiposIva()` | Lista de alícuotas de IVA |
| `getMonedas()` | Lista de monedas |
| `getTiposTributo()` | Lista de tipos de tributo |
| `getTiposOpcional()` | Lista de datos opcionales |
| `getPuntosVenta()` | Puntos de venta habilitados |
| `getCotizacion(monedaId)` | Cotización de una moneda |
| `getCantMaxRegistros()` | Máx registros por request |

### Eventos

| Método | Descripción |
| --- | --- |
| `on(event, handler)` | Suscribirse a un tipo de evento |
| `off(event, handler)` | Desuscribirse de un evento |

### Utilidades estáticas

| Método | Descripción |
| --- | --- |
| `Arca.calcularTotales(items, opts?)` | Calcula importes e IVA sin enviar a ARCA |

También se exportan como funciones: `armarComprobante`, `calcularTotales`, `resolverCbteTipo`,
`intentoDesdeComprobante`, `coincideConIntento`, `facturaResultDesdeConsulta`, `toDateString`.
| `Arca.generateQRUrl(input)` | Genera la URL del QR oficial de ARCA |
| `Arca.extractCAE(result)` | Extrae CAE del resultado raw |
| `Arca.formatDate(date)` | Formatea `Date` a `YYYYMMDD` (timezone Argentina) |

### Otros

| Método | Descripción |
| --- | --- |
| `clearAuthCache()` | Invalida los tickets de acceso (memoria y `ticketStorage`). Devuelve `Promise<void>` |
| `wsaa` | Cliente WSAA de la instancia, para compartirlo con otros SDKs |

## Tipos de comprobante soportados

| Enum | Código | Descripción |
| --- | --- | --- |
| `FACTURA_A` | 1 | Factura A |
| `NOTA_DEBITO_A` | 2 | Nota de Débito A |
| `NOTA_CREDITO_A` | 3 | Nota de Crédito A |
| `RECIBO_A` | 4 | Recibo A |
| `FACTURA_B` | 6 | Factura B |
| `NOTA_DEBITO_B` | 7 | Nota de Débito B |
| `NOTA_CREDITO_B` | 8 | Nota de Crédito B |
| `RECIBO_B` | 9 | Recibo B |
| `FACTURA_C` | 11 | Factura C |
| `NOTA_DEBITO_C` | 12 | Nota de Débito C |
| `NOTA_CREDITO_C` | 13 | Nota de Crédito C |
| `RECIBO_C` | 15 | Recibo C |
| `FACTURA_E` | 19 | Factura de Exportación |
| `NOTA_DEBITO_E` | 20 | Nota de Débito E |
| `NOTA_CREDITO_E` | 21 | Nota de Crédito E |
| `FACTURA_M` | 51 | Factura M |
| `NOTA_DEBITO_M` | 52 | Nota de Débito M |
| `NOTA_CREDITO_M` | 53 | Nota de Crédito M |
| `RECIBO_M` | 54 | Recibo M |
| `FCE_FACTURA_A` | 201 | Factura de Crédito Electrónica MiPyME A |
| `FCE_NOTA_DEBITO_A` | 202 | Nota de Débito FCE MiPyME A |
| `FCE_NOTA_CREDITO_A` | 203 | Nota de Crédito FCE MiPyME A |
| `FCE_FACTURA_B` | 206 | Factura de Crédito Electrónica MiPyME B |
| `FCE_NOTA_DEBITO_B` | 207 | Nota de Débito FCE MiPyME B |
| `FCE_NOTA_CREDITO_B` | 208 | Nota de Crédito FCE MiPyME B |
| `FCE_FACTURA_C` | 211 | Factura de Crédito Electrónica MiPyME C |
| `FCE_NOTA_DEBITO_C` | 212 | Nota de Débito FCE MiPyME C |
| `FCE_NOTA_CREDITO_C` | 213 | Nota de Crédito FCE MiPyME C |

Tambien se incluyen tipos especiales: `COMPRA_BIENES_USADOS` (49), `CTA_VTA_LIQ_PROD_A/B` (60/61), `LIQUIDACION_A/B` (63/64), y comprobantes RG 1415 (34, 35, 39, 40).

## Enums disponibles

- `CbteTipo` — Tipos de comprobante
- `Concepto` — Tipos de concepto (Productos, Servicios, Ambos)
- `DocTipo` — Tipos de documento (CUIT, DNI, Consumidor Final, etc.)
- `CondicionIva` — Condición de IVA del receptor (RI, CF, Monotributo, Exento, etc.)
- `IvaTipo` — Alícuotas de IVA (0%, 2.5%, 5%, 10.5%, 21%, 27%)
- `IVA_RATES` — Record que mapea IvaTipo a su porcentaje numérico
- `Moneda` — Códigos de moneda (PES, DOL, EUR, etc.)
- `TributoTipo` — Tipos de tributo
- `NOTA_CREDITO_MAP` — Mapeo de tipo factura → tipo nota de crédito
- `NOTA_DEBITO_MAP` — Mapeo de tipo factura → tipo nota de débito

## Entornos

| Entorno | WSAA | WSFE | WSFEX | Padrón |
| --- | --- | --- | --- | --- |
| Testing | `wsaahomo.afip.gov.ar` | `wswhomo.afip.gov.ar` | `wswhomo.afip.gov.ar` | `awshomo.afip.gov.ar` |
| Producción | `wsaa.afip.gov.ar` | `servicios1.afip.gov.ar` | `servicios1.afip.gov.ar` | `aws.afip.gov.ar` |

## Licencia

MIT
