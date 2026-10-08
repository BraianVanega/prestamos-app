import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { alcanceCorreccion, descuentosReplay, montosReplay, morasPerdonadasReplay, motivoDescuentoBase, type OperacionCobro } from "./correccion";
import type { Deuda } from "./pago";

const deuda = (prestamoId: string, cuotaNumero: number, vencimiento: string, montos: { mora?: string; interes?: string; capital?: string } = {}): Deuda => {
  const mora = new Decimal(montos.mora ?? 0);
  const interes = new Decimal(montos.interes ?? "200");
  const capital = new Decimal(montos.capital ?? "1000");
  return {
    clave: `${prestamoId}:c${cuotaNumero}`,
    prestamoId,
    prestamoNumero: prestamoId === "OTRO" ? 1 : 2,
    nCuotas: 2,
    cuotaId: `c${cuotaNumero}`,
    cuotaNumero,
    vencimiento,
    mora,
    interes,
    capital,
    total: mora.plus(interes).plus(capital),
  };
};

const texto = (m: Map<string, Decimal>) => Object.fromEntries([...m].map(([k, v]) => [k, v.toFixed(2)]));

describe("alcanceCorreccion", () => {
  const op = (instante: string, pagoNuevoId: string | null, pagos: string[], prestamos: string[]): OperacionCobro => ({
    instante,
    pagoNuevoId,
    pagos,
    prestamos,
  });
  const pagos = [
    { id: "p1", instante: "1" },
    { id: "p2", instante: "2" },
    { id: "p3", instante: "3" },
  ];

  it("sin cobros sobre el préstamo no hay nada que rebobinar", () => {
    const r = alcanceCorreccion({ prestamoId: "L", operaciones: [op("1", "p1", ["p1"], ["OTRO"])], pagos, conversiones: [] });
    expect(r).toEqual({ desde: null, operaciones: [], pagos: [], conversiones: [] });
  });

  it("toma todo lo del cliente desde el primer cobro al préstamo, aunque vaya a otros préstamos", () => {
    const r = alcanceCorreccion({
      prestamoId: "L",
      operaciones: [op("1", "p1", ["p1"], ["OTRO"]), op("2", "p2", ["p2"], ["L"]), op("3", "p3", ["p3"], ["OTRO"])],
      pagos,
      conversiones: [
        { id: "conv-viejo", instante: "1.5", pagos: ["p1"] },
        { id: "conv", instante: "4", pagos: ["p3", "ajeno"] },
      ],
    });
    expect(r.desde).toBe("2");
    expect(r.operaciones.map((o) => o.instante)).toEqual(["2", "3"]);
    expect(r.pagos).toEqual(["p2", "p3"]);
    expect(r.conversiones.map((c) => c.id)).toEqual(["conv"]);
  });

  it("se extiende hasta el pago de origen de un saldo a favor aplicado al préstamo", () => {
    const r = alcanceCorreccion({
      prestamoId: "L",
      operaciones: [op("1", "p1", ["p1"], ["OTRO"]), op("3", null, ["p1"], ["L"])],
      pagos,
      conversiones: [],
    });
    expect(r.desde).toBe("1");
    expect(r.pagos).toEqual(["p1", "p2", "p3"]);
  });
});

describe("montosReplay", () => {
  it("repite lo de los otros préstamos y reparte FIFO lo del corregido", () => {
    const deudas = [deuda("OTRO", 1, "2026-01-10"), deuda("NUEVO", 1, "2026-01-15"), deuda("NUEVO", 2, "2026-02-15")];
    const montos = montosReplay({
      deudas,
      originales: new Map([
        ["OTRO:c1", "500"],
        ["VIEJO:x1", "1000"],
        ["VIEJO:x2", "800"],
      ]),
      viejoId: "VIEJO",
      nuevoId: "NUEVO",
      disponible: "5000",
    });
    expect(texto(montos)).toEqual({ "OTRO:c1": "500.00", "NUEVO:c1": "1200.00", "NUEVO:c2": "600.00" });
  });

  it("si el corregido debe menos, lo que no entra no se imputa (queda como saldo a favor)", () => {
    const montos = montosReplay({
      deudas: [deuda("NUEVO", 1, "2026-01-15", { capital: "500", interes: "50" })],
      originales: new Map([["VIEJO:x1", "1200"]]),
      viejoId: "VIEJO",
      nuevoId: "NUEVO",
      disponible: "1200",
    });
    expect(texto(montos)).toEqual({ "NUEVO:c1": "550.00" });
  });

  it("no supera lo disponible, en el orden de la cascada", () => {
    const montos = montosReplay({
      deudas: [deuda("OTRO", 1, "2026-01-10"), deuda("NUEVO", 1, "2026-01-15")],
      originales: new Map([
        ["OTRO:c1", "1200"],
        ["VIEJO:x1", "1200"],
      ]),
      viejoId: "VIEJO",
      nuevoId: "NUEVO",
      disponible: "1500",
    });
    expect(texto(montos)).toEqual({ "OTRO:c1": "1200.00", "NUEVO:c1": "300.00" });
  });

  it("a otro préstamo nunca más de lo que debe ahora", () => {
    const montos = montosReplay({
      deudas: [deuda("OTRO", 1, "2026-01-10", { capital: "100", interes: "0" })],
      originales: new Map([["OTRO:c1", "500"]]),
      viejoId: "VIEJO",
      nuevoId: "NUEVO",
      disponible: "500",
    });
    expect(texto(montos)).toEqual({ "OTRO:c1": "100.00" });
  });
});

describe("descuentosReplay", () => {
  it("pasa los descuentos del préstamo corregido a la cuota del mismo número, con tope", () => {
    const deudas = [
      deuda("NUEVO", 1, "2026-01-15", { mora: "50", interes: "100" }),
      deuda("NUEVO", 2, "2026-02-15"),
      deuda("OTRO", 1, "2026-01-10"),
    ];
    const r = descuentosReplay({
      deudas,
      originales: [
        { prestamoId: "VIEJO", cuotaNumero: 1, ars: "120" },
        { prestamoId: "VIEJO", cuotaNumero: 1, ars: "80" },
        { prestamoId: "VIEJO", cuotaNumero: 3, ars: "10" },
        { prestamoId: "VIEJO", cuotaNumero: null, ars: "10" },
        { prestamoId: "OTRO", cuotaNumero: 1, ars: "30" },
      ],
      viejoId: "VIEJO",
      nuevoId: "NUEVO",
    });
    expect(texto(r)).toEqual({ "NUEVO:c1": "150.00" });
  });
});

describe("motivoDescuentoBase", () => {
  it("saca la referencia a la cuota o a los cargos", () => {
    expect(motivoDescuentoBase("Pronto pago (cuota 3)")).toBe("Pronto pago");
    expect(motivoDescuentoBase("Acuerdo (cargos)")).toBe("Acuerdo");
    expect(motivoDescuentoBase("Sin referencia")).toBe("Sin referencia");
  });
});

describe("morasPerdonadasReplay", () => {
  it("pasa cada mora perdonada a la cuota del mismo número (una por cuota, si existe)", () => {
    const r = morasPerdonadasReplay(
      [
        { cuotaNumero: 2, fecha: "2026-02-07", ars: "100" },
        { cuotaNumero: 2, fecha: "2026-02-10", ars: "50" },
        { cuotaNumero: 5, fecha: "2026-05-07", ars: "100" },
      ],
      [
        { id: "n1", numero: 1 },
        { id: "n2", numero: 2 },
      ],
    );
    expect(r).toEqual([{ cuotaNumero: 2, fecha: "2026-02-07", ars: "100", cuotaId: "n2" }]);
  });
});
