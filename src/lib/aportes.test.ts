import { describe, expect, it } from "vitest";
import { esquemaAporte } from "./aportes";

const base = { fecha: "2026-10-07", socio: "ambos", usdt: "1.500,5", notas: "" };

describe("esquemaAporte", () => {
  it("parsea USDT es-AR y acepta 'ambos' o un socio", () => {
    const r = esquemaAporte.parse(base);
    expect([r.usdt.toFixed(2), r.socio, r.notas]).toEqual(["1500.50", "ambos", null]);
    expect(esquemaAporte.safeParse({ ...base, socio: "11111111-1111-4111-8111-111111111111" }).success).toBe(true);
  });

  it("rechaza socio inválido y montos no positivos", () => {
    expect(esquemaAporte.safeParse({ ...base, socio: "" }).success).toBe(false);
    expect(esquemaAporte.safeParse({ ...base, usdt: "0" }).success).toBe(false);
    expect(esquemaAporte.safeParse({ ...base, usdt: "1,123456789" }).success).toBe(false);
  });
});
