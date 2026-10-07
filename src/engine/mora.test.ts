import { describe, expect, it } from "vitest";
import { inicioMora, moraACargar, type CuotaParaMora } from "./mora";

const cuota = (extra: Partial<CuotaParaMora> = {}): CuotaParaMora => ({
  cuotaId: "c1",
  vencimiento: "2026-10-10",
  arsCapital: "100000",
  pagosCapital: [],
  tieneMora: false,
  ...extra,
});

const calcular = (fecha: string, cuotas: CuotaParaMora[], moraPct = "20", diasGracia = 5) =>
  moraACargar({ fecha, moraPct, diasGracia, cuotas });

describe("inicioMora", () => {
  it("es el día siguiente al último de gracia", () => {
    expect(inicioMora("2026-10-10", 5)).toBe("2026-10-16");
    expect(inicioMora("2026-10-10", 0)).toBe("2026-10-11");
  });
});

describe("moraACargar", () => {
  it("dentro de la gracia no hay mora", () => {
    expect(calcular("2026-10-10", [cuota()])).toEqual([]);
    expect(calcular("2026-10-15", [cuota()])).toEqual([]);
  });

  it("pasada la gracia: 20% único sobre el capital impago", () => {
    const [mora] = calcular("2026-10-16", [cuota()]);
    expect(mora!.fecha).toBe("2026-10-16");
    expect(mora!.base.toFixed(2)).toBe("100000.00");
    expect(mora!.ars.toFixed(2)).toBe("20000.00");
  });

  it("no crece con los días de atraso", () => {
    const [a] = calcular("2026-10-16", [cuota()]);
    const [b] = calcular("2027-03-01", [cuota()]);
    expect(b!.ars.toFixed(2)).toBe(a!.ars.toFixed(2));
    expect(b!.fecha).toBe("2026-10-16");
  });

  it("descuenta el capital pagado dentro de la gracia, no el pagado después", () => {
    const pagosCapital = [
      { fecha: "2026-10-12", ars: "40000" },
      { fecha: "2026-10-16", ars: "10000" },
    ];
    const [mora] = calcular("2026-10-20", [cuota({ pagosCapital })]);
    expect(mora!.base.toFixed(2)).toBe("60000.00");
    expect(mora!.ars.toFixed(2)).toBe("12000.00");
  });

  it("capital cancelado dentro de la gracia: sin mora aunque deba interés", () => {
    const pagosCapital = [{ fecha: "2026-10-15", ars: "100000" }];
    expect(calcular("2026-10-20", [cuota({ pagosCapital })])).toEqual([]);
  });

  it("una sola vez por cuota", () => {
    expect(calcular("2026-10-20", [cuota({ tieneMora: true })])).toEqual([]);
  });

  it("usa la tasa y la gracia de cada préstamo y redondea a 2 decimales", () => {
    const [mora] = calcular("2026-10-11", [cuota({ arsCapital: "33333.33" })], "12.5", 0);
    // 33.333,33 × 12,5% = 4.166,66625
    expect(mora!.ars.toFixed(2)).toBe("4166.67");
    expect(calcular("2026-10-20", [cuota()], "0")).toEqual([]);
  });

  it("varias cuotas: solo las que pasaron la gracia", () => {
    const res = calcular("2026-10-20", [
      cuota({ cuotaId: "c1", vencimiento: "2026-10-10" }),
      cuota({ cuotaId: "c2", vencimiento: "2026-10-17" }),
    ]);
    expect(res.map((m) => m.cuotaId)).toEqual(["c1"]);
  });

  it("valida parámetros", () => {
    expect(() => calcular("2026-10-20", [cuota()], "-1")).toThrow();
    expect(() => calcular("2026-10-20", [cuota()], "20", -1)).toThrow();
    expect(() => calcular("2026-10-20", [cuota()], "20", 1.5)).toThrow();
  });
});
