import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { calcularPlan, mesesDelPlazo, proyectarUsdt, tasaTotalSugerida } from "./cronograma";

const suma = (xs: Decimal[]) => xs.reduce((a, b) => a.plus(b), new Decimal(0));

describe("tasaTotalSugerida", () => {
  it("mensual × meses, con meses = días / 30", () => {
    expect(tasaTotalSugerida("12", "quincena", 6).toFixed(4)).toBe("36.0000");
    expect(tasaTotalSugerida("10", "mes", 4).toFixed(4)).toBe("40.0000");
    expect(tasaTotalSugerida("10", "semana", 4).toFixed(4)).toBe("9.3333");
    expect(tasaTotalSugerida("15", "dia", 20).toFixed(4)).toBe("10.0000");
  });

  it("mensual usa la cantidad de cuotas exacta, no días / 30", () => {
    expect(mesesDelPlazo("mes", 3).toString()).toBe("3");
  });
});

describe("calcularPlan", () => {
  it("ejemplo de la spec: 100.000 ARS a TC 1.600 = 62,50 USDT", () => {
    const plan = calcularPlan({
      arsCapital: "100000",
      tcEntrada: "1600",
      tasaTotalPct: "20",
      fechaDesembolso: "2026-10-01",
      frecuencia: "mes",
      nCuotas: 1,
    });
    expect(plan.usdtPrestado.toFixed(8)).toBe("62.50000000");
    expect(plan.arsInteresPactado.toFixed(2)).toBe("20000.00");
    expect(plan.arsTotal.toFixed(2)).toBe("120000.00");
    expect(plan.vencimientoFinal).toBe("2026-11-01");
  });

  it("redondea igual que los CHECK de la base", () => {
    const plan = calcularPlan({
      arsCapital: "3500000",
      tcEntrada: "1285",
      tasaTotalPct: "36",
      fechaDesembolso: "2026-10-03",
      frecuencia: "quincena",
      nCuotas: 6,
    });
    // 3.500.000 / 1.285 = 2723,735408560311...
    expect(plan.usdtPrestado.toFixed(8)).toBe("2723.73540856");
    expect(plan.arsInteresPactado.toFixed(2)).toBe("1260000.00");
  });

  it("cuotas iguales con la diferencia de redondeo en la última", () => {
    const plan = calcularPlan({
      arsCapital: "3500000",
      tcEntrada: "1285",
      tasaTotalPct: "36",
      fechaDesembolso: "2026-10-03",
      frecuencia: "quincena",
      nCuotas: 6,
    });
    const capitales = plan.cuotas.map((c) => c.arsCapital.toFixed(2));
    expect(capitales).toEqual([
      "583333.33", "583333.33", "583333.33", "583333.33", "583333.33", "583333.35",
    ]);
    expect(plan.cuotas.every((c) => c.arsInteres.toFixed(2) === "210000.00")).toBe(true);
    expect(suma(plan.cuotas.map((c) => c.arsCapital)).toFixed(2)).toBe("3500000.00");
    expect(suma(plan.cuotas.map((c) => c.arsInteres)).toFixed(2)).toBe("1260000.00");
    expect(plan.cuotas.map((c) => c.vencimiento)).toEqual([
      "2026-10-18", "2026-11-02", "2026-11-17", "2026-12-02", "2026-12-17", "2027-01-01",
    ]);
    expect(plan.vencimientoFinal).toBe("2027-01-01");
  });

  it("la última cuota puede quedar por debajo si el redondeo sube", () => {
    const plan = calcularPlan({
      arsCapital: "100",
      tcEntrada: "1",
      tasaTotalPct: "0",
      fechaDesembolso: "2026-10-01",
      frecuencia: "dia",
      nCuotas: 6,
    });
    // 100 / 6 = 16,666… → 16,67 × 5 = 83,35 → última 16,65
    expect(plan.cuotas.map((c) => c.arsCapital.toFixed(2))).toEqual([
      "16.67", "16.67", "16.67", "16.67", "16.67", "16.65",
    ]);
    expect(plan.arsInteresPactado.toFixed(2)).toBe("0.00");
  });

  it("valida los ingredientes", () => {
    const base = {
      arsCapital: "1000",
      tcEntrada: "1000",
      tasaTotalPct: "10",
      fechaDesembolso: "2026-10-01",
      frecuencia: "mes" as const,
      nCuotas: 1,
    };
    expect(() => calcularPlan({ ...base, arsCapital: "0" })).toThrow();
    expect(() => calcularPlan({ ...base, tcEntrada: "-1" })).toThrow();
    expect(() => calcularPlan({ ...base, tasaTotalPct: "-1" })).toThrow();
    expect(() => calcularPlan({ ...base, nCuotas: 0 })).toThrow();
    expect(() => calcularPlan({ ...base, nCuotas: 1.5 })).toThrow();
  });
});

describe("proyectarUsdt", () => {
  it("ejemplo del diseño: 3.500.000 ARS a 1.285, 36% en 6 quincenas", () => {
    const plan = calcularPlan({
      arsCapital: "3500000",
      tcEntrada: "1285",
      tasaTotalPct: "36",
      fechaDesembolso: "2026-10-03",
      frecuencia: "quincena",
      nCuotas: 6,
    });
    const proy = proyectarUsdt(plan, "1285", "12");
    // 4.760.000 / 1.285 = 3.704,2801556…
    expect(proy.totalUsdt.toFixed(2)).toBe("3704.28");
    // 1.260.000 / 1.285 = 980,5447470…
    expect(proy.gananciaUsdt.toFixed(2)).toBe("980.54");
    expect(proy.tnaPct.toFixed(2)).toBe("144.00");
    // 793.333,33 / 1.285 = 617,3800…
    expect(proy.cuotas[0]!.totalArs.toFixed(2)).toBe("793333.33");
    expect(proy.cuotas[0]!.totalUsdt.toFixed(2)).toBe("617.38");
  });
});
