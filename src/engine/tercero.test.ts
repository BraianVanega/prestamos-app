import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { asientosAporteTerceros, participacionesPrestamo } from "./desembolso";
import { asientosPagoTercero, deudaTercero } from "./tercero";

const texto = (ps: { participanteId: string; pctCapital: Decimal; pctGanancia: Decimal }[]) =>
  ps.map((p) => [p.participanteId, p.pctCapital.toString(), p.pctGanancia.toString()]);

describe("participacionesPrestamo", () => {
  it("sin terceros es 100% de la Sociedad", () => {
    expect(texto(participacionesPrestamo("soc", []))).toEqual([["soc", "100", "100"]]);
  });

  it("el tercero pone su % y la Sociedad el resto, igual en capital y ganancia", () => {
    expect(texto(participacionesPrestamo("soc", [{ participanteId: "t1", pct: "20" }]))).toEqual([
      ["soc", "80", "80"],
      ["t1", "20", "20"],
    ]);
  });

  it("varios terceros; si llegan al 100% no queda parte de la Sociedad", () => {
    expect(texto(participacionesPrestamo("soc", [{ participanteId: "t1", pct: "60" }, { participanteId: "t2", pct: "40" }]))).toEqual([
      ["t1", "60", "60"],
      ["t2", "40", "40"],
    ]);
  });

  it("rechaza % fuera de rango, repetidos o que pasan el 100", () => {
    expect(() => participacionesPrestamo("soc", [{ participanteId: "t1", pct: "0" }])).toThrow();
    expect(() => participacionesPrestamo("soc", [{ participanteId: "t1", pct: "10.12345" }])).toThrow();
    expect(() => participacionesPrestamo("soc", [{ participanteId: "t1", pct: "10" }, { participanteId: "t1", pct: "10" }])).toThrow();
    expect(() => participacionesPrestamo("soc", [{ participanteId: "t1", pct: "70" }, { participanteId: "t2", pct: "40" }])).toThrow();
  });
});

describe("asientosAporteTerceros", () => {
  it("la parte del tercero entra a la caja contra su capital, ligada al préstamo", () => {
    const partes = participacionesPrestamo("soc", [{ participanteId: "t1", pct: "20" }]);
    const asientos = asientosAporteTerceros("p1", "500", partes, "soc");
    expect(asientos.map((a) => [a.cuenta, a.monto.toFixed(8), a.participanteId, a.prestamoId])).toEqual([
      ["caja_usdt", "100.00000000", undefined, undefined],
      ["capital", "-100.00000000", "t1", "p1"],
    ]);
    expect(asientos.reduce((s, a) => s.plus(a.monto), new Decimal(0)).isZero()).toBe(true);
  });

  it("el redondeo queda en la Sociedad", () => {
    const partes = participacionesPrestamo("soc", [{ participanteId: "t1", pct: "33.3333" }]);
    const [caja] = asientosAporteTerceros("p1", "62.5", partes, "soc");
    expect(caja!.monto.toFixed(8)).toBe("20.83331250");
  });

  it("sin terceros no hay asientos", () => {
    expect(asientosAporteTerceros("p1", "500", participacionesPrestamo("soc", []), "soc")).toEqual([]);
  });
});

describe("deudaTercero", () => {
  it("su % de lo recuperado (con tope en lo que puso) más su ganancia, menos lo pagado", () => {
    const d = deudaTercero({
      prestamos: [
        { pct: "20", puesto: "100", recuperado: "250" },
        { pct: "50", puesto: "50", recuperado: "130" },
      ],
      ganancia: "7",
      pagadoCapital: "30",
      pagadoGanancia: "2",
    });
    expect([d.puesto, d.capitalRecuperado, d.disponibleCapital, d.disponibleGanancia, d.disponible].map((x) => x.toString())).toEqual([
      "150",
      "100",
      "70",
      "5",
      "75",
    ]);
  });
});

describe("asientosPagoTercero", () => {
  const deuda = { disponibleCapital: new Decimal("70"), disponibleGanancia: new Decimal("5") };

  it("paga primero capital y después ganancia, y balancea", () => {
    const asientos = asientosPagoTercero("t1", "72", deuda);
    expect(asientos.map((a) => [a.cuenta, a.monto.toString(), a.participanteId])).toEqual([
      ["caja_usdt", "-72", undefined],
      ["capital", "70", "t1"],
      ["ganancia", "2", "t1"],
    ]);
    expect(asientos.reduce((s, a) => s.plus(a.monto), new Decimal(0)).isZero()).toBe(true);
  });

  it("no paga más de lo que se le debe", () => {
    expect(() => asientosPagoTercero("t1", "75.00000001", deuda)).toThrow("Supera lo que se le debe");
    expect(() => asientosPagoTercero("t1", "0", deuda)).toThrow();
  });
});
