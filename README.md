# arca-sdk

SDK en TypeScript para interactuar con los Web Services de **ARCA** (ex AFIP) — Facturación Electrónica Argentina.

Soporta **todos los tipos de comprobante** de WSFEv1: Facturas, Notas de Débito/Crédito, Recibos (A, B, C, E, M) y Facturas de Crédito Electrónica MiPyME (FCE).

## Instalación

```bash
npm install @ramiidv/arca-sdk
```

## Requisitos

- Node.js >= 18
- Certificado digital X.509 y clave privada de ARCA
  - **Testing**: generalo desde [WSASS Homologación](https://wsass-homo.afip.gob.ar/wsass/portal/main.aspx)
  - **Producción**: generalo desde [Administrador de Certificados](https://auth.afip.gob.ar/contribuyente_/certificados/)

## Uso rápido

```typescript
import fs from "fs";
import { Arca, CbteTipo, Concepto, DocTipo, IvaTipo, Moneda } from "@ramiidv/arca-sdk";

const arca = new Arca({
  cuit: 20123456789,
  cert: fs.readFileSync("./cert.crt", "utf-8"),
  key: fs.readFileSync("./key.key", "utf-8"),
  production: false, // true para producción
});

// Crear factura B para consumidor final (obtiene el número automáticamente)
const result = await arca.crearFacturaAuto(1, CbteTipo.FACTURA_B, {
  Concepto: Concepto.PRODUCTOS,
  DocTipo: DocTipo.CONSUMIDOR_FINAL,
  DocNro: 0,
  CbteFch: Arca.formatDate(new Date()),
  ImpTotal: 121,
  ImpTotConc: 0,
  ImpNeto: 100,
  ImpOpEx: 0,
  ImpTrib: 0,
  ImpIVA: 21,
  MonId: Moneda.PESOS,
  MonCotiz: 1,
  Iva: [{ Id: IvaTipo.IVA_21, BaseImp: 100, Importe: 21 }],
});

const { approved, cae, caeFchVto } = Arca.extractCAE(result);
console.log(approved ? `CAE: ${cae}` : "Rechazada");
```

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

## Ejemplos

### Factura A por servicios

Para servicios (`Concepto.SERVICIOS` o `Concepto.PRODUCTOS_Y_SERVICIOS`), es obligatorio incluir las fechas de servicio y vencimiento de pago.

```typescript
const result = await arca.crearFacturaAuto(1, CbteTipo.FACTURA_A, {
  Concepto: Concepto.SERVICIOS,
  DocTipo: DocTipo.CUIT,
  DocNro: 30712345678,
  CbteFch: Arca.formatDate(new Date()),
  ImpTotal: 60500,
  ImpTotConc: 0,
  ImpNeto: 50000,
  ImpOpEx: 0,
  ImpTrib: 0,
  ImpIVA: 10500,
  MonId: Moneda.PESOS,
  MonCotiz: 1,
  FchServDesde: "20260301",
  FchServHasta: "20260331",
  FchVtoPago: "20260415",
  Iva: [{ Id: IvaTipo.IVA_21, BaseImp: 50000, Importe: 10500 }],
});
```

### Nota de crédito

```typescript
const result = await arca.crearFacturaAuto(1, CbteTipo.NOTA_CREDITO_B, {
  Concepto: Concepto.PRODUCTOS,
  DocTipo: DocTipo.CONSUMIDOR_FINAL,
  DocNro: 0,
  CbteFch: Arca.formatDate(new Date()),
  ImpTotal: 121,
  ImpTotConc: 0,
  ImpNeto: 100,
  ImpOpEx: 0,
  ImpTrib: 0,
  ImpIVA: 21,
  MonId: Moneda.PESOS,
  MonCotiz: 1,
  Iva: [{ Id: IvaTipo.IVA_21, BaseImp: 100, Importe: 21 }],
  // Asociar con la factura original
  CbtesAsoc: [{ Tipo: CbteTipo.FACTURA_B, PtoVta: 1, Nro: 150 }],
});
```

### Factura con múltiples alícuotas de IVA

```typescript
const result = await arca.crearFacturaAuto(1, CbteTipo.FACTURA_A, {
  Concepto: Concepto.PRODUCTOS,
  DocTipo: DocTipo.CUIT,
  DocNro: 30712345678,
  CbteFch: Arca.formatDate(new Date()),
  ImpTotal: 1352.5,
  ImpTotConc: 0,
  ImpNeto: 1100, // 1000 + 100
  ImpOpEx: 0,
  ImpTrib: 0,
  ImpIVA: 252.5, // 210 + 42.5 (nota: no incluye el IVA 0%)
  MonId: Moneda.PESOS,
  MonCotiz: 1,
  Iva: [
    { Id: IvaTipo.IVA_21, BaseImp: 1000, Importe: 210 },
    { Id: IvaTipo.IVA_10_5, BaseImp: 100, Importe: 10.5 },
    // Para incluir items al 0%, se debe declarar también:
    // { Id: IvaTipo.IVA_0, BaseImp: 500, Importe: 0 },
  ],
});
```

### Factura MiPyME (FCE)

```typescript
const result = await arca.crearFacturaAuto(1, CbteTipo.FCE_FACTURA_A, {
  Concepto: Concepto.PRODUCTOS,
  DocTipo: DocTipo.CUIT,
  DocNro: 30712345678,
  CbteFch: Arca.formatDate(new Date()),
  ImpTotal: 121000,
  ImpTotConc: 0,
  ImpNeto: 100000,
  ImpOpEx: 0,
  ImpTrib: 0,
  ImpIVA: 21000,
  MonId: Moneda.PESOS,
  MonCotiz: 1,
  Iva: [{ Id: IvaTipo.IVA_21, BaseImp: 100000, Importe: 21000 }],
  // Dato obligatorio para FCE: CBU del emisor
  Opcionales: [{ Id: "2101", Valor: "0110012345678901234567" }],
});
```

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

// Tipos de comprobante, documento, IVA, monedas, tributos
const tiposCbte = await arca.getTiposComprobante();
const tiposDoc = await arca.getTiposDocumento();
const tiposIva = await arca.getTiposIva();
const monedas = await arca.getMonedas();
const tiposTrib = await arca.getTiposTributo();
```

## API

### `new Arca(config)`

| Parámetro | Tipo | Descripción |
| --- | --- | --- |
| `cuit` | `number` | CUIT del contribuyente (sin guiones) |
| `cert` | `string` | Contenido del certificado X.509 (PEM) |
| `key` | `string` | Contenido de la clave privada (PEM) |
| `production` | `boolean` | `false` = testing (default), `true` = producción |
| `tokenTTLMinutes` | `number` | TTL del token en minutos (default: 720 = 12h) |

### Facturación

| Método | Descripción |
| --- | --- |
| `crearFactura(request)` | Solicita CAE para uno o más comprobantes |
| `crearFacturaAuto(ptoVta, cbteTipo, invoice)` | Obtiene el número automáticamente y crea la factura |
| `ultimoComprobante(ptoVta, cbteTipo)` | Último número autorizado |
| `siguienteComprobante(ptoVta, cbteTipo)` | Siguiente número (último + 1) |
| `consultarComprobante(cbteTipo, ptoVta, cbteNro)` | Consulta un comprobante existente |

### Parámetros

| Método | Descripción |
| --- | --- |
| `serverStatus()` | Estado de los servidores |
| `getTiposComprobante()` | Lista de tipos de comprobante |
| `getTiposDocumento()` | Lista de tipos de documento |
| `getTiposIva()` | Lista de alícuotas de IVA |
| `getMonedas()` | Lista de monedas |
| `getTiposTributo()` | Lista de tipos de tributo |
| `getTiposOpcional()` | Lista de datos opcionales |
| `getPuntosVenta()` | Puntos de venta habilitados |
| `getCotizacion(monedaId)` | Cotización de una moneda |
| `getCantMaxRegistros()` | Máx registros por request |

### Utilidades estáticas

| Método | Descripción |
| --- | --- |
| `Arca.extractCAE(result)` | Extrae CAE y estado del resultado |
| `Arca.formatDate(date)` | Formatea `Date` a `YYYYMMDD` |

## Enums disponibles

- `CbteTipo` — Tipos de comprobante
- `Concepto` — Tipos de concepto (Productos, Servicios, Ambos)
- `DocTipo` — Tipos de documento (CUIT, DNI, etc.)
- `IvaTipo` — Alícuotas de IVA (0%, 2.5%, 5%, 10.5%, 21%, 27%)
- `Moneda` — Códigos de moneda (PES, DOL, EUR, etc.)
- `TributoTipo` — Tipos de tributo

## Entornos

| Entorno | WSAA | WSFE |
| --- | --- | --- |
| Testing | `wsaahomo.afip.gov.ar` | `wswhomo.afip.gov.ar` |
| Producción | `wsaa.afip.gov.ar` | `servicios1.afip.gov.ar` |

## Licencia

MIT
