import { describe, expect, it } from "vitest";
import { estadoCuotas, nivelRiesgo, recuperadoUsdt, type CuotaConPagos } from "./estado-prestamo";

const cuota = (numero: number, vencimiento: string, pagado: [string, string] = ["0", "0"]): CuotaConPagos => ({
  id: `c${numero}`,
  numero,
  vencimiento,
  arsCapital: "1000",
  arsInteres: "200",
  pagadoCapital: pagado[0],
  pagadoInteres: pagado[1],
});

describe("estadoCuotas", () => {
  it("sin pagos y sin vencer: al día, próxima = la primera", () => {
    const e = estadoCuotas([cuota(1, "2026-11-01"), cuota(2, "2026-12-01")], "2026-10-15");
    expect(e.proxima?.numero).toBe(1);
    expect(e.diasAtraso).toBe(0);
    expect(e.cuotasPagadas).toBe(0);
    expect(e.saldoArs.toFixed(2)).toBe("2400.00");
  });

  it("el día del vencimiento todavía no hay atraso", () => {
    expect(estadoCuotas([cuota(1, "2026-11-01")], "2026-11-01").diasAtraso).toBe(0);
    expect(estadoCuotas([cuota(1, "2026-11-01")], "2026-11-02").diasAtraso).toBe(1);
  });

  it("el atraso es el de la cuota impaga más vieja", () => {
    const e = estadoCuotas([cuota(1, "2026-10-01"), cuota(2, "2026-10-16"), cuota(3, "2026-11-01")], "2026-10-20");
    expect(e.diasAtraso).toBe(19);
    expect(e.proxima?.numero).toBe(1);
    expect(e.cuotas.map((c) => c.diasAtraso)).toEqual([19, 4, 0]);
  });

  it("pagos parciales y totales", () => {
    const e = estadoCuotas(
      [cuota(1, "2026-10-01", ["1000", "200"]), cuota(2, "2026-10-16", ["400", "200"]), cuota(3, "2026-11-01")],
      "2026-10-20",
    );
    expect(e.cuotasPagadas).toBe(1);
    expect(e.proxima?.numero).toBe(2);
    expect(e.proxima?.saldoCapital.toFixed(2)).toBe("600.00");
    expect(e.proxima?.saldoInteres.toFixed(2)).toBe("0.00");
    expect(e.diasAtraso).toBe(4);
    expect(e.saldoArs.toFixed(2)).toBe("1800.00");
  });

  it("todo pagado: sin próxima ni atraso, aunque esté vencido", () => {
    const e = estadoCuotas([cuota(2, "2026-10-16", ["1000", "200"]), cuota(1, "2026-10-01", ["1000", "200"])], "2027-01-01");
    expect(e.proxima).toBeNull();
    expect(e.diasAtraso).toBe(0);
    expect(e.cuotasPagadas).toBe(2);
    expect(e.cuotas.map((c) => c.numero)).toEqual([1, 2]);
  });

  it("un sobrepago no deja saldos negativos", () => {
    const e = estadoCuotas([cuota(1, "2026-10-01", ["1500", "300"])], "2026-10-20");
    expect(e.saldoArs.toFixed(2)).toBe("0.00");
  });
});

describe("nivelRiesgo", () => {
  it("bandas de la leyenda", () => {
    expect([0, 3, 4, 10, 11, 20, 21, 45, 46, 400].map(nivelRiesgo)).toEqual([
      "verde", "verde", "amarillo", "amarillo", "naranja", "naranja", "rojo", "rojo", "negro", "negro",
    ]);
  });
});

describe("recuperadoUsdt", () => {
  it("sin cobros: 0", () => {
    expect(recuperadoUsdt({ usdtPrestado: "800", saldoCartera: "800", gananciaAsientos: "0" }).toFixed(2)).toBe("0.00");
  });

  it("costo recuperado parcial", () => {
    expect(recuperadoUsdt({ usdtPrestado: "800", saldoCartera: "300", gananciaAsientos: "0" }).toFixed(2)).toBe("500.00");
  });

  it("costo recuperado completo más ganancia reconocida (crédito)", () => {
    expect(recuperadoUsdt({ usdtPrestado: "800", saldoCartera: "0", gananciaAsientos: "-95.5" }).toFixed(2)).toBe("895.50");
  });
});
