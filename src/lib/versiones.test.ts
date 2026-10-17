import { describe, expect, it } from "vitest";
import { diferenciasPrestamo, type CamposVersion } from "./versiones";

const base: CamposVersion = {
  cliente: "Natalia Valdez",
  fechaDesembolso: "2026-09-22",
  arsCapital: "300000",
  tcEntrada: "1598",
  frecuencia: "semana",
  nCuotas: 4,
  tasaTotalPct: "40",
  moraPct: "0",
  diasGracia: 0,
  estructura: "Sociedad 100%",
  notas: null,
};

describe("diferenciasPrestamo", () => {
  it("sin cambios no hay diferencias", () => {
    expect(diferenciasPrestamo(base, { ...base })).toEqual([]);
  });

  it("muestra antes y ahora formateados, en el orden del formulario", () => {
    expect(diferenciasPrestamo(base, { ...base, tasaTotalPct: "50", arsCapital: "350000" })).toEqual([
      { campo: "Capital", antes: "$300.000,00", ahora: "$350.000,00" },
      { campo: "Tasa total", antes: "40,00%", ahora: "50,00%" },
    ]);
  });

  it("compara montos por valor, no por texto", () => {
    expect(diferenciasPrestamo(base, { ...base, arsCapital: "300000.00", tcEntrada: "1598.000000" })).toEqual([]);
  });

  it("cuotas en singular y plural; recargo en palabras", () => {
    expect(diferenciasPrestamo(base, { ...base, nCuotas: 1, frecuencia: "mes", moraPct: "5", diasGracia: 3 })).toEqual([
      { campo: "Cuotas", antes: "4 semanales", ahora: "1 mensual" },
      { campo: "Recargo por atraso", antes: "Sin recargo", ahora: "5,00% · 3 días de gracia" },
    ]);
  });

  it("notas vacías cuentan como sin notas", () => {
    expect(diferenciasPrestamo(base, { ...base, notas: "  " })).toEqual([]);
    expect(diferenciasPrestamo(base, { ...base, notas: "Paga los viernes" })).toEqual([
      { campo: "Notas", antes: "—", ahora: "Paga los viernes" },
    ]);
  });
});
