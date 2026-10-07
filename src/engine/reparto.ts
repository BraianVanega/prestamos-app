import Decimal from "decimal.js";

export interface Parte {
  id: string;
  /** Porcentaje (0–100). Las partes suman 100. */
  pct: Decimal.Value;
}

export interface Monto {
  id: string;
  monto: Decimal;
}

/**
 * Reparte `monto` según porcentajes, redondeando a `decimales`. La diferencia de
 * redondeo va a la última parte, así la suma da exactamente el monto.
 */
export function repartir(monto: Decimal.Value, partes: Parte[], decimales: number): Monto[] {
  if (partes.length === 0) throw new Error("No hay partes para repartir");
  const total = partes.reduce((s, p) => s.plus(p.pct), new Decimal(0));
  if (!total.eq(100)) throw new Error(`Los porcentajes suman ${total.toString()}, no 100`);

  const m = new Decimal(monto);
  let asignado = new Decimal(0);
  return partes.map((p, i) => {
    const parte =
      i === partes.length - 1 ? m.minus(asignado) : m.times(p.pct).div(100).toDecimalPlaces(decimales, Decimal.ROUND_HALF_UP);
    asignado = asignado.plus(parte);
    return { id: p.id, monto: parte };
  });
}

/**
 * Abre la parte de la Sociedad entre los socios según `pct_sociedad` y suma
 * por titular final (socio o fondeador). Mantiene el orden: primero los socios.
 */
export function abrirSociedad(
  montos: { participanteId: string; esSociedad: boolean; monto: Decimal.Value }[],
  socios: Parte[],
  decimales: number,
): Monto[] {
  const acumulado = new Map<string, Decimal>();
  const sumar = (id: string, v: Decimal) => acumulado.set(id, (acumulado.get(id) ?? new Decimal(0)).plus(v));
  for (const s of socios) acumulado.set(s.id, new Decimal(0));

  for (const m of montos) {
    if (m.esSociedad) for (const r of repartir(m.monto, socios, decimales)) sumar(r.id, r.monto);
    else sumar(m.participanteId, new Decimal(m.monto));
  }
  return [...acumulado].map(([id, monto]) => ({ id, monto }));
}
