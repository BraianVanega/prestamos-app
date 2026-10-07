import Decimal from "decimal.js";
import type { Asiento } from "./asientos";
import { DECIMALES } from "./redondeo";
import { repartir, type Parte } from "./reparto";

/**
 * Aporte de capital en USDT: entra a la caja única y suma al capital de cada
 * socio que aporta. Con varios socios se reparte según `partes` (pct que suman
 * 100); el redondeo va al último.
 */
export function asientosAporte(usdt: Decimal.Value, partes: Parte[]): Asiento[] {
  const monto = new Decimal(usdt);
  if (monto.lte(0)) throw new Error("El aporte tiene que ser mayor a 0");
  if (monto.decimalPlaces() > DECIMALES.usdt) throw new Error("El aporte va con 8 decimales como máximo");
  return [
    { cuenta: "caja_usdt", moneda: "USDT", monto },
    ...repartir(monto, partes, DECIMALES.usdt)
      .filter((r) => !r.monto.isZero())
      .map((r): Asiento => ({ cuenta: "capital", moneda: "USDT", monto: r.monto.neg(), participanteId: r.id })),
  ];
}
