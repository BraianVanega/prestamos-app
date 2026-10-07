import Decimal from "decimal.js";
import type { Asiento } from "./asientos";

export class ErrorAnulacion extends Error {}

/** Contraasientos: mismas cuentas y referencias, montos con el signo invertido. */
export function asientosReversa(asientos: Asiento[]): Asiento[] {
  if (asientos.length === 0) throw new ErrorAnulacion("La transacción no tiene asientos para revertir.");
  return asientos.map((a) => ({ ...a, monto: a.monto.neg() }));
}

/** Huella de una transacción en el libro: qué toca y cuándo se asentó. */
export interface HuellaTransaccion {
  id: string;
  /** Orden de asentado (id del primer asiento): define qué es posterior. */
  orden: number;
  pagoId: string | null;
  /** Préstamos con movimiento de cartera. */
  prestamos: string[];
  /** Clientes con movimiento de saldo a favor. */
  clientes: string[];
}

/**
 * Transacciones vigentes asentadas después de las que se anulan y que dependen
 * de ellas: tocan la cartera de los mismos préstamos (el recupero de costo y la
 * ganancia se calcularon sobre esa cartera), el saldo a favor de los mismos
 * clientes o el mismo pago. Hay que anularlas antes, de la más nueva a la más vieja.
 */
export function transaccionesPosteriores<T extends HuellaTransaccion>(objetivo: HuellaTransaccion[], otras: T[]): T[] {
  if (objetivo.length === 0) return [];
  const ids = new Set(objetivo.map((t) => t.id));
  const desde = Math.min(...objetivo.map((t) => t.orden));
  const prestamos = new Set(objetivo.flatMap((t) => t.prestamos));
  const clientes = new Set(objetivo.flatMap((t) => t.clientes));
  const pagos = new Set(objetivo.flatMap((t) => (t.pagoId ? [t.pagoId] : [])));
  return otras
    .filter(
      (t) =>
        !ids.has(t.id) &&
        t.orden > desde &&
        ((t.pagoId !== null && pagos.has(t.pagoId)) || t.prestamos.some((p) => prestamos.has(p)) || t.clientes.some((c) => clientes.has(c))),
    )
    .sort((a, b) => b.orden - a.orden);
}

/**
 * Un cargo se puede anular si lo ya cobrado como mora en esa cuota (o en los
 * cargos sueltos del préstamo) sigue cubierto por los cargos que quedan.
 * `restantes`: montos de los demás cargos vigentes del mismo grupo.
 */
export function validarAnulacionCargo(params: { restantes: Decimal.Value[]; pagadoMora: Decimal.Value }): void {
  const neto = params.restantes.reduce<Decimal>((s, x) => s.plus(x), new Decimal(0));
  if (new Decimal(params.pagadoMora).gt(Decimal.max(neto, 0))) {
    throw new ErrorAnulacion("Esa mora ya se cobró: anulá primero el pago que la cubrió.");
  }
}
