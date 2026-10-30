import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcaResultadoIncierto, ArcaWSFEError } from "../src/errors.js";
import { ArcaSoapError, ArcaValidationError } from "@ramiidv/arca-common";
import { CbteTipo, CondicionIva, DocTipo, IvaTipo } from "../src/constants.js";
import {
  arcaDePrueba,
  caeAprobado,
  mockArcaFetch,
  networkError,
  ultimoAutorizado,
  wsfeErrores,
  wsfeResponse,
} from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const B = { ptoVta: 1, cbteTipo: CbteTipo.FACTURA_B, fecha: "20261030", items: [{ total: 1210, iva: IvaTipo.IVA_21 }] };

describe("facturar con cbteNro explícito", () => {
  it("no consulta ultimoComprobante y usa el número indicado", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ FECAESolicitar: caeAprobado({ ptoVta: 1, cbteTipo: 6, cbteNro: 151 }) });

    const res = await arca.facturar({ ...B, cbteNro: 151 });

    expect(mock.count("FECompUltimoAutorizado")).toBe(0);
    expect(mock.calls[0].body).toContain("<CbteDesde>151</CbteDesde>");
    expect(res.aprobada).toBe(true);
    expect(res.cae).toBe("76123456789012");
    expect(res.cbteNro).toBe(151);
  });

  it("sin cbteNro usa último + 1", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({
      FECompUltimoAutorizado: ultimoAutorizado(1, 6, 150),
      FECAESolicitar: caeAprobado({ ptoVta: 1, cbteTipo: 6, cbteNro: 151 }),
    });
    await arca.facturar(B);
    expect(mock.calls[1].body).toContain("<CbteDesde>151</CbteDesde>");
  });
});

describe("emisiones: nunca se reintentan", () => {
  it("timeout → ArcaResultadoIncierto con el intento, y una sola llamada", async () => {
    const arca = await arcaDePrueba({ requestTimeoutMs: 20, retries: 5 });
    const mock = mockArcaFetch({
      FECAESolicitar: () =>
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new DOMException("aborted", "AbortError")), 60)
        ),
    });

    const err = await arca.facturar({ ...B, cbteNro: 151 }).catch((e) => e);

    expect(err).toBeInstanceOf(ArcaResultadoIncierto);
    expect(err.code).toBe("ARCA_RESULTADO_INCIERTO");
    expect(err.operacion).toBe("FECAESolicitar");
    expect(err.intento).toEqual({
      ptoVta: 1,
      cbteTipo: 6,
      cbteNro: 151,
      importeTotal: 1210,
      docTipo: 99,
      docNro: 0,
      fecha: "20261030",
    });
    expect(mock.count("FECAESolicitar")).toBe(1);
  });

  it("conexión cortada después de enviar → incierto", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ FECAESolicitar: networkError("ECONNRESET") });
    await expect(arca.facturar({ ...B, cbteNro: 151 })).rejects.toBeInstanceOf(ArcaResultadoIncierto);
    expect(mock.count("FECAESolicitar")).toBe(1);
  });

  it("HTTP 500 → incierto", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({ FECAESolicitar: new Response("Internal Server Error", { status: 500 }) });
    await expect(arca.facturar({ ...B, cbteNro: 151 })).rejects.toBeInstanceOf(ArcaResultadoIncierto);
  });

  it("respuesta 200 sin FeDetResp → incierto", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({ FECAESolicitar: wsfeResponse("FECAESolicitar", "") });
    await expect(arca.facturar({ ...B, cbteNro: 151 })).rejects.toBeInstanceOf(ArcaResultadoIncierto);
  });

  it("sin conexión (DNS) → no es incierto: no se envió", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({ FECAESolicitar: networkError("ENOTFOUND") });
    const err = await arca.facturar({ ...B, cbteNro: 151 }).catch((e) => e);
    expect(err).not.toBeInstanceOf(ArcaResultadoIncierto);
    expect(err).toBeInstanceOf(ArcaSoapError);
    expect(err.uncertain).toBe(false);
  });

  it("Errors de ARCA → ArcaWSFEError (no se emitió)", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({
      FECAESolicitar: wsfeErrores("FECAESolicitar", [
        { code: 10016, msg: "El numero o fecha del comprobante no se corresponde con el proximo a autorizar." },
      ]),
    });
    const err = await arca.facturar({ ...B, cbteNro: 151 }).catch((e) => e);
    expect(err).toBeInstanceOf(ArcaWSFEError);
    expect(err.tieneCodigo(10016)).toBe(true);
  });

  it("las consultas sí se reintentan", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({
      FECompUltimoAutorizado: [networkError("ECONNRESET"), ultimoAutorizado(1, 6, 150)],
    });
    expect(await arca.ultimoComprobante(1, 6)).toBe(150);
    expect(mock.count("FECompUltimoAutorizado")).toBe(2);
  });

  it("signal abortado antes de llamar: no se envía nada", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ FECAESolicitar: caeAprobado({ ptoVta: 1, cbteTipo: 6, cbteNro: 151 }) });
    const controller = new AbortController();
    controller.abort();
    const err = await arca.facturar({ ...B, cbteNro: 151 }, { signal: controller.signal }).catch((e) => e);
    expect(err).not.toBeInstanceOf(ArcaResultadoIncierto);
    expect(mock.count("FECAESolicitar")).toBe(0);
  });

  it("el signal global de la config también cancela", async () => {
    const controller = new AbortController();
    const arca = await arcaDePrueba({ signal: controller.signal });
    const mock = mockArcaFetch({ FECompUltimoAutorizado: ultimoAutorizado(1, 6, 150) });
    controller.abort();
    await expect(arca.ultimoComprobante(1, 6)).rejects.toThrow();
    expect(mock.count("FECompUltimoAutorizado")).toBe(0);
  });
});

describe("notas de crédito", () => {
  it("validan condicionIva cuando el receptor está identificado", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({});
    const err = await arca
      .notaCredito({
        ptoVta: 1,
        docTipo: DocTipo.CUIT,
        docNro: 20111111112,
        items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
        comprobanteOriginal: { tipo: CbteTipo.FACTURA_A, ptoVta: 1, nro: 10 },
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ArcaValidationError);
    expect(err.field).toBe("condicionIva");
    expect(mock.fn).not.toHaveBeenCalled();
  });

  it("aceptan cbteNro y asocian el comprobante original", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({
      FECAESolicitar: caeAprobado({ ptoVta: 1, cbteTipo: 3, cbteNro: 7, docTipo: 80, docNro: "20111111112" }),
    });
    const res = await arca.notaCredito({
      ptoVta: 1,
      cbteNro: 7,
      fecha: "20261030",
      docTipo: DocTipo.CUIT,
      docNro: 20111111112,
      condicionIva: CondicionIva.RESPONSABLE_INSCRIPTO,
      items: [{ neto: 100, iva: IvaTipo.IVA_21 }],
      comprobanteOriginal: { tipo: CbteTipo.FACTURA_A, ptoVta: 1, nro: 10, fecha: "20261029" },
    });
    expect(res.cbteTipo).toBe(CbteTipo.NOTA_CREDITO_A);
    const body = mock.calls[0].body;
    expect(body).toMatch(/<CbteAsoc>\s*<Tipo>1<\/Tipo>\s*<PtoVta>1<\/PtoVta>\s*<Nro>10<\/Nro>\s*<CbteFch>20261029<\/CbteFch>/);
    expect(mock.count("FECompUltimoAutorizado")).toBe(0);
  });
});
