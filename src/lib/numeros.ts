import Decimal from "decimal.js";

/**
 * Lee un número tipeado en formato es-AR sin pasar nunca por `number`.
 * - Con coma: la coma es el decimal y los puntos son miles ("3.500.000,50").
 * - Sin coma: los puntos son miles si agrupan de a 3 ("3.500.000", "1.285");
 *   si no, el punto es decimal ("12.5", "1285.75").
 * Devuelve null si no es un número válido.
 */
export function parsearDecimal(texto: string): Decimal | null {
  let s = texto.trim().replace(/\s|\$/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return new Decimal(s);
}

const separarMiles = (entero: string) => entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** Decimal → "1.234.567,89" con exactamente `decimales` decimales (redondeo half-up). */
export function formatearNumero(valor: Decimal.Value, decimales: number): string {
  const fijo = new Decimal(valor).toFixed(decimales, Decimal.ROUND_HALF_UP);
  const negativo = fijo.startsWith("-");
  const [entero, frac] = (negativo ? fijo.slice(1) : fijo).split(".");
  const texto = separarMiles(entero!) + (frac ? `,${frac}` : "");
  return negativo && !/^[0,.]+$/.test(texto) ? `-${texto}` : texto;
}

export const formatearArs = (v: Decimal.Value) => formatearNumero(v, 2);
export const formatearUsdt = (v: Decimal.Value) => formatearNumero(v, 2);
export const formatearTc = (v: Decimal.Value) => formatearNumero(v, 2);
export const formatearPct = (v: Decimal.Value) => formatearNumero(v, 2);
