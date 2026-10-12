import Decimal from "decimal.js";
import type { Asiento } from "./asientos";
import { DECIMALES, redondearUsdt } from "./redondeo";
import { repartir } from "./reparto";

/**
 * Desembolso: sale USDT de la caja y entra a cartera al costo (usdt_prestado).
 * El capital por participante no se mueve: el préstamo sigue siendo de quien
 * puso la plata, según `prestamo_participaciones`.
 */
export function asientosDesembolso(prestamoId: string, usdtPrestado: Decimal.Value): Asiento[] {
  const usdt = redondearUsdt(usdtPrestado);
  if (usdt.lte(0)) throw new Error("El desembolso debe ser mayor a 0");
  return [
    { cuenta: "cartera", moneda: "USDT", monto: usdt, prestamoId },
    { cuenta: "caja_usdt", moneda: "USDT", monto: usdt.neg() },
  ];
}

export interface Participacion {
  participanteId: string;
  pctCapital: Decimal;
  pctGanancia: Decimal;
}

/** Caso A de la spec (fase 1): capital y ganancia 100% de la Sociedad. */
export function participacionSociedad(sociedadId: string): Participacion[] {
  return [{ participanteId: sociedadId, pctCapital: new Decimal(100), pctGanancia: new Decimal(100) }];
}

export interface ParteTercero {
  participanteId: string;
  /** % del préstamo que pone el tercero (capital y ganancia). */
  pct: Decimal.Value;
}

/**
 * Caso B: cada tercero pone su % del préstamo y se lleva ese mismo % de la
 * ganancia; el resto es de la Sociedad (se omite si no queda nada).
 */
export function participacionesPrestamo(sociedadId: string, terceros: ParteTercero[]): Participacion[] {
  const ids = new Set<string>();
  let suma = new Decimal(0);
  const partes = terceros.map((t) => {
    const pct = new Decimal(t.pct);
    if (pct.lte(0) || pct.gt(100)) throw new Error("El % de cada tercero va entre 0 y 100");
    if (pct.decimalPlaces() > DECIMALES.pct) throw new Error("El % va con 4 decimales como máximo");
    if (t.participanteId === sociedadId || ids.has(t.participanteId)) throw new Error("Cada tercero va una sola vez");
    ids.add(t.participanteId);
    suma = suma.plus(pct);
    return { participanteId: t.participanteId, pctCapital: pct, pctGanancia: pct };
  });
  if (suma.gt(100)) throw new Error("Los terceros suman más del 100%");
  const sociedad = new Decimal(100).minus(suma);
  return sociedad.gt(0) ? [{ participanteId: sociedadId, pctCapital: sociedad, pctGanancia: sociedad }, ...partes] : partes;
}

/**
 * Lo que pone cada tercero al desembolsar: entra a la caja y queda en su
 * capital, así la caja solo pone la parte de la Sociedad. Se reparte el USDT
 * del préstamo por % de capital; el redondeo va a la Sociedad (o al último).
 */
export function asientosAporteTerceros(
  prestamoId: string,
  usdtPrestado: Decimal.Value,
  participaciones: Participacion[],
  sociedadId: string,
): Asiento[] {
  const orden = [...participaciones.filter((p) => p.participanteId !== sociedadId), ...participaciones.filter((p) => p.participanteId === sociedadId)];
  return repartir(redondearUsdt(usdtPrestado), orden.map((p) => ({ id: p.participanteId, pct: p.pctCapital })), DECIMALES.usdt)
    .filter((r) => r.id !== sociedadId && r.monto.gt(0))
    .flatMap((r): Asiento[] => [
      { cuenta: "caja_usdt", moneda: "USDT", monto: r.monto },
      { cuenta: "capital", moneda: "USDT", monto: r.monto.neg(), participanteId: r.id, prestamoId },
    ]);
}
