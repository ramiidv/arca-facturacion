import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcaResultadoIncierto } from "../src/errors.js";
import { CbteTipo, CondicionIva, DocTipo, IvaTipo } from "../src/constants.js";
import type { IntentoComprobante } from "../src/types.js";
import {
  arcaDePrueba,
  caeAprobado,
  comprobanteConsultado,
  mockArcaFetch,
  networkError,
  ultimoAutorizado,
} from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const intento: IntentoComprobante = {
  ptoVta: 1,
  cbteTipo: CbteTipo.FACTURA_A,
  cbteNro: 151,
  importeTotal: 1210,
  docTipo: DocTipo.CUIT,
  docNro: 20111111112,
  fecha: "20261030",
};

const consultado = {
  ptoVta: 1,
  cbteTipo: 1,
  cbteNro: 151,
  docTipo: 80,
  docNro: "20111111112",
  fecha: "20261030",
  total: 1210,
  neto: 1000,
  iva: 210,
};

describe("recuperarComprobante", () => {
  it("último autorizado < cbteNro → no_emitido (sin consultar el comprobante)", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({ FECompUltimoAutorizado: ultimoAutorizado(1, 1, 150) });
    expect(await arca.recuperarComprobante(intento)).toEqual({ estado: "no_emitido" });
    expect(mock.count("FECompConsultar")).toBe(0);
  });

  it("existe y coincide → autorizado con CAE y vencimiento", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({
      FECompUltimoAutorizado: ultimoAutorizado(1, 1, 151),
      FECompConsultar: comprobanteConsultado({ ...consultado, cae: "76999999999999" }),
    });
    const res = await arca.recuperarComprobante(intento);
    expect(res.estado).toBe("autorizado");
    if (res.estado !== "autorizado") return;
    expect(res.resultado).toMatchObject({
      aprobada: true,
      cae: "76999999999999",
      caeVencimiento: "20261109",
      cbteNro: 151,
      ptoVta: 1,
      cbteTipo: 1,
      importes: { total: 1210, neto: 1000, iva: 210 },
    });
  });

  it("tolera diferencias de hasta 0,01 en el total", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({
      FECompUltimoAutorizado: ultimoAutorizado(1, 1, 160),
      FECompConsultar: comprobanteConsultado({ ...consultado, total: 1210.01 }),
    });
    expect((await arca.recuperarComprobante(intento)).estado).toBe("autorizado");
  });

  it.each([
    ["otro total", { total: 1300 }],
    ["otro documento", { docNro: "20222222223" }],
    ["otra fecha", { fecha: "20261029" }],
    ["otro tipo de documento", { docTipo: 96 }],
  ])("existe con %s → conflicto", async (_, cambio) => {
    const arca = await arcaDePrueba();
    mockArcaFetch({
      FECompUltimoAutorizado: ultimoAutorizado(1, 1, 151),
      FECompConsultar: comprobanteConsultado({ ...consultado, ...cambio }),
    });
    const res = await arca.recuperarComprobante(intento);
    expect(res.estado).toBe("conflicto");
    if (res.estado === "conflicto") expect(res.encontrado.ResultGet.CbteDesde).toBe(151);
  });

  it("flujo completo: emitir → incierto → recuperar → autorizado", async () => {
    const arca = await arcaDePrueba();
    mockArcaFetch({
      FECAESolicitar: networkError("ECONNRESET"),
      FECompUltimoAutorizado: ultimoAutorizado(1, 1, 151),
      FECompConsultar: comprobanteConsultado(consultado),
    });

    const err = await arca
      .facturar({
        ptoVta: 1,
        cbteTipo: CbteTipo.FACTURA_A,
        cbteNro: 151,
        fecha: "20261030",
        docTipo: DocTipo.CUIT,
        docNro: 20111111112,
        condicionIva: CondicionIva.RESPONSABLE_INSCRIPTO,
        items: [{ neto: 1000, iva: IvaTipo.IVA_21 }],
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ArcaResultadoIncierto);

    const res = await arca.recuperarComprobante(err.intento);
    expect(res.estado).toBe("autorizado");
  });

  it("flujo completo: no_emitido → reintento con el mismo número", async () => {
    const arca = await arcaDePrueba();
    const mock = mockArcaFetch({
      FECAESolicitar: [networkError("ECONNRESET"), caeAprobado({ ptoVta: 1, cbteTipo: 6, cbteNro: 151 })],
      FECompUltimoAutorizado: ultimoAutorizado(1, 6, 150),
    });
    const opts = {
      ptoVta: 1,
      cbteTipo: CbteTipo.FACTURA_B,
      cbteNro: 151,
      fecha: "20261030",
      items: [{ total: 1210, iva: IvaTipo.IVA_21 }],
    };

    const err = await arca.facturar(opts).catch((e) => e);
    const res = await arca.recuperarComprobante(err.intento);
    expect(res.estado).toBe("no_emitido");

    const ok = await arca.facturar(opts);
    expect(ok.aprobada).toBe(true);
    expect(mock.calls.filter((c) => c.method === "FECAESolicitar").map((c) => /<CbteDesde>(\d+)/.exec(c.body)![1]))
      .toEqual(["151", "151"]);
  });
});
