import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { armarLotes, asientosConversionLote, ErrorConversion, lotesFifo, usdtConversion } from "./conversion";

const pendientes = [
  { pagoId: "P1", fecha: "2026-10-01", pendiente: "100000" },
  { pagoId: "P2", fecha: "2026-10-03", pendiente: "50000" },
];

const suma = (xs: { moneda: string; monto: Decimal }[], moneda: string) =>
  xs.filter((x) => x.moneda === moneda).reduce((s, x) => s.plus(x.monto), new Decimal(0));

describe("lotesFifo", () => {
  it("convierte primero el efectivo más viejo", () => {
    expect([...lotesFifo("120000", pendientes)].map(([k, v]) => [k, v.toFixed(2)])).toEqual([
      ["P1", "100000.00"],
      ["P2", "20000.00"],
    ]);
  });
});

describe("armarLotes", () => {
  it("reparte los USDT en proporción y la suma da exacta", () => {
    const r = armarLotes({
      fecha: "2026-10-05",
      ars: "100000",
      tc: "1300",
      pendientes,
      lotes: new Map([
        ["P1", "70000"],
        ["P2", "30000"],
      ]),
    });
    expect(r.usdt.toFixed(8)).toBe(usdtConversion("100000", "1300").toFixed(8));
    expect(r.usdt.toFixed(8)).toBe("76.92307692");
    expect(r.lotes.map((l) => l.usdt.toFixed(8))).toEqual(["53.84615384", "23.07692308"]);
    expect(r.lotes.reduce((s, l) => s.plus(l.usdt), new Decimal(0)).eq(r.usdt)).toBe(true);
  });

  it("valida lotes", () => {
    const base = { fecha: "2026-10-05", ars: "1000", tc: "1300", pendientes };
    expect(() => armarLotes({ ...base, lotes: new Map([["P1", "900"]]) })).toThrow(/sumar/);
    expect(() => armarLotes({ ...base, ars: "60000", lotes: new Map([["P2", "60000"]]) })).toThrow(/supera/);
    expect(() => armarLotes({ ...base, lotes: new Map([["PX", "1000"]]) })).toThrow(/cambió/);
    expect(() => armarLotes({ ...base, fecha: "2026-10-02", lotes: new Map([["P2", "1000"]]) })).toThrow(/antes/);
    expect(() => armarLotes({ ...base, tc: "0", lotes: new Map([["P1", "1000"]]) })).toThrow(ErrorConversion);
  });
});

describe("asientosConversionLote", () => {
  it("efectivo del ejemplo de la spec: 120.000 a TC 1.605 recupera 62,5 y gana 12,27", () => {
    const usdt = usdtConversion("120000", "1605");
    const { asientos, prestamos } = asientosConversionLote({
      ars: "120000",
      usdt,
      porPrestamo: [{ prestamoId: "A", ars: "120000" }],
      saldoFavorArs: "0",
      clienteId: "C",
      cartera: new Map([["A", "62.5"]]),
      participaciones: new Map([["A", [{ participanteId: "S", pctGanancia: "100" }]]]),
    });
    expect(asientos.map((a) => [a.cuenta, a.monto.toFixed(8)])).toEqual([
      ["caja_efectivo_ars", "-120000.00000000"],
      ["puente_cambio", "120000.00000000"],
      ["caja_usdt", "74.76635514"],
      ["cartera", "-62.50000000"],
      ["ganancia", "-12.26635514"],
    ]);
    expect(suma(asientos, "ARS").isZero() && suma(asientos, "USDT").isZero()).toBe(true);
    expect(prestamos[0]!.ganancia.toFixed(8)).toBe("12.26635514");
  });

  it("lote parcial con saldo a favor: proporciones del pago", () => {
    const { asientos, saldoFavorUsdt } = asientosConversionLote({
      ars: "50000",
      usdt: "40",
      porPrestamo: [{ prestamoId: "A", ars: "75000" }],
      saldoFavorArs: "25000",
      clienteId: "C",
      cartera: new Map([["A", "1000"]]),
      participaciones: new Map(),
    });
    expect(saldoFavorUsdt.toFixed(2)).toBe("10.00");
    expect(asientos.slice(3).map((a) => [a.cuenta, a.monto.toFixed(2)])).toEqual([
      ["cartera", "-30.00"],
      ["saldo_favor", "-10.00"],
    ]);
    expect(suma(asientos, "USDT").isZero()).toBe(true);
  });
});
