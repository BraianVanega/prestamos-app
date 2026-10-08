import { describe, expect, it } from "vitest";
import { formatearNumero, parsearDecimal, textoEditable } from "./numeros";

const p = (s: string) => parsearDecimal(s)?.toString() ?? null;

describe("parsearDecimal", () => {
  it("formato es-AR con coma decimal", () => {
    expect(p("3.500.000,50")).toBe("3500000.5");
    expect(p("1285,25")).toBe("1285.25");
    expect(p("12,5")).toBe("12.5");
  });

  it("puntos de miles sin coma", () => {
    expect(p("3.500.000")).toBe("3500000");
    expect(p("1.285")).toBe("1285");
  });

  it("punto decimal cuando no agrupa de a 3", () => {
    expect(p("12.5")).toBe("12.5");
    expect(p("1285.75")).toBe("1285.75");
    expect(p("0.0001")).toBe("0.0001");
  });

  it("ignora espacios y signo $", () => {
    expect(p("$ 3.500.000")).toBe("3500000");
  });

  it("no inventa números", () => {
    expect(p("")).toBeNull();
    expect(p("abc")).toBeNull();
    expect(p("1,2,3")).toBeNull();
    expect(p("1.2.3")).toBeNull();
  });

  it("precisión exacta, sin pasar por number", () => {
    expect(p("0,1")!).toBe("0.1");
    expect(parsearDecimal("9.007.199.254.740.993")!.toFixed(0)).toBe("9007199254740993");
  });
});

describe("formatearNumero", () => {
  it("es-AR con miles y decimales fijos", () => {
    expect(formatearNumero("3500000", 2)).toBe("3.500.000,00");
    expect(formatearNumero("2723.73540856", 2)).toBe("2.723,74");
    expect(formatearNumero("999.995", 2)).toBe("1.000,00");
    expect(formatearNumero("12", 0)).toBe("12");
  });

  it("negativos y cero", () => {
    expect(formatearNumero("-1234.5", 2)).toBe("-1.234,50");
    expect(formatearNumero("-0.001", 2)).toBe("0,00");
  });
});

describe("textoEditable", () => {
  it("pasa lo guardado en la base a texto es-AR sin ceros de más", () => {
    expect(textoEditable("3500000.00")).toBe("3500000");
    expect(textoEditable("1285.500000")).toBe("1285,5");
    expect(textoEditable("9.3333")).toBe("9,3333");
  });

  it("vuelve a leerse igual con parsearDecimal", () => {
    expect(parsearDecimal(textoEditable("1285.123456"))!.toFixed(6)).toBe("1285.123456");
  });
});
