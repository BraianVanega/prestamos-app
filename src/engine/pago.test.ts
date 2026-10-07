import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  asientosCobroEfectivo,
  asientosIngresoUsdt,
  deudasAFecha,
  distribuirFifo,
  ErrorImputacion,
  imputarPago,
  type CuotaParaCobro,
  type PrestamoParaCobro,
} from "./pago";

const cuota = (id: string, numero: number, vencimiento: string, extra: Partial<CuotaParaCobro> = {}): CuotaParaCobro => ({
  id,
  numero,
  vencimiento,
  arsCapital: "1000",
  arsInteres: "200",
  pagadoCapital: "0",
  pagadoInteres: "0",
  pagadoCargos: "0",
  pagosCapital: [],
  cargos: "0",
  tieneMora: false,
  ...extra,
});

const prestamo = (id: string, numero: number, cuotas: CuotaParaCobro[], extra: Partial<PrestamoParaCobro> = {}): PrestamoParaCobro => ({
  id,
  numero,
  nCuotas: cuotas.length,
  moraPct: "20",
  diasGracia: 5,
  cuotas,
  cargosSinCuota: null,
  ...extra,
});

const fx = (d: Decimal) => d.toFixed(2);

describe("deudasAFecha", () => {
  it("ordena por vencimiento entre préstamos y suma la mora que nace", () => {
    const { deudas, moraNueva } = deudasAFecha(
      [
        prestamo("B", 20, [cuota("b1", 1, "2026-10-01"), cuota("b2", 2, "2026-11-01")]),
        prestamo("A", 19, [cuota("a1", 1, "2026-10-05")]),
      ],
      "2026-10-08",
    );
    expect(deudas.map((d) => d.clave)).toEqual(["B:b1", "A:a1", "B:b2"]);
    // b1 venció el 01/10, gracia 5 → mora desde el 07/10: 20% de 1000
    expect(moraNueva.map((m) => [m.cuotaId, fx(m.ars)])).toEqual([["b1", "200.00"]]);
    expect([deudas[0]!.mora, deudas[0]!.total].map(fx)).toEqual(["200.00", "1400.00"]);
    expect(fx(deudas[1]!.mora)).toBe("0.00");
  });

  it("descuenta lo pagado y omite cuotas saldadas", () => {
    const { deudas } = deudasAFecha(
      [
        prestamo("A", 1, [
          cuota("a1", 1, "2026-10-01", { pagadoCapital: "1000", pagadoInteres: "200", pagosCapital: [{ fecha: "2026-10-01", ars: "1000" }] }),
          cuota("a2", 2, "2026-11-01", { pagadoInteres: "50" }),
        ]),
      ],
      "2026-10-20",
    );
    expect(deudas.map((d) => [d.clave, fx(d.interes), fx(d.capital)])).toEqual([["A:a2", "150.00", "1000.00"]]);
  });

  it("mora ya cargada: no se vuelve a sumar, pero sí lo que falta pagar de ella", () => {
    const { deudas, moraNueva } = deudasAFecha(
      [prestamo("A", 1, [cuota("a1", 1, "2026-10-01", { cargos: "200", pagadoCargos: "50", tieneMora: true })])],
      "2026-10-20",
    );
    expect(moraNueva).toEqual([]);
    expect(fx(deudas[0]!.mora)).toBe("150.00");
  });

  it("cargos sin cuota van como fila propia", () => {
    const { deudas } = deudasAFecha(
      [prestamo("A", 1, [cuota("a1", 1, "2026-12-01")], { cargosSinCuota: { fecha: "2026-10-02", neto: "300", pagado: "100" } })],
      "2026-10-20",
    );
    expect(deudas.map((d) => [d.clave, fx(d.total)])).toEqual([
      ["A:cargos", "200.00"],
      ["A:a1", "1200.00"],
    ]);
  });
});

describe("distribuirFifo + imputarPago", () => {
  const { deudas } = deudasAFecha(
    [prestamo("A", 1, [cuota("a1", 1, "2026-10-01"), cuota("a2", 2, "2026-11-01")])],
    "2026-10-08",
  );
  // a1: mora 200 + interés 200 + capital 1000 = 1400; a2: 1200

  it("cascada: mora → interés → capital, cuota por cuota", () => {
    const montos = distribuirFifo("1700", deudas);
    expect([...montos.values()].map(fx)).toEqual(["1400.00", "300.00"]);
    const imp = imputarPago("1700", deudas, montos);
    expect(imp.lineas.map((l) => [l.cuotaId, l.concepto, fx(l.ars)])).toEqual([
      ["a1", "mora", "200.00"],
      ["a1", "interes", "200.00"],
      ["a1", "capital", "1000.00"],
      ["a2", "interes", "200.00"],
      ["a2", "capital", "100.00"],
    ]);
    expect(fx(imp.saldoFavor)).toBe("0.00");
    expect(imp.cancelados).toEqual([]);
  });

  it("lo que sobra queda como saldo a favor y el préstamo se cancela", () => {
    const imp = imputarPago("3000", deudas, distribuirFifo("3000", deudas));
    expect(fx(imp.saldoFavor)).toBe("400.00");
    expect(imp.lineas.at(-1)).toMatchObject({ concepto: "saldo_favor", prestamoId: null });
    expect(imp.cancelados).toEqual(["A"]);
    expect(imp.porPrestamo.map((p) => fx(p.ars))).toEqual(["2600.00"]);
  });

  it("montos elegidos a mano (saltear una cuota)", () => {
    const imp = imputarPago("500", deudas, new Map([["A:a2", "500"]]));
    expect(imp.lineas.map((l) => [l.cuotaId, l.concepto, fx(l.ars)])).toEqual([
      ["a2", "interes", "200.00"],
      ["a2", "capital", "300.00"],
    ]);
  });

  it("valida montos", () => {
    expect(() => imputarPago("100", deudas, new Map([["A:a1", "200"]]))).toThrow(ErrorImputacion);
    expect(() => imputarPago("5000", deudas, new Map([["A:a1", "1500"]]))).toThrow(/supera/);
    expect(() => imputarPago("100", deudas, new Map([["A:zz", "50"]]))).toThrow(/cambió/);
    expect(() => imputarPago("100", deudas, new Map([["A:a1", "-1"]]))).toThrow(/negativo/);
    expect(() => imputarPago("100", deudas, new Map([["A:a1", "1.005"]]))).toThrow(/decimales/);
    expect(() => imputarPago("0", deudas, new Map())).toThrow();
  });
});

describe("asientosIngresoUsdt", () => {
  const participaciones = new Map([["P", [{ participanteId: "soc", pctGanancia: "100" }]]]);
  const suma = (as: { moneda: string; monto: Decimal }[]) => as.reduce((s, a) => s.plus(a.monto), new Decimal(0));

  it("ejemplo de la spec: 100.000 a 1.600, devuelve 120.000 a 1.605", () => {
    const r = asientosIngresoUsdt({
      tc: "1605",
      porPrestamo: [{ prestamoId: "P", ars: "120000" }],
      saldoFavorArs: "0",
      clienteId: "C",
      cartera: new Map([["P", "62.5"]]),
      participaciones,
    });
    expect(r.usdtTotal.toFixed(8)).toBe("74.76635514");
    expect(r.prestamos[0]!.recupero.toFixed(8)).toBe("62.50000000");
    expect(r.prestamos[0]!.ganancia.toFixed(2)).toBe("12.27");
    expect(r.asientos.map((a) => [a.cuenta, a.monto.toFixed(8)])).toEqual([
      ["caja_usdt", "74.76635514"],
      ["cartera", "-62.50000000"],
      ["ganancia", "-12.26635514"],
    ]);
    expect(suma(r.asientos).isZero()).toBe(true);
  });

  it("antes de recuperar el costo todo baja cartera", () => {
    const r = asientosIngresoUsdt({
      tc: "1000",
      porPrestamo: [{ prestamoId: "P", ars: "30000" }],
      saldoFavorArs: "0",
      clienteId: "C",
      cartera: new Map([["P", "62.5"]]),
      participaciones,
    });
    expect(r.asientos.map((a) => a.cuenta)).toEqual(["caja_usdt", "cartera"]);
    expect(r.prestamos[0]!.ganancia.isZero()).toBe(true);
  });

  it("varios préstamos + saldo a favor: suma exacta y ganancia repartida", () => {
    const r = asientosIngresoUsdt({
      tc: "3",
      porPrestamo: [
        { prestamoId: "P", ars: "100" },
        { prestamoId: "Q", ars: "100" },
      ],
      saldoFavorArs: "100",
      clienteId: "C",
      cartera: new Map([["P", "0"], ["Q", "10"]]),
      participaciones: new Map([
        ["P", [{ participanteId: "s1", pctGanancia: "50" }, { participanteId: "s2", pctGanancia: "50" }]],
        ["Q", [{ participanteId: "soc", pctGanancia: "100" }]],
      ]),
    });
    expect(r.usdtTotal.toFixed(8)).toBe("100.00000000");
    expect(r.saldoFavorUsdt.toFixed(8)).toBe("33.33333334");
    expect(r.asientos.map((a) => [a.cuenta, a.participanteId ?? a.prestamoId ?? a.clienteId ?? "", a.monto.toFixed(8)])).toEqual([
      ["caja_usdt", "", "100.00000000"],
      ["ganancia", "s1", "-16.66666667"],
      ["ganancia", "s2", "-16.66666666"],
      ["cartera", "Q", "-10.00000000"],
      ["ganancia", "soc", "-23.33333333"],
      ["saldo_favor", "C", "-33.33333334"],
    ]);
    expect(suma(r.asientos).isZero()).toBe(true);
  });
});

describe("asientosCobroEfectivo", () => {
  it("entra a la caja de efectivo contra el puente, en ARS", () => {
    expect(asientosCobroEfectivo("5000").map((a) => [a.cuenta, a.moneda, a.monto.toFixed(2)])).toEqual([
      ["caja_efectivo_ars", "ARS", "5000.00"],
      ["puente_cambio", "ARS", "-5000.00"],
    ]);
  });
});
