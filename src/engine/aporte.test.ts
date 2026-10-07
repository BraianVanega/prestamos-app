import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { asientosAporte } from "./aporte";

describe("asientosAporte", () => {
  it("un socio: caja + y capital − del socio", () => {
    expect(asientosAporte("1000", [{ id: "S1", pct: "100" }]).map((a) => [a.cuenta, a.participanteId, a.monto.toFixed(2)])).toEqual([
      ["caja_usdt", undefined, "1000.00"],
      ["capital", "S1", "-1000.00"],
    ]);
  });

  it("ambos socios según % de la sociedad, balanceado", () => {
    const a = asientosAporte("100.00000001", [
      { id: "S1", pct: "50" },
      { id: "S2", pct: "50" },
    ]);
    expect(a.slice(1).map((x) => x.monto.toFixed(8))).toEqual(["-50.00000001", "-50.00000000"]);
    expect(a.reduce((s, x) => s.plus(x.monto), new Decimal(0)).isZero()).toBe(true);
  });

  it("valida el monto", () => {
    expect(() => asientosAporte("0", [{ id: "S1", pct: "100" }])).toThrow();
    expect(() => asientosAporte("1.000000001", [{ id: "S1", pct: "100" }])).toThrow(/decimales/);
  });
});
