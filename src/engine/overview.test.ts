import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { CuotaEstado } from "./estado-prestamo";
import { gananciaPorMes, rankingAtraso, ultimosMeses, vencimientosProximos } from "./overview";

const cuota = (numero: number, vencimiento: string, saldo: string, extra: Partial<CuotaEstado> = {}): CuotaEstado => ({
  id: `C${numero}`,
  numero,
  vencimiento,
  saldoCapital: new Decimal(saldo),
  saldoInteres: new Decimal(0),
  saldo: new Decimal(saldo),
  pagada: saldo === "0",
  situacion: saldo === "0" ? "pagada" : "pendiente",
  diasAtraso: 0,
  ...extra,
});

describe("ultimosMeses", () => {
  it("cruza el año y termina en el mes actual", () => {
    expect(ultimosMeses("2026-02-28", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(ultimosMeses("2026-10-31", 1)).toEqual(["2026-10"]);
  });
});

describe("vencimientosProximos", () => {
  it("solo impagas de vigentes entre hoy y hoy + días, la más próxima primero", () => {
    const v = vencimientosProximos(
      [
        { id: "A", estado: "vigente", cuotas: [cuota(1, "2026-10-06", "100"), cuota(2, "2026-10-09", "100"), cuota(3, "2026-10-15", "100")] },
        { id: "B", estado: "vigente", cuotas: [cuota(1, "2026-10-07", "50"), cuota(2, "2026-10-08", "0")] },
        { id: "C", estado: "cancelado", cuotas: [cuota(1, "2026-10-07", "10")] },
      ],
      "2026-10-07",
      7,
    );
    expect(v.map((x) => [x.prestamoId, x.cuota.numero, x.enDias])).toEqual([
      ["B", 1, 0],
      ["A", 2, 2],
    ]);
  });
});

describe("rankingAtraso", () => {
  it("ordena por riesgo y después por días, con lo vencido", () => {
    const vencida = (n: number, saldo: string) => cuota(n, "2026-09-01", saldo, { situacion: "vencida", diasAtraso: 30 });
    const r = rankingAtraso([
      { id: "A", estado: "vigente", riesgo: "amarillo", diasAtraso: 20, cuotas: [vencida(1, "100"), cuota(2, "2026-11-01", "100")] },
      { id: "B", estado: "vigente", riesgo: "rojo", diasAtraso: 5, cuotas: [vencida(1, "300"), vencida(2, "200")] },
      { id: "C", estado: "vigente", riesgo: "amarillo", diasAtraso: 25, cuotas: [vencida(1, "1")] },
      { id: "D", estado: "vigente", riesgo: "verde", diasAtraso: 0, cuotas: [] },
    ]);
    expect(r.map((x) => [x.id, x.vencidoArs.toFixed(2), x.cuotasVencidas])).toEqual([
      ["B", "500.00", 2],
      ["C", "1.00", 1],
      ["A", "100.00", 1],
    ]);
  });
});

describe("gananciaPorMes", () => {
  it("abre la Sociedad por % y descuenta anulaciones en su mes", () => {
    const socios = [
      { id: "S1", pct: "50" },
      { id: "S2", pct: "50" },
    ];
    const r = gananciaPorMes(
      [
        { fecha: "2026-09-10", participanteId: "SOC", esSociedad: true, monto: "-10.00000001" },
        { fecha: "2026-09-20", participanteId: "S1", esSociedad: false, monto: "-4" },
        { fecha: "2026-10-02", participanteId: "SOC", esSociedad: true, monto: "-6" },
        { fecha: "2026-10-05", participanteId: "SOC", esSociedad: true, monto: "6" }, // anulación
      ],
      ["2026-08", "2026-09", "2026-10"],
      socios,
      8,
    );
    expect(r.map((m) => [m.mes, m.porSocio.map((x) => x.monto.toFixed(8)), m.total.toFixed(8)])).toEqual([
      ["2026-08", ["0.00000000", "0.00000000"], "0.00000000"],
      ["2026-09", ["9.00000001", "5.00000000"], "14.00000001"],
      ["2026-10", ["0.00000000", "0.00000000"], "0.00000000"],
    ]);
  });
});
