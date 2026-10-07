import { describe, expect, it } from "vitest";
import { formatearDocumento, formatearFecha, formatearFechaHora, normalizarDocumento } from "./formato";

describe("normalizarDocumento", () => {
  it("deja solo dígitos en DNI y CUIT", () => {
    expect(normalizarDocumento("32.891.004")).toBe("32891004");
    expect(normalizarDocumento(" 30-71120938-2 ")).toBe("30711209382");
    expect(normalizarDocumento("32 891 004")).toBe("32891004");
  });

  it("vacío → null", () => {
    expect(normalizarDocumento("")).toBeNull();
    expect(normalizarDocumento("   ")).toBeNull();
    expect(normalizarDocumento("..-")).toBeNull();
  });

  it("con letras (pasaporte) queda en mayúsculas sin espacios", () => {
    expect(normalizarDocumento("aab 123456")).toBe("AAB123456");
  });
});

describe("formatearDocumento", () => {
  it("DNI con puntos y CUIT con guiones", () => {
    expect(formatearDocumento("32891004")).toBe("32.891.004");
    expect(formatearDocumento("5123456")).toBe("5.123.456");
    expect(formatearDocumento("30711209382")).toBe("30-71120938-2");
  });

  it("otros formatos quedan como están", () => {
    expect(formatearDocumento("AAB123456")).toBe("AAB123456");
    expect(formatearDocumento(null)).toBe("");
  });
});

describe("formatearFecha", () => {
  it("DD/MM/YYYY sin correrse por zona horaria", () => {
    expect(formatearFecha("2026-10-01")).toBe("01/10/2026");
    expect(formatearFecha(new Date("2026-03-05T02:00:00Z"))).toBe("05/03/2026");
  });
});

describe("formatearFechaHora", () => {
  it("en hora de Argentina (UTC−3)", () => {
    expect(formatearFechaHora(new Date("2026-03-05T02:30:00Z"))).toBe("04/03/2026 · 23:30");
    expect(formatearFechaHora(new Date("2026-10-07T15:05:00Z"))).toBe("07/10/2026 · 12:05");
  });
});
