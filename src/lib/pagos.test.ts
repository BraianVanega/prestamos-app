import { describe, expect, it } from "vitest";
import { esquemaPago } from "./pagos";

const id = "11111111-1111-4111-8111-111111111111";
const base = {
  clienteId: id,
  fecha: "2026-10-07",
  tipo: "transferencia",
  ars: "500.000",
  tcSalida: "1.300",
  metodo: " Banco ",
  notas: "",
  montos: JSON.stringify({ [`${id}:${id}`]: "216000.00", [`${id}:cargos`]: "10" }),
};

describe("esquemaPago", () => {
  it("transferencia: parsea montos es-AR, TC y distribución", () => {
    const r = esquemaPago.parse(base);
    expect(r.ars.toFixed(2)).toBe("500000.00");
    expect(r.tcSalida?.toFixed(2)).toBe("1300.00");
    expect(r.metodo).toBe("Banco");
    expect(r.notas).toBeNull();
    expect(Object.keys(r.montos)).toHaveLength(2);
  });

  it("efectivo: ignora el TC", () => {
    expect(esquemaPago.parse({ ...base, tipo: "efectivo", tcSalida: "lo que sea" }).tcSalida).toBeNull();
  });

  it("transferencia sin TC: error en el campo", () => {
    const r = esquemaPago.safeParse({ ...base, tcSalida: "" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(["tcSalida"]);
  });

  it("rechaza distribuciones mal formadas", () => {
    for (const montos of ["no-json", JSON.stringify({ x: "1" }), JSON.stringify({ [`${id}:${id}`]: "1,5" }), JSON.stringify([1])]) {
      expect(esquemaPago.safeParse({ ...base, montos }).success).toBe(false);
    }
  });

  it("monto obligatorio y positivo", () => {
    expect(esquemaPago.safeParse({ ...base, ars: "0" }).success).toBe(false);
    expect(esquemaPago.safeParse({ ...base, ars: "" }).success).toBe(false);
  });
});
