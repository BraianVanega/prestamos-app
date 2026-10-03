import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

describe("decimal.js", () => {
  it("suma montos sin errores de punto flotante", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(new Decimal("0.1").plus("0.2").equals("0.3")).toBe(true);
  });

  it("redondea USDT a 8 decimales como la base", () => {
    // usdt_prestado = round(ars_capital / tc_entrada, 8)
    const usdt = new Decimal("1000000").div("1287.5").toDecimalPlaces(8);
    expect(usdt.toFixed(8)).toBe("776.69902913");
  });
});
