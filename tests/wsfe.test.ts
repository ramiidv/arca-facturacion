import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcaServiceError, ArcaSoapError, ArcaValidationError } from "@ramiidv/arca-common";
import { ArcaResultadoIncierto, ArcaWSFEError } from "../src/errors.js";
import { CbteTipo, CondicionIva, DocTipo, IvaTipo, Moneda, TributoTipo } from "../src/constants.js";
import { requiereRecuperacion } from "../src/facturacion.js";
import {
  arcaDePrueba,
  caeAprobado,
  colgado,
  mockArcaFetch,
  orden,
  ultimoAutorizado,
  wsfeErrores,
  wsfeResponse,
} from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const AUTH = { Token: "TOKEN", Sign: "SIGN", Cuit: 20123456786 };
const RI = { docTipo: DocTipo.CUIT, docNro: 30712345671, condicionIva: CondicionIva.RESPONSABLE_INSCRIPTO };

const detResp = (cbteTipo: number, nro: number, resultado: string, extra = "") =>
  `<FeCabResp><Cuit>20123456786</Cuit><PtoVta>1</PtoVta><CbteTipo>${cbteTipo}</CbteTipo><FchProceso>20261030120000</FchProceso>` +
  `<CantReg>1</CantReg><Resultado>${resultado}</Resultado><Reproceso>N</Reproceso></FeCabResp>` +
  `<FeDetResp><FECAEDetResponse><Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro>` +
  `<CbteDesde>${nro}</CbteDesde><CbteHasta>${nro}</CbteHasta><CbteFch>20261030</CbteFch><Resultado>${resultado}</Resultado>` +
  `${extra}</FECAEDetResponse></FeDetResp>`;

describe("FECAESolicitar: XML enviado", () => {
  it("Auth, cabecera y detalle en el orden del WSDL (moneda extranjera, tributos, opcionales, asociados)", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ FECAESolicitar: caeAprobado({ ptoVta: 2, cbteTipo: 3, cbteNro: 8 }) });

    await arca.notaCredito({
      ptoVta: 2,
      cbteNro: 8,
      fecha: "2026-10-30",
      ...RI,
      moneda: Moneda.DOLARES,
      cotizacion: 1015.5,
      canMisMonExt: "N",
      servicio: { desde: "20261001", hasta: "20261031", vtoPago: "20261110" },
      items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
      tributos: [{ Id: TributoTipo.PERCEP_IIBB, Desc: "Percepción IIBB", BaseImp: 100.004, Alic: 3, Importe: 3.0049 }],
      opcionales: [{ Id: "2101", Valor: "0000003100012345678901" }],
      actividades: [620100],
      comprobanteOriginal: { tipo: CbteTipo.FACTURA_A, ptoVta: 2, nro: 7, cuit: "20-12345678-6", fecha: "20261029" },
    });

    const { params } = mock.last("FECAESolicitar");
    expect(orden(params)).toEqual(["Auth", "FeCAEReq"]);
    expect(params.Auth).toEqual({ Token: "TOKEN", Sign: "SIGN", Cuit: "20123456786" });
    expect(params.FeCAEReq.FeCabReq).toEqual({ CantReg: 1, PtoVta: 2, CbteTipo: 3 });

    const det = params.FeCAEReq.FeDetReq.FECAEDetRequest;
    expect(orden(det)).toEqual([
      "Concepto", "DocTipo", "DocNro", "CbteDesde", "CbteHasta", "CbteFch",
      "ImpTotal", "ImpTotConc", "ImpNeto", "ImpOpEx", "ImpTrib", "ImpIVA",
      "FchServDesde", "FchServHasta", "FchVtoPago",
      "MonId", "MonCotiz", "CanMisMonExt", "CondicionIVAReceptorId",
      "CbtesAsoc", "Tributos", "Iva", "Opcionales", "Actividades",
    ]);
    expect(det.Concepto).toBe(2);
    expect(det.CbteFch).toBe("20261030");
    expect(det.MonId).toBe("DOL");
    expect(det.MonCotiz).toBe(1015.5);
    expect(det.CanMisMonExt).toBe("N");
    // Tributo redondeado a 2 decimales, igual que ImpTrib.
    expect(det.Tributos.Tributo).toEqual({ Id: 7, Desc: "Percepción IIBB", BaseImp: 100, Alic: 3, Importe: 3 });
    expect(det.ImpTrib).toBe(3);
    expect(det.ImpTotal).toBe(124);
    expect(det.CbtesAsoc.CbteAsoc).toEqual({ Tipo: 1, PtoVta: 2, Nro: 7, Cuit: "20123456786", CbteFch: "20261029" });
    expect(det.Opcionales.Opcional).toEqual({ Id: 2101, Valor: "0000003100012345678901" });
    expect(det.Actividades.Actividad).toEqual({ Id: 620100 });
  });

  it("sin tributos no envía <Tributos> y en pesos envía MonCotiz 1", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ FECAESolicitar: caeAprobado({ ptoVta: 1, cbteTipo: 6, cbteNro: 1 }) });
    await arca.facturar({ ptoVta: 1, cbteTipo: CbteTipo.FACTURA_B, cbteNro: 1, fecha: "20261030", items: [{ total: 121, iva: IvaTipo.IVA_21 }] });
    const det = mock.last("FECAESolicitar").params.FeCAEReq.FeDetReq.FECAEDetRequest;
    expect(det).not.toHaveProperty("Tributos");
    expect(det).not.toHaveProperty("FchServDesde");
    expect(det.MonCotiz).toBe(1);
    expect(det.CondicionIVAReceptorId).toBe(5);
  });

  it("moneda extranjera con canMisMonExt S puede omitir MonCotiz", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ FECAESolicitar: caeAprobado({ ptoVta: 1, cbteTipo: 1, cbteNro: 1 }) });
    await arca.facturar({ ptoVta: 1, cbteTipo: CbteTipo.FACTURA_A, cbteNro: 1, fecha: "20261030", ...RI, moneda: "DOL", canMisMonExt: "S", items: [{ neto: 10, iva: IvaTipo.IVA_21 }] });
    const det = mock.last("FECAESolicitar").params.FeCAEReq.FeDetReq.FECAEDetRequest;
    expect(det).not.toHaveProperty("MonCotiz");
    expect(det.CanMisMonExt).toBe("S");
  });

  it("nota de débito: tipo inferido y comprobante asociado", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ FECAESolicitar: caeAprobado({ ptoVta: 1, cbteTipo: 7, cbteNro: 4 }) });
    const res = await arca.notaDebito({
      ptoVta: 1,
      cbteNro: 4,
      fecha: "20261030",
      items: [{ total: 50, iva: IvaTipo.IVA_21 }],
      comprobanteOriginal: { tipo: CbteTipo.FACTURA_B, ptoVta: 1, nro: 99 },
    });
    expect(res.cbteTipo).toBe(CbteTipo.NOTA_DEBITO_B);
    const { params } = mock.last("FECAESolicitar");
    expect(params.FeCAEReq.FeCabReq.CbteTipo).toBe(7);
    expect(params.FeCAEReq.FeDetReq.FECAEDetRequest.CbtesAsoc.CbteAsoc).toEqual({ Tipo: 6, PtoVta: 1, Nro: 99 });
  });

  it("NC de FCE: Opcional 22 y asociado con Cuit y CbteFch", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ FECAESolicitar: caeAprobado({ ptoVta: 1, cbteTipo: 203, cbteNro: 2 }) });
    const res = await arca.notaCredito({
      ptoVta: 1,
      cbteNro: 2,
      fecha: "20261030",
      ...RI,
      items: [{ neto: 1000, iva: IvaTipo.IVA_21 }],
      opcionales: [{ Id: "22", Valor: "N" }],
      comprobanteOriginal: { tipo: CbteTipo.FCE_FACTURA_A, ptoVta: 1, nro: 15, cuit: 20123456786, fecha: "20261020" },
    });
    expect(res.cbteTipo).toBe(CbteTipo.FCE_NOTA_CREDITO_A);
    const det = mock.last("FECAESolicitar").params.FeCAEReq.FeDetReq.FECAEDetRequest;
    expect(det.Opcionales.Opcional).toEqual({ Id: 22, Valor: "N" });
    expect(det.CbtesAsoc.CbteAsoc).toEqual({ Tipo: 201, PtoVta: 1, Nro: 15, Cuit: "20123456786", CbteFch: "20261020" });
  });

  it("NC por período asociado (PeriodoAsoc)", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ FECAESolicitar: caeAprobado({ ptoVta: 1, cbteTipo: 8, cbteNro: 3 }) });
    await arca.facturar({
      ptoVta: 1,
      cbteTipo: CbteTipo.NOTA_CREDITO_B,
      cbteNro: 3,
      fecha: "20261030",
      items: [{ total: 121, iva: IvaTipo.IVA_21 }],
      periodoAsoc: { desde: "20261001", hasta: "20261031" },
    });
    const det = mock.last("FECAESolicitar").params.FeCAEReq.FeDetReq.FECAEDetRequest;
    expect(det.PeriodoAsoc).toEqual({ FchDesde: "20261001", FchHasta: "20261031" });
    expect(det).not.toHaveProperty("CbtesAsoc");
  });
});

describe("FECAESolicitar: respuesta", () => {
  it("expone Events y los datos del comprobante", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({
      FECAESolicitar: caeAprobado({
        ptoVta: 1,
        cbteTipo: 6,
        cbteNro: 1,
        events: "<Events><Evt><Code>35</Code><Msg>Aviso 1</Msg></Evt><Evt><Code>36</Code><Msg>Aviso 2</Msg></Evt></Events>",
      }),
    });
    const res = await arca.facturar({ ptoVta: 1, cbteTipo: CbteTipo.FACTURA_B, cbteNro: 1, fecha: "20261030", items: [{ total: 121, iva: IvaTipo.IVA_21 }] });
    expect(res.eventos).toEqual([{ code: 35, msg: "Aviso 1" }, { code: 36, msg: "Aviso 2" }]);
    expect(res).toMatchObject({ fecha: "20261030", docTipo: 99, docNro: 0, moneda: "PES", cotizacion: 1, tipoCodAut: "E" });
    // QR directo desde el resultado.
    const url = arca.urlQR(res);
    const p = JSON.parse(Buffer.from(url.split("?p=")[1], "base64").toString());
    expect(p).toMatchObject({ fecha: "2026-10-30", cuit: 20123456786, codAut: 76123456789012, importe: 121 });
  });

  it("ArcaWSFEError extiende ArcaServiceError", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({ FECAESolicitar: wsfeErrores("FECAESolicitar", [{ code: 10015, msg: "Factura B sin documento" }]) });
    const err = await arca.facturar({ ptoVta: 1, cbteTipo: 6, cbteNro: 1, fecha: "20261030", items: [{ total: 1 }] }).catch((e) => e);
    expect(err).toBeInstanceOf(ArcaWSFEError);
    expect(err).toBeInstanceOf(ArcaServiceError);
    expect(err.code).toBe("ARCA_WSFE_ERROR");
    expect(err.errors).toEqual([{ code: 10015, msg: "Factura B sin documento" }]);
  });

  it("503 en la emisión: un solo fetch y resultado incierto", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ FECAESolicitar: new Response("Service Unavailable", { status: 503 }) });
    const err = await arca.facturar({ ptoVta: 1, cbteTipo: 6, cbteNro: 1, fecha: "20261030", items: [{ total: 1 }] }).catch((e) => e);
    expect(err).toBeInstanceOf(ArcaResultadoIncierto);
    expect(err.cause).toBeInstanceOf(ArcaSoapError);
    expect(err.cause.uncertain).toBe(true);
    expect(mock.count("FECAESolicitar")).toBe(1);
  });
});

describe("10016: número vs fecha", () => {
  const rechazo = (msg: string) =>
    wsfeResponse(
      "FECAESolicitar",
      detResp(6, 151, "R", `<Observaciones><Obs><Code>10016</Code><Msg>${msg}</Msg></Obs></Observaciones>`)
    );
  const B = { ptoVta: 1, cbteTipo: 6, cbteNro: 151, fecha: "20261030", items: [{ total: 121, iva: IvaTipo.IVA_21 }] };

  it("10016 por fecha (CbteFch fuera de rango) no requiere recuperación", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({
      FECAESolicitar: rechazo(
        "El campo CbteFch podra ser nulo o comprendido en el rango N-5 y N+5 siendo N la fecha de envio del pedido de autorizacion."
      ),
    });
    const res = await arca.facturar(B);
    expect(res.aprobada).toBe(false);
    expect(requiereRecuperacion(res)).toBe(false);
  });

  it("10016 por número sí requiere recuperación", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({ FECAESolicitar: rechazo("El numero de comprobante informado debe ser mayor en 1 al ultimo informado") });
    expect(requiereRecuperacion(await arca.facturar(B))).toBe(true);
  });

  it("en un ArcaWSFEError también distingue por mensaje", () => {
    expect(requiereRecuperacion(new ArcaWSFEError([{ code: 10016, msg: "La fecha del comprobante no puede ser anterior" }]))).toBe(false);
    expect(requiereRecuperacion(new ArcaWSFEError([{ code: 10016, msg: "El número o fecha no se corresponde con el próximo a autorizar" }]))).toBe(true);
  });
});

describe("validaciones antes de tocar la red", () => {
  const base = { ptoVta: 1, cbteTipo: CbteTipo.FACTURA_B, cbteNro: 1, items: [{ total: 121, iva: IvaTipo.IVA_21 }] };

  it.each([
    ["fecha inexistente", { fecha: "20261399" }, "fecha"],
    ["concepto 2 sin servicio", { concepto: 2 }, "servicio"],
    ["concepto 1 con servicio", { concepto: 1, servicio: { desde: "20261001", hasta: "20261031", vtoPago: "20261110" } }, "servicio"],
    ["servicio con fecha inválida", { servicio: { desde: "20261001", hasta: "20261032", vtoPago: "20261110" } }, "servicio.hasta"],
    ["servicio hasta < desde", { servicio: { desde: "20261031", hasta: "20261001", vtoPago: "20261110" } }, "servicio.hasta"],
    ["fecha de asociado inválida", { cbtesAsoc: [{ tipo: 6, ptoVta: 1, nro: 1, fecha: "20260230" }] }, "cbtesAsoc[0].fecha"],
    ["PES con cotización distinta de 1", { cotizacion: 2 }, "cotizacion"],
    ["cotización 0", { moneda: "DOL", cotizacion: 0 }, "cotizacion"],
    ["canMisMonExt S con PES", { canMisMonExt: "S" as const }, "canMisMonExt"],
    ["tributo negativo", { tributos: [{ Id: 99, Desc: "x", BaseImp: 0, Alic: 0, Importe: -1 }] }, "tributos[0].Importe"],
    ["CUIT del receptor inválido", { docTipo: 80, docNro: 20123456789, condicionIva: 1 }, "docNro"],
    ["periodoAsoc en una factura", { periodoAsoc: { desde: "20261001", hasta: "20261031" } }, "periodoAsoc"],
  ])("%s", async (_, extra, field) => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({});
    const err = await arca.facturar({ ...base, ...extra } as never).catch((e) => e);
    expect(err).toBeInstanceOf(ArcaValidationError);
    expect(err.field).toBe(field);
    expect(mock.fn).not.toHaveBeenCalled();
  });

  it("Factura A a consumidor final (docTipo 99) → error (10243)", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({});
    const err = await arca.facturar({ ...base, cbteTipo: CbteTipo.FACTURA_A }).catch((e) => e);
    expect(err).toBeInstanceOf(ArcaValidationError);
    expect(err.field).toBe("docTipo");
  });

  it("NC/ND de una Factura E → error claro (van por WSFEX)", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({});
    for (const fn of [arca.notaCredito.bind(arca), arca.notaDebito.bind(arca)]) {
      const err = await fn({ ptoVta: 1, items: [{ neto: 1 }], comprobanteOriginal: { tipo: CbteTipo.FACTURA_E, ptoVta: 1, nro: 1 } }).catch((e) => e);
      expect(err).toBeInstanceOf(ArcaValidationError);
      expect(err.message).toMatch(/facturarExpo/);
    }
    const err = await arca.facturar({ ...base, cbteTipo: CbteTipo.FACTURA_E }).catch((e) => e);
    expect(err.message).toMatch(/WSFEX/);
    expect(mock.fn).not.toHaveBeenCalled();
  });
});

describe("parámetros", () => {
  it("getCotizacion devuelve ResultGet (MonCotiz numérico) y envía FchCotiz", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({
      FEParamGetCotizacion: wsfeResponse(
        "FEParamGetCotizacion",
        "<ResultGet><MonId>DOL</MonId><MonCotiz>1015.5</MonCotiz><FchCotiz>20261029</FchCotiz></ResultGet>"
      ),
    });
    const cot = await arca.getCotizacion("DOL", { fecha: "2026-10-29" });
    expect(cot).toEqual({ MonId: "DOL", MonCotiz: 1015.5, FchCotiz: "20261029" });
    const { params } = mock.last("FEParamGetCotizacion");
    expect(orden(params)).toEqual(["Auth", "MonId", "FchCotiz"]);
    expect(params.FchCotiz).toBe("20261029");
  });

  it("getCotizacion sin ResultGet → error, no undefined", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({ FEParamGetCotizacion: wsfeResponse("FEParamGetCotizacion", "") });
    await expect(arca.getCotizacion("DOL")).rejects.toBeInstanceOf(ArcaSoapError);
  });

  it("getCotizacion con Errors → ArcaWSFEError", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({ FEParamGetCotizacion: wsfeErrores("FEParamGetCotizacion", [{ code: 600, msg: "Moneda inexistente" }]) });
    await expect(arca.getCotizacion("XXX")).rejects.toBeInstanceOf(ArcaWSFEError);
  });

  it("FECompUltimoAutorizado sin CbteNro → error (no 0 ni NaN)", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({ FECompUltimoAutorizado: wsfeResponse("FECompUltimoAutorizado", "<PtoVta>1</PtoVta><CbteTipo>6</CbteTipo>") });
    await expect(arca.ultimoComprobante(1, 6)).rejects.toBeInstanceOf(ArcaSoapError);
  });

  it("FECompTotXRequest sin RegXReq → error", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({ FECompTotXRequest: wsfeResponse("FECompTotXRequest", "") });
    await expect(arca.getCantMaxRegistros()).rejects.toBeInstanceOf(ArcaSoapError);
  });

  it("condiciones de IVA (CondicionIvaReceptor con ClaseCmp)", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({
      FEParamGetCondicionIvaReceptor: wsfeResponse(
        "FEParamGetCondicionIvaReceptor",
        "<ResultGet><CondicionIvaReceptor><Id>1</Id><Desc>IVA Responsable Inscripto</Desc><Cmp_Clase>A/M/C</Cmp_Clase></CondicionIvaReceptor>" +
          "<CondicionIvaReceptor><Id>6</Id><Desc>Responsable Monotributo</Desc><Cmp_Clase>A/M/C</Cmp_Clase></CondicionIvaReceptor></ResultGet>"
      ),
    });
    const items = await arca.getCondicionesIva({ claseCmp: "A" });
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ Id: 1, Desc: "IVA Responsable Inscripto", Cmp_Clase: "A/M/C" });
    expect(mock.last("FEParamGetCondicionIvaReceptor").params.ClaseCmp).toBe("A");
  });

  it("actividades y países: 1 y N elementos", async () => {
    const arca = await arcaDePrueba({ paramCacheTTLMs: 0 });
    mockArcaFetch({
      FEParamGetActividades: wsfeResponse(
        "FEParamGetActividades",
        "<ResultGet><ActividadesTipo><Id>620100</Id><Orden>1</Orden><Desc>Servicios de consultores en informática</Desc></ActividadesTipo></ResultGet>"
      ),
      FEParamGetTiposPaises: wsfeResponse(
        "FEParamGetTiposPaises",
        "<ResultGet><PaisTipo><Id>200</Id><Desc>ARGENTINA</Desc></PaisTipo><PaisTipo><Id>203</Id><Desc>BRASIL</Desc></PaisTipo></ResultGet>"
      ),
    });
    expect(await arca.getActividades()).toEqual([{ Id: 620100, Orden: 1, Desc: "Servicios de consultores en informática" }]);
    expect(await arca.getTiposPaises()).toEqual([{ Id: 200, Desc: "ARGENTINA" }, { Id: 203, Desc: "BRASIL" }]);
  });

  it("cache de parámetros: una sola llamada; los puntos de venta no se cachean", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({
      FEParamGetTiposIva: wsfeResponse("FEParamGetTiposIva", "<ResultGet><IvaTipo><Id>5</Id><Desc>21%</Desc><FchDesde>20090220</FchDesde><FchHasta>NULL</FchHasta></IvaTipo></ResultGet>"),
      FEParamGetPtosVenta: wsfeResponse("FEParamGetPtosVenta", "<ResultGet><PtoVenta><Nro>1</Nro><EmisionTipo>CAE - RECE</EmisionTipo><Bloqueado>N</Bloqueado><FchBaja>NULL</FchBaja></PtoVenta></ResultGet>"),
      FEParamGetTiposMonedas: wsfeResponse("FEParamGetTiposMonedas", "<ResultGet><Moneda><Id>060</Id><Desc>Euro</Desc></Moneda><Moneda><Id>DOL</Id><Desc>Dólar</Desc></Moneda></ResultGet>"),
    });
    await arca.getTiposIva();
    await arca.getTiposIva();
    expect(mock.count("FEParamGetTiposIva")).toBe(1);
    await arca.getPuntosVenta();
    const ptos = await arca.getPuntosVenta();
    expect(mock.count("FEParamGetPtosVenta")).toBe(2);
    expect(ptos).toEqual([{ Nro: 1, EmisionTipo: "CAE - RECE", Bloqueado: "N", FchBaja: "NULL" }]);
    const monedas = await arca.getMonedas();
    expect(monedas.map((m) => m.Id)).toEqual(["060", "DOL"]);
    arca.clearParamCache();
    await arca.getTiposIva();
    expect(mock.count("FEParamGetTiposIva")).toBe(2);
  });
});

describe("config", () => {
  it("usa el fetch de la config (sin globalThis.fetch) y el endpoint propio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("no debería usarse");
    }));
    const calls: string[] = [];
    const fetchPropio = vi.fn(async (url: string) => {
      calls.push(url);
      return ultimoAutorizado(1, 6, 10);
    }) as unknown as typeof fetch;
    const arca = await arcaDePrueba({ fetch: fetchPropio, endpoints: { wsfe: "https://proxy.local/wsfe" } });
    expect(await arca.ultimoComprobante(1, 6)).toBe(10);
    expect(calls).toEqual(["https://proxy.local/wsfe"]);
  });

  it("rechaza un CUIT inválido", async () => {
    await expect(arcaDePrueba({ cuit: 20123456789 })).rejects.toBeInstanceOf(ArcaValidationError);
  });

  it("timeout de la config (timeout de ArcaBaseConfig)", async () => {
    const arca = await arcaDePrueba({ timeout: 20, retries: 0 });
    mockArcaFetch({ FECompUltimoAutorizado: colgado(80) });
    const err = await arca.ultimoComprobante(1, 6).catch((e) => e);
    expect(err).toBeInstanceOf(ArcaSoapError);
    expect(err.message).toMatch(/Timeout/);
  });
});
