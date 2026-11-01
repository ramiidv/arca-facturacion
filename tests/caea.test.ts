import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcaSoapError, ArcaValidationError } from "@ramiidv/arca-common";
import { ArcaResultadoIncierto, ArcaWSFEError } from "../src/errors.js";
import { CbteTipo, IvaTipo } from "../src/constants.js";
import { formatFechaHora } from "../src/facturacion.js";
import { arcaDePrueba, colgado, mockArcaFetch, orden, ultimoAutorizado, wsfeErrores, wsfeResponse } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const CAEA = "36123456789012";

const caeaGet = (method: string) =>
  wsfeResponse(
    method,
    `<ResultGet><CAEA>${CAEA}</CAEA><Periodo>202611</Periodo><Orden>1</Orden><FchVigDesde>20261101</FchVigDesde>` +
      "<FchVigHasta>20261115</FchVigHasta><FchTopeInf>20261123</FchTopeInf><FchProceso>20261025103000</FchProceso></ResultGet>" +
      "<Events><Evt><Code>1</Code><Msg>Recordá informar los comprobantes</Msg></Evt></Events>"
  );

const regInfAprobado = (nro: number) =>
  wsfeResponse(
    "FECAEARegInformativo",
    "<FeCabResp><Cuit>20123456786</Cuit><PtoVta>5</PtoVta><CbteTipo>6</CbteTipo><FchProceso>20261104120000</FchProceso>" +
      "<CantReg>1</CantReg><Resultado>A</Resultado><Reproceso>N</Reproceso></FeCabResp>" +
      "<FeDetResp><FECAEADetResponse><Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro>" +
      `<CbteDesde>${nro}</CbteDesde><CbteHasta>${nro}</CbteHasta><CbteFch>20261103</CbteFch><Resultado>A</Resultado>` +
      `<CAEA>${CAEA}</CAEA></FECAEADetResponse></FeDetResp>`
  );

describe("CAEA: solicitar y consultar", () => {
  it("FECAEASolicitar: request Periodo/Orden y ResultGet parseado", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ FECAEASolicitar: caeaGet("FECAEASolicitar") });
    const res = await arca.solicitarCAEA("202611", 1);
    const { params } = mock.last("FECAEASolicitar");
    expect(orden(params)).toEqual(["Auth", "Periodo", "Orden"]);
    expect(params.Periodo).toBe(202611);
    expect(res).toMatchObject({
      CAEA,
      Periodo: "202611",
      Orden: 1,
      FchVigDesde: "20261101",
      FchVigHasta: "20261115",
      FchTopeInf: "20261123",
      eventos: [{ code: 1, msg: "Recordá informar los comprobantes" }],
    });
  });

  it("FECAEAConsultar con Errors → ArcaWSFEError", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({ FECAEAConsultar: wsfeErrores("FECAEAConsultar", [{ code: 602, msg: "No existen datos" }]) });
    await expect(arca.consultarCAEA("202611", 2)).rejects.toBeInstanceOf(ArcaWSFEError);
  });

  it("respuesta sin ResultGet → error (no undefined)", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({ FECAEAConsultar: wsfeResponse("FECAEAConsultar", "") });
    await expect(arca.consultarCAEA("202611", 1)).rejects.toBeInstanceOf(ArcaSoapError);
  });

  it("valida período y orden", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({});
    await expect(arca.solicitarCAEA("2026-11", 1)).rejects.toBeInstanceOf(ArcaValidationError);
    await expect(arca.solicitarCAEA("202611", 3)).rejects.toBeInstanceOf(ArcaValidationError);
    expect(mock.fn).not.toHaveBeenCalled();
  });
});

describe("CAEA: informar comprobantes (FECAEARegInformativo)", () => {
  const opts = {
    ptoVta: 5,
    cbteTipo: CbteTipo.FACTURA_B,
    cbteNro: 10,
    items: [{ total: 121, iva: IvaTipo.IVA_21 }],
  };

  it("envía CAEA y CbteFchHsGen al final del detalle; CbteFch = fecha de generación", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ FECAEARegInformativo: regInfAprobado(10) });
    const res = await arca.registrarFacturaCAEA(CAEA, {
      ...opts,
      fechaHoraGeneracion: new Date("2026-11-03T14:32:10-03:00"),
    });
    const det = mock.last("FECAEARegInformativo").params.FeCAEARegInfReq.FeDetReq.FECAEADetRequest;
    const keys = orden(det);
    expect(keys.slice(-2)).toEqual(["CAEA", "CbteFchHsGen"]);
    expect(det.CAEA).toBe(CAEA);
    expect(det.CbteFchHsGen).toBe("20261103143210");
    expect(det.CbteFch).toBe("20261103");
    expect(res).toMatchObject({ aprobada: true, cae: CAEA, tipoCodAut: "A", cbteNro: 10 });
  });

  it("sin fechaHoraGeneracion → error de validación sin llamar a ARCA", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({});
    const err = await arca.registrarFacturaCAEA(CAEA, opts as never).catch((e) => e);
    expect(err).toBeInstanceOf(ArcaValidationError);
    expect(err.field).toBe("fechaHoraGeneracion");
    expect(mock.fn).not.toHaveBeenCalled();
  });

  it("registrarCAEA raw exige CbteFchHsGen con formato yyyymmddhhmmss", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({});
    const inv = {
      Concepto: 1, DocTipo: 99, DocNro: 0, CbteDesde: 1, CbteHasta: 1, CbteFch: "20261103",
      ImpTotal: 121, ImpTotConc: 0, ImpNeto: 100, ImpOpEx: 0, ImpTrib: 0, ImpIVA: 21,
      MonId: "PES", MonCotiz: 1, CondicionIVAReceptorId: 5, CAEA,
    };
    await expect(arca.registrarCAEA({ PtoVta: 5, CbteTipo: 6, invoices: [inv as never] })).rejects.toBeInstanceOf(ArcaValidationError);
    await expect(
      arca.registrarCAEA({ PtoVta: 5, CbteTipo: 6, invoices: [{ ...inv, CbteFchHsGen: "20261103256000" }] })
    ).rejects.toBeInstanceOf(ArcaValidationError);
    expect(mock.fn).not.toHaveBeenCalled();
  });

  it("timeout → ArcaResultadoIncierto con una sola llamada", async () => {
    const arca = await arcaDePrueba({ timeout: 20 });
    const mock = mockArcaFetch({ FECAEARegInformativo: colgado(60) });
    const err = await arca
      .registrarFacturaCAEA(CAEA, { ...opts, fechaHoraGeneracion: "20261103143210" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ArcaResultadoIncierto);
    expect(err.operacion).toBe("FECAEARegInformativo");
    expect(err.intento).toMatchObject({ ptoVta: 5, cbteNro: 10, fecha: "20261103" });
    expect(mock.count("FECAEARegInformativo")).toBe(1);
  });

  it("sin cbteNro usa último + 1", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({
      FECompUltimoAutorizado: ultimoAutorizado(5, 6, 9),
      FECAEARegInformativo: regInfAprobado(10),
    });
    const { cbteNro: _, ...sinNro } = opts;
    await arca.registrarFacturaCAEA(CAEA, { ...sinNro, fechaHoraGeneracion: "20261103143210" });
    expect(mock.last("FECAEARegInformativo").params.FeCAEARegInfReq.FeDetReq.FECAEADetRequest.CbteDesde).toBe(10);
  });
});

describe("CAEA sin movimiento", () => {
  it("FECAEASinMovimientoInformar: orden PtoVta, CAEA (WSDL) y emisión sin reintento", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({
      FECAEASinMovimientoInformar: wsfeResponse(
        "FECAEASinMovimientoInformar",
        `<CAEA>${CAEA}</CAEA><FchProceso>20261116</FchProceso><PtoVta>5</PtoVta><Resultado>A</Resultado>`
      ),
    });
    const res = await arca.sinMovimientoCAEA(CAEA, 5);
    expect(orden(mock.last("FECAEASinMovimientoInformar").params)).toEqual(["Auth", "PtoVta", "CAEA"]);
    expect(res).toMatchObject({ CAEA, Resultado: "A", PtoVta: 5 });
  });

  it("FECAEASinMovimientoInformar: 503 → una sola llamada, uncertain", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ FECAEASinMovimientoInformar: new Response("", { status: 503 }) });
    const err = await arca.sinMovimientoCAEA(CAEA, 5).catch((e) => e);
    expect(err).toBeInstanceOf(ArcaSoapError);
    expect(err.uncertain).toBe(true);
    expect(mock.count("FECAEASinMovimientoInformar")).toBe(1);
  });

  it("FECAEASinMovimientoConsultar: orden CAEA, PtoVta y 1 o N resultados", async () => {
    const arca = await arcaDePrueba();
    const item = (pto: number) => `<FECAEASinMov><CAEA>${CAEA}</CAEA><FchProceso>20261116</FchProceso><PtoVta>${pto}</PtoVta></FECAEASinMov>`;
    const mock = mockArcaFetch({
      FECAEASinMovimientoConsultar: [
        wsfeResponse("FECAEASinMovimientoConsultar", `<ResultGet>${item(5)}</ResultGet>`),
        wsfeResponse("FECAEASinMovimientoConsultar", `<ResultGet>${item(5)}${item(6)}</ResultGet>`),
      ],
    });
    expect(await arca.consultarSinMovimientoCAEA(CAEA, 5)).toEqual([{ CAEA, FchProceso: "20261116", PtoVta: 5 }]);
    expect(orden(mock.last("FECAEASinMovimientoConsultar").params)).toEqual(["Auth", "CAEA", "PtoVta"]);
    expect((await arca.consultarSinMovimientoCAEA(CAEA, 5)).map((i) => i.PtoVta)).toEqual([5, 6]);
  });
});

describe("formatFechaHora", () => {
  it("Date en hora de Argentina y validación del string", () => {
    expect(formatFechaHora(new Date("2026-11-03T17:32:10Z"))).toBe("20261103143210");
    expect(formatFechaHora("20261103000000")).toBe("20261103000000");
    expect(() => formatFechaHora("20261131120000")).toThrow(ArcaValidationError);
    expect(() => formatFechaHora("2026110312")).toThrow(ArcaValidationError);
  });
});
