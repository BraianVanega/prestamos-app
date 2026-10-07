import { describe, expect, it } from "vitest";
import { hoyArgentina } from "./hoy";
import { esquemaPrestamo, numeroPrestamo } from "./prestamos";

const base = {
  clienteId: "434c0458-247d-4466-bc19-c15202a09fa1",
  fechaDesembolso: "2026-10-03",
  arsCapital: "3.500.000",
  tcEntrada: "1285,00",
  tasaMensualPct: "12",
  frecuencia: "quincena",
  nCuotas: "6",
  tasaTotalPct: "36",
  moraPct: "20",
  diasGracia: "5",
  notas: "  ",
};

const errores = (cambios: Partial<typeof base>) => {
  const r = esquemaPrestamo.safeParse({ ...base, ...cambios });
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path[0], i.message]));
};

describe("esquemaPrestamo", () => {
  it("lee los números en formato es-AR como Decimal", () => {
    const d = esquemaPrestamo.parse(base);
    expect(d.arsCapital.toFixed(2)).toBe("3500000.00");
    expect(d.tcEntrada.toFixed(6)).toBe("1285.000000");
    expect(d.nCuotas).toBe(6);
    expect(d.notas).toBeNull();
  });

  it("valida los límites de la base", () => {
    expect(errores({ arsCapital: "0" })).toHaveProperty("arsCapital");
    expect(errores({ arsCapital: "1.000,123" }).arsCapital).toMatch(/2 decimales/);
    expect(errores({ tcEntrada: "abc" }).tcEntrada).toMatch(/TC de entrada/);
    expect(errores({ tasaMensualPct: "-1" })).toHaveProperty("tasaMensualPct");
    expect(errores({ tasaTotalPct: "100000" }).tasaTotalPct).toMatch(/demasiado grande/);
    expect(errores({ nCuotas: "0" })).toHaveProperty("nCuotas");
    expect(errores({ nCuotas: "2,5" })).toHaveProperty("nCuotas");
    expect(errores({ fechaDesembolso: "2026-02-30" })).toHaveProperty("fechaDesembolso");
    expect(errores({ clienteId: "" }).clienteId).toBe("Elegí un cliente.");
  });

  it("mora y gracia pueden ser 0", () => {
    expect(errores({ moraPct: "0", diasGracia: "0" })).toEqual({});
  });
});

describe("numeroPrestamo / hoyArgentina", () => {
  it("formatea el número visible", () => {
    expect(numeroPrestamo(7)).toBe("#PR-0007");
    expect(numeroPrestamo(1082)).toBe("#PR-1082");
  });

  it("usa la hora de Buenos Aires (UTC−3)", () => {
    expect(hoyArgentina(new Date("2026-10-08T02:30:00Z"))).toBe("2026-10-07");
    expect(hoyArgentina(new Date("2026-10-08T03:30:00Z"))).toBe("2026-10-08");
  });
});
