import { describe, expect, it } from "vitest";
import { abrirSociedad, repartir } from "./reparto";

const socios = [
  { id: "s1", pct: "50" },
  { id: "s2", pct: "50" },
];

describe("repartir", () => {
  it("50/50 con resto de redondeo a la última parte", () => {
    const r = repartir("0.00000001", socios, 8);
    expect(r.map((x) => x.monto.toFixed(8))).toEqual(["0.00000001", "0.00000000"]);
    const r2 = repartir("100.01", socios, 2);
    expect(r2.map((x) => x.monto.toFixed(2))).toEqual(["50.01", "50.00"]);
  });

  it("tercios suman exacto", () => {
    const r = repartir("100", [{ id: "a", pct: "33.3333" }, { id: "b", pct: "33.3333" }, { id: "c", pct: "33.3334" }], 2);
    expect(r.map((x) => x.monto.toFixed(2))).toEqual(["33.33", "33.33", "33.34"]);
  });

  it("valida que sumen 100", () => {
    expect(() => repartir("10", [{ id: "a", pct: "60" }], 2)).toThrow();
    expect(() => repartir("10", [], 2)).toThrow();
  });
});

describe("abrirSociedad", () => {
  it("la parte de la Sociedad se abre por socio y se suma a la directa", () => {
    const r = abrirSociedad(
      [
        { participanteId: "soc", esSociedad: true, monto: "1000" },
        { participanteId: "s1", esSociedad: false, monto: "200" },
        { participanteId: "f1", esSociedad: false, monto: "50" },
      ],
      socios,
      8,
    );
    expect(r.map((x) => [x.id, x.monto.toFixed(2)])).toEqual([
      ["s1", "700.00"],
      ["s2", "500.00"],
      ["f1", "50.00"],
    ]);
  });

  it("sin montos: socios en cero", () => {
    expect(abrirSociedad([], socios, 8).map((x) => x.monto.toFixed(0))).toEqual(["0", "0"]);
  });
});
