import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { asientosDesembolso, participacionSociedad } from "./desembolso";

describe("asientosDesembolso", () => {
  it("cartera +USDT, caja −USDT y balancea", () => {
    const asientos = asientosDesembolso("p1", "2723.73540856");
    expect(asientos.map((a) => [a.cuenta, a.moneda, a.monto.toFixed(8), a.prestamoId])).toEqual([
      ["cartera", "USDT", "2723.73540856", "p1"],
      ["caja_usdt", "USDT", "-2723.73540856", undefined],
    ]);
    expect(asientos.reduce((s, a) => s.plus(a.monto), new Decimal(0)).isZero()).toBe(true);
  });

  it("rechaza montos no positivos", () => {
    expect(() => asientosDesembolso("p1", "0")).toThrow();
    expect(() => asientosDesembolso("p1", "-1")).toThrow();
  });
});

describe("participacionSociedad", () => {
  it("100% capital y ganancia a la Sociedad", () => {
    const [p, ...resto] = participacionSociedad("soc");
    expect(resto).toEqual([]);
    expect([p!.participanteId, p!.pctCapital.toString(), p!.pctGanancia.toString()]).toEqual(["soc", "100", "100"]);
  });
});
