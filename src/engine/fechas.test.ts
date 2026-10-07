import { describe, expect, it } from "vitest";
import { diasEntre, sumarMeses, vencimientoPeriodo } from "./fechas";

describe("vencimientoPeriodo", () => {
  it("suma 1, 7 y 15 días por período", () => {
    expect(vencimientoPeriodo("2026-10-03", "dia", 3)).toBe("2026-10-06");
    expect(vencimientoPeriodo("2026-10-03", "semana", 2)).toBe("2026-10-17");
    expect(vencimientoPeriodo("2026-10-03", "quincena", 1)).toBe("2026-10-18");
    expect(vencimientoPeriodo("2026-12-20", "quincena", 1)).toBe("2027-01-04");
  });

  it("mensual: mismo día del mes", () => {
    expect(vencimientoPeriodo("2026-10-15", "mes", 1)).toBe("2026-11-15");
    expect(vencimientoPeriodo("2026-10-15", "mes", 3)).toBe("2027-01-15");
  });

  it("mensual: si el día no existe, último día del mes, sin arrastrar el ajuste", () => {
    expect(vencimientoPeriodo("2026-01-31", "mes", 1)).toBe("2026-02-28");
    expect(vencimientoPeriodo("2026-01-31", "mes", 2)).toBe("2026-03-31");
    expect(vencimientoPeriodo("2026-01-31", "mes", 3)).toBe("2026-04-30");
    expect(sumarMeses("2028-01-30", 1)).toBe("2028-02-29");
  });

  it("rechaza fechas inválidas", () => {
    expect(() => vencimientoPeriodo("2026-02-30", "dia", 1)).toThrow();
    expect(() => vencimientoPeriodo("03/10/2026", "dia", 1)).toThrow();
  });
});

describe("diasEntre", () => {
  it("cuenta días corridos con signo", () => {
    expect(diasEntre("2026-10-01", "2026-10-13")).toBe(12);
    expect(diasEntre("2026-10-13", "2026-10-01")).toBe(-12);
    expect(diasEntre("2026-12-31", "2027-03-01")).toBe(60);
  });
});
