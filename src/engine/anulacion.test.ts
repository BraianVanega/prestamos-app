import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { asientosReversa, ErrorAnulacion, transaccionesPosteriores, validarAnulacionCargo, type HuellaTransaccion } from "./anulacion";

const huella = (id: string, orden: number, h: Partial<HuellaTransaccion> = {}): HuellaTransaccion => ({
  id,
  orden,
  pagoId: null,
  prestamos: [],
  clientes: [],
  ...h,
});

describe("asientosReversa", () => {
  it("invierte el signo y conserva cuentas y referencias", () => {
    const r = asientosReversa([
      { cuenta: "caja_usdt", moneda: "USDT", monto: new Decimal("37.03703704") },
      { cuenta: "cartera", moneda: "USDT", monto: new Decimal("-37.03703704"), prestamoId: "P1" },
    ]);
    expect(r.map((a) => [a.cuenta, a.prestamoId, a.monto.toFixed(8)])).toEqual([
      ["caja_usdt", undefined, "-37.03703704"],
      ["cartera", "P1", "37.03703704"],
    ]);
  });

  it("sin asientos no hay nada que revertir", () => {
    expect(() => asientosReversa([])).toThrow(ErrorAnulacion);
  });
});

describe("transaccionesPosteriores", () => {
  const objetivo = [huella("T1", 10, { pagoId: "PG1", prestamos: ["P1"], clientes: ["C1"] })];

  it("bloquea lo posterior que toca la misma cartera, saldo a favor o pago", () => {
    const otras = [
      huella("A", 5, { prestamos: ["P1"] }), // anterior
      huella("B", 11, { prestamos: ["P2"] }), // otro préstamo
      huella("C", 12, { prestamos: ["P1", "P2"] }),
      huella("D", 13, { clientes: ["C1"] }),
      huella("E", 14, { pagoId: "PG1" }),
      huella("T1", 10, { prestamos: ["P1"] }), // la misma
    ];
    expect(transaccionesPosteriores(objetivo, otras).map((t) => t.id)).toEqual(["E", "D", "C"]);
  });

  it("toma como inicio la más vieja del grupo", () => {
    const grupo = [huella("T1", 10, { prestamos: ["P1"] }), huella("T2", 20, { prestamos: ["P1"] })];
    expect(transaccionesPosteriores(grupo, [huella("X", 15, { prestamos: ["P1"] })]).map((t) => t.id)).toEqual(["X"]);
    expect(transaccionesPosteriores([], [huella("X", 15)])).toEqual([]);
  });
});

describe("validarAnulacionCargo", () => {
  it("permite anular mora no cobrada", () => {
    expect(() => validarAnulacionCargo({ restantes: [], pagadoMora: "0" })).not.toThrow();
  });

  it("rechaza anular mora ya cobrada", () => {
    expect(() => validarAnulacionCargo({ restantes: [], pagadoMora: "100" })).toThrow(/ya se cobró/);
    // Con un descuento restante la mora neta es negativa: tampoco cubre lo cobrado.
    expect(() => validarAnulacionCargo({ restantes: ["-50"], pagadoMora: "10" })).toThrow(ErrorAnulacion);
  });

  it("permite anular un descuento si la mora cobrada sigue cubierta", () => {
    expect(() => validarAnulacionCargo({ restantes: ["200"], pagadoMora: "200" })).not.toThrow();
    expect(() => validarAnulacionCargo({ restantes: ["200"], pagadoMora: "200.01" })).toThrow();
  });
});
