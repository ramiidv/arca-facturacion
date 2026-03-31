# arca-sdk

[![CI](https://github.com/ramiidv/arca-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/ramiidv/arca-sdk/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ramiidv/arca-sdk)](https://www.npmjs.com/package/@ramiidv/arca-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

SDK en TypeScript para interactuar con los Web Services de **ARCA** (ex AFIP) — Facturación Electrónica Argentina.

Soporta **todos los tipos de comprobante** de WSFEv1 y WSFEX: Facturas, Notas de Débito/Crédito, Recibos (A, B, C, E, M), Facturas de Crédito Electrónica MiPyME (FCE) y Facturas de Exportación.

## Instalación

```bash
npm install @ramiidv/arca-sdk
```

## Requisitos

- Node.js >= 18
- Certificado digital X.509 y clave privada de ARCA
  - **Testing**: generalo desde [WSASS Homologación](https://wsass-homo.afip.gob.ar/wsass/portal/main.aspx)
  - **Producción**: generalo desde [Administración de Certificados Digitales](https://www.afip.gob.ar/ws/documentacion/certificados.asp) (requiere clave fiscal en [arca.gob.ar](https://arca.gob.ar))

## Uso rápido

```typescript
import fs from "fs";
import { Arca, CbteTipo, IvaTipo } from "@ramiidv/arca-sdk";

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

El SDK calcula automáticamente: IVA, totales (neto, IVA, exento, no gravado, tributos), número de comprobante, fecha (timezone Argentina), agrupa alícuotas de IVA, y completa `CondicionIVAReceptorId` (obligatorio desde abril 2026) para consumidor final. Valida todos los campos requeridos antes de enviar a ARCA.

## Configuración

```typescript
const arca = new Arca({
  cuit: 20123456789,          // CUIT sin guiones
  cert: "...",                 // Certificado X.509 (PEM)
  key: "...",                  // Clave privada (PEM)
  production: false,           // Default: false (testing/homologación)
  tokenTTLMinutes: 720,        // Default: 720 (12 horas)
  requestTimeoutMs: 30_000,    // Default: 30000 (30 segundos)
  retries: 1,                  // Default: 1 (reintentos en errores transitorios)
  retryDelayMs: 1_000,         // Default: 1000 (backoff exponencial: 1s, 2s, ...)
  onEvent: (e) => {            // Opcional: callback para logging/debugging
    console.log(e.type, e);
  },
});
```

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

### Nota de crédito

El tipo de NC se infiere automáticamente del comprobante original (FACTURA_B → NOTA_CREDITO_B).

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

```typescript
// Consulta básica por CUIT (padrón A13)
const persona = await arca.consultarCuit(30712345678);
console.log(persona.nombre);       // "EMPRESA SA"
console.log(persona.tipoPersona);  // "JURIDICA"
console.log(persona.estadoClave);  // "ACTIVO"
console.log(persona.impuestos);    // [{ id: 30, descripcion: "IVA", estado: "AC" }]

// Consulta detallada (padrón A5 — requiere autorización adicional)
const detalle = await arca.consultarCuitDetalle(20123456789);
console.log(detalle.domicilioFiscal); // { direccion, localidad, codPostal }
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

### Previsualizar totales sin enviar

```typescript
const { importes, iva } = Arca.calcularTotales([
  { neto: 1000, iva: IvaTipo.IVA_21 },
  { neto: 500, iva: IvaTipo.IVA_10_5 },
]);
console.log(importes);
// { total: 1762.5, neto: 1500, iva: 262.5, exento: 0, noGravado: 0, tributos: 0 }
```

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

El SDK reintenta automáticamente en errores transitorios (timeout, HTTP 5xx, errores de red). No reintenta en errores de negocio (4xx, errores de ARCA).

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
| `auth:cache-hit` | Token cacheado reutilizado | `service` |
| `request:start` | Antes de una llamada SOAP | `method`, `endpoint` |
| `request:end` | Llamada SOAP completada | `method`, `durationMs` |
| `request:retry` | Reintentando tras error | `method`, `attempt`, `delayMs`, `error` |
| `request:error` | Llamada SOAP falló | `method`, `error` |

## Manejo de errores

El SDK provee clases de error específicas para catch granular:

```typescript
import {
  Arca,
  ArcaAuthError,
  ArcaWSFEError,
  ArcaSoapError,
} from "@ramiidv/arca-sdk";

try {
  const result = await arca.facturar({ ... });
} catch (e) {
  if (e instanceof ArcaAuthError) {
    // Error de autenticación WSAA (certificado inválido, expirado, etc.)
    console.error("Auth error:", e.message);
    arca.clearAuthCache(); // Limpiar cache e intentar de nuevo
  }

  if (e instanceof ArcaWSFEError) {
    // Error de WSFE/WSFEX con códigos de ARCA
    for (const err of e.errors) {
      console.error(`[${err.code}] ${err.msg}`);
    }
  }

  if (e instanceof ArcaSoapError) {
    // Error HTTP/SOAP (timeout, servidor caído, etc.)
    console.error("HTTP status:", e.statusCode);
  }
}
```

| Clase | Cuándo se lanza |
| --- | --- |
| `ArcaAuthError` | Falla en login WSAA, respuesta inesperada, token/sign inválidos |
| `ArcaWSFEError` | Error devuelto por WSFE/WSFEX (campos inválidos, CUIT no autorizado, etc.). Contiene `errors: { code, msg }[]` |
| `ArcaSoapError` | Error HTTP, timeout, SOAP Fault. Contiene `statusCode?: number` |
| `ArcaError` | Clase base para todos los errores del SDK |

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
| `retries` | `number` | `1` | Reintentos en errores transitorios |
| `retryDelayMs` | `number` | `1000` | Delay inicial entre reintentos (exponencial) |
| `onEvent` | `function` | — | Callback para eventos del SDK |

### Facturación — API simplificada

| Método | Descripción |
| --- | --- |
| `facturar(opts)` | Crea un comprobante con cálculo automático de IVA y totales |
| `notaCredito(opts)` | Crea nota de crédito asociada (tipo NC inferido automáticamente) |
| `notaDebito(opts)` | Crea nota de débito asociada (tipo ND inferido automáticamente) |
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
| `consultarCuit(cuit)` | Datos básicos de un contribuyente (padrón A13) |
| `consultarCuitDetalle(cuit)` | Datos detallados con domicilio (padrón A5) |

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
| `Arca.generateQRUrl(input)` | Genera la URL del QR oficial de ARCA |
| `Arca.extractCAE(result)` | Extrae CAE del resultado raw |
| `Arca.formatDate(date)` | Formatea `Date` a `YYYYMMDD` (timezone Argentina) |

### Otros

| Método | Descripción |
| --- | --- |
| `clearAuthCache()` | Invalida los tickets de acceso cacheados |

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
