import Decimal from "decimal.js";
import type { Asiento } from "./asientos";
import { diasEntre, type Fecha } from "./fechas";
import { asientosRecupero, type ParticipacionGanancia, type RecuperoPrestamo } from "./pago";
import { DECIMALES, redondearUsdt } from "./redondeo";

/** Pago en efectivo con ARS todavía sin convertir (un lote posible). */
export interface EfectivoPendiente {
  pagoId: string;
  fecha: Fecha;
  pendiente: Decimal.Value;
}

export class ErrorConversion extends Error {}

/** USDT que resultan de convertir, con el mismo redondeo que el CHECK de la base. */
export function usdtConversion(ars: Decimal.Value, tc: Decimal.Value): Decimal {
  const t = new Decimal(tc);
  if (t.lte(0)) throw new ErrorConversion("El TC tiene que ser mayor a 0.");
  return redondearUsdt(new Decimal(ars).div(t));
}

/** Lotes sugeridos: el efectivo más viejo se convierte primero. */
export function lotesFifo(ars: Decimal.Value, pendientes: EfectivoPendiente[]): Map<string, Decimal> {
  let resto = Decimal.max(new Decimal(ars), 0);
  const lotes = new Map<string, Decimal>();
  for (const p of pendientes) {
    const m = Decimal.min(resto, p.pendiente);
    lotes.set(p.pagoId, m);
    resto = resto.minus(m);
  }
  return lotes;
}

/**
 * Valida los lotes elegidos contra el efectivo pendiente y reparte los USDT de
 * la conversión entre ellos en proporción a los ARS (el redondeo va al último),
 * así la suma da exactamente `usdt_resultante`.
 */
export function armarLotes(params: {
  fecha: Fecha;
  ars: Decimal.Value;
  tc: Decimal.Value;
  pendientes: EfectivoPendiente[];
  lotes: Map<string, Decimal.Value>;
}): { usdt: Decimal; lotes: { pagoId: string; ars: Decimal; usdt: Decimal }[] } {
  const ars = new Decimal(params.ars);
  if (ars.lte(0)) throw new ErrorConversion("El monto a convertir tiene que ser mayor a 0.");
  if (ars.decimalPlaces() > DECIMALES.ars) throw new ErrorConversion("Los montos van con 2 decimales como máximo.");
  const porPago = new Map(params.pendientes.map((p) => [p.pagoId, p]));
  for (const id of params.lotes.keys()) {
    if (!porPago.has(id)) throw new ErrorConversion("El efectivo pendiente cambió: volvé a cargar la pantalla.");
  }

  const elegidos: { pagoId: string; ars: Decimal }[] = [];
  for (const p of params.pendientes) {
    const m = new Decimal(params.lotes.get(p.pagoId) ?? 0);
    if (m.isZero()) continue;
    if (m.lt(0)) throw new ErrorConversion("Un lote es negativo.");
    if (m.decimalPlaces() > DECIMALES.ars) throw new ErrorConversion("Los montos van con 2 decimales como máximo.");
    if (m.gt(p.pendiente)) throw new ErrorConversion("Un lote supera el efectivo pendiente de ese pago.");
    if (diasEntre(p.fecha, params.fecha) < 0) throw new ErrorConversion("No se puede convertir efectivo antes de cobrarlo.");
    elegidos.push({ pagoId: p.pagoId, ars: m });
  }
  const total = elegidos.reduce((s, l) => s.plus(l.ars), new Decimal(0));
  if (!total.eq(ars)) throw new ErrorConversion("Los lotes tienen que sumar el monto convertido.");

  const usdt = usdtConversion(ars, params.tc);
  return { usdt, lotes: proporcional(usdt, elegidos).map((l) => ({ pagoId: l.pagoId, ars: l.ars, usdt: l.parte })) };
}

/** Reparte `total` en proporción a `ars` de cada ítem; el redondeo va al último. */
function proporcional<T extends { ars: Decimal }>(total: Decimal, items: T[]): (T & { parte: Decimal })[] {
  const suma = items.reduce((s, x) => s.plus(x.ars), new Decimal(0));
  let asignado = new Decimal(0);
  return items.map((x, i) => {
    const parte = i === items.length - 1 ? total.minus(asignado) : redondearUsdt(total.times(x.ars).div(suma));
    asignado = asignado.plus(parte);
    return { ...x, parte };
  });
}

/**
 * Asientos de un lote: sale de la caja de efectivo (contra el puente que abrió
 * el cobro) y entran los USDT, repartidos según cómo está imputado el pago hoy.
 * Recién acá se recupera costo y se reconoce ganancia, como en una transferencia.
 */
export function asientosConversionLote(params: {
  ars: Decimal.Value;
  usdt: Decimal.Value;
  /** Imputación vigente del pago: ARS por préstamo y saldo a favor (solo proporciones). */
  porPrestamo: { prestamoId: string; ars: Decimal.Value }[];
  saldoFavorArs: Decimal.Value;
  clienteId: string;
  cartera: Map<string, Decimal.Value>;
  participaciones: Map<string, ParticipacionGanancia[]>;
}): { asientos: Asiento[]; prestamos: RecuperoPrestamo[]; saldoFavorUsdt: Decimal } {
  const ars = new Decimal(params.ars);
  const usdt = new Decimal(params.usdt);
  if (ars.lte(0) || usdt.lte(0)) throw new Error("El lote tiene que ser mayor a 0");
  const destinos = [
    ...params.porPrestamo.map((p) => ({ prestamoId: p.prestamoId as string | null, ars: new Decimal(p.ars) })),
    { prestamoId: null, ars: new Decimal(params.saldoFavorArs) },
  ].filter((d) => d.ars.gt(0));
  if (destinos.length === 0) throw new Error("El pago no tiene imputación");

  const partes = proporcional(usdt, destinos);
  const recupero = asientosRecupero(
    partes.flatMap((p) => (p.prestamoId ? [{ prestamoId: p.prestamoId, usdt: p.parte }] : [])),
    params.cartera,
    params.participaciones,
  );
  const saldoFavorUsdt = partes.find((p) => p.prestamoId === null)?.parte ?? new Decimal(0);
  return {
    asientos: [
      { cuenta: "caja_efectivo_ars", moneda: "ARS", monto: ars.neg() },
      { cuenta: "puente_cambio", moneda: "ARS", monto: ars },
      { cuenta: "caja_usdt", moneda: "USDT", monto: usdt },
      ...recupero.asientos,
      ...(saldoFavorUsdt.gt(0) ? [{ cuenta: "saldo_favor" as const, moneda: "USDT" as const, monto: saldoFavorUsdt.neg(), clienteId: params.clienteId }] : []),
    ],
    prestamos: recupero.prestamos,
    saldoFavorUsdt,
  };
}
