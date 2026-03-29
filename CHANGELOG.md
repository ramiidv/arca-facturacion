# Changelog

## 1.1.4

- Fix: add `default` export for tsx/CJS bundler compatibility

## 1.1.3

- Add examples for export invoicing, CAEA, padron, and QR generation

## 1.1.2

- Fix: XML parser no longer converts CAE, dates, and CUITs to numbers
  - CAE with leading zeros (e.g., `04512345678901`) now preserved correctly
  - Dates (`CbteFch`, `CAEFchVto`) remain as strings
  - Added `Number()` guards on all numeric return paths

## 1.1.1

- Add `registrarFacturaCAEA()` simplified API for offline invoicing with CAEA
- Update README and llm.txt with CAEA, padron, and export docs

## 1.1.0

- Add `facturarExpo()` simplified API for export invoices (WSFEX)
- Add CAEA support: `solicitarCAEA`, `consultarCAEA`, `registrarCAEA`, `sinMovimientoCAEA`
- Add Padron support: `consultarCuit` (A13), `consultarCuitDetalle` (A5)
- New types: `FacturarExpoOpts`, `FacturaExpoResult`, `Contribuyente`, `CaeaSolicitarResult`

## 1.0.0

- Retry with exponential backoff on transient errors (default: 1 retry)
- Event system: `onEvent` callback + `.on()`/`.off()` for auth, requests, retries
- `Arca.generateQRUrl()` for official ARCA QR code URLs
- WSFEX support for export invoices (authorize, query, params)
- Refactor: `SoapOptions` object, `afipSoapCall` with namespace param

## 0.3.0

- Update to TypeScript 6.0, fast-xml-parser 5.5, node-forge 1.4, @types/node 25
- Rewrite examples to use simplified API
- Add `isolatedModules` to tsconfig
- Include `llm.txt` in npm package
- Extract `getParam<T>()` helper in WsfeClient, remove all `as any` casts

## 0.2.1

- Throw error when `LineItem` has both `iva` and `exento` set

## 0.2.0

- Add simplified API: `facturar()`, `notaCredito()`, `notaDebito()`
- Auto-calculate IVA, totals, and comprobante numbers from line items
- Auto-detect Factura C (monotributista) to skip IVA discrimination
- Add `Arca.calcularTotales()` static utility for previewing totals
- Add NC/ND type auto-inference from original comprobante type
- Add custom error classes: `ArcaAuthError`, `ArcaWSFEError`, `ArcaSoapError`
- Fix auth race condition with login deduplication
- Add 2-minute safety margin on token expiry
- Add HTTP timeout with AbortController (configurable, default 30s)
- Add `checkErrors` to `solicitarCAE`
- Add `getTiposConcepto`
- Fix `formatDate` to use Argentina timezone

## 0.1.0

- Initial release
- WSFEv1 support: facturas, notas de crédito/débito, recibos (A, B, C, E, M, FCE)
- WSAA authentication with certificate signing (PKCS#7/CMS)
- Token caching and auto-renewal
- All WSFEv1 parameter queries
