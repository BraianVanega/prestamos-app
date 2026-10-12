import { describe, expect, it } from "vitest";
import { esquemaPagoTercero, esquemaTercero } from "./terceros";

describe("esquemaTercero", () => {
  const base = { nombre: " Juan Pérez ", pctDefault: "20,5", notas: "", activo: "si" };

  it("lee el % sugerido es-AR y limpia los textos", () => {
    const t = esquemaTercero.parse(base);
    expect([t.nombre, t.pctDefault?.toString(), t.notas, t.activo]).toEqual(["Juan Pérez", "20.5", null, true]);
  });

  it("el % sugerido es opcional y no pasa el 100", () => {
    expect(esquemaTercero.parse({ ...base, pctDefault: "" }).pctDefault).toBeNull();
    expect(esquemaTercero.safeParse({ ...base, pctDefault: "101" }).success).toBe(false);
    expect(esquemaTercero.safeParse({ ...base, pctDefault: "0" }).success).toBe(false);
  });

  it("pide el nombre", () => {
    expect(esquemaTercero.safeParse({ ...base, nombre: " " }).success).toBe(false);
  });
});

describe("esquemaPagoTercero", () => {
  it("monto positivo en USDT y fecha", () => {
    const p = esquemaPagoTercero.parse({ fecha: "2026-10-12", usdt: "1.234,5", notas: " Binance " });
    expect([p.usdt.toString(), p.notas]).toEqual(["1234.5", "Binance"]);
    expect(esquemaPagoTercero.safeParse({ fecha: "2026-10-12", usdt: "0", notas: "" }).success).toBe(false);
  });
});
