import Decimal from "decimal.js";

/**
 * Redondeos iguales a los de la base. Postgres `round(numeric, n)` redondea la
 * mitad alejándose del cero, igual que `ROUND_HALF_UP` de decimal.js.
 */
export const DECIMALES = { usdt: 8, ars: 2, tc: 6, pct: 4 } as const;

const redondear = (valor: Decimal.Value, decimales: number) =>
  new Decimal(valor).toDecimalPlaces(decimales, Decimal.ROUND_HALF_UP);

export const redondearUsdt = (v: Decimal.Value) => redondear(v, DECIMALES.usdt);
export const redondearArs = (v: Decimal.Value) => redondear(v, DECIMALES.ars);
export const redondearTc = (v: Decimal.Value) => redondear(v, DECIMALES.tc);
export const redondearPct = (v: Decimal.Value) => redondear(v, DECIMALES.pct);
