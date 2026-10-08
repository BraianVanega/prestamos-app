import Decimal from "decimal.js";
import { distribuirFifo, type Deuda } from "./pago";

/**
 * Corrección de un préstamo con cobros: el préstamo se anula y se da de alta el
 * corregido; los cobros del cliente desde el primero que tocó el préstamo se
 * anulan y se vuelven a registrar en el mismo orden (misma fecha, monto, tipo y
 * TC). Lo que el cliente pagó no cambia: cambia cómo se imputa.
 */

/** Una operación de cobro tal como se registró (un pago nuevo y/o saldo a favor aplicado). */
export interface OperacionCobro {
  /** Instante de registro (texto ordenable): agrupa todo lo de la operación. */
  instante: string;
  /** Pago creado en la operación; null si solo se aplicó saldo a favor. */
  pagoNuevoId: string | null;
  /** Pagos contra los que se imputó (el nuevo y los de origen del saldo aplicado). */
  pagos: string[];
  /** Préstamos que recibieron algo. */
  prestamos: string[];
}

export interface ConversionRegistrada {
  id: string;
  instante: string;
  /** Pagos en efectivo que convierte (lotes). */
  pagos: string[];
}

export interface PagoRegistrado {
  id: string;
  instante: string;
}

/**
 * Qué hay que rebobinar: todas las operaciones del cliente desde la primera que
 * imputó al préstamo, extendiendo hacia atrás hasta el pago de origen de cada
 * saldo a favor aplicado en ese tramo (anular un pago anula también lo que se
 * aplicó desde él), y las conversiones que incluyen efectivo de esos pagos.
 * Sin operaciones sobre el préstamo no hay nada que rebobinar.
 */
export function alcanceCorreccion<O extends OperacionCobro, C extends ConversionRegistrada>(params: {
  prestamoId: string;
  operaciones: O[];
  pagos: PagoRegistrado[];
  conversiones: C[];
}): { desde: string | null; operaciones: O[]; pagos: string[]; conversiones: C[] } {
  const delPrestamo = params.operaciones.filter((o) => o.prestamos.includes(params.prestamoId));
  if (delPrestamo.length === 0) return { desde: null, operaciones: [], pagos: [], conversiones: [] };

  const instantePago = new Map(params.pagos.map((p) => [p.id, p.instante]));
  let desde = delPrestamo.map((o) => o.instante).sort()[0]!;
  for (;;) {
    const origenes = params.operaciones
      .filter((o) => o.instante >= desde)
      .flatMap((o) => o.pagos.map((id) => instantePago.get(id)!))
      .filter((i) => i < desde)
      .sort();
    if (origenes.length === 0) break;
    desde = origenes[0]!;
  }

  const operaciones = params.operaciones.filter((o) => o.instante >= desde).sort((a, b) => a.instante.localeCompare(b.instante));
  const pagos = params.pagos.filter((p) => p.instante >= desde).map((p) => p.id);
  const enAlcance = new Set(pagos);
  const conversiones = params.conversiones
    .filter((c) => c.pagos.some((id) => enAlcance.has(id)))
    .sort((a, b) => a.instante.localeCompare(b.instante));
  return { desde, operaciones, pagos, conversiones };
}

/**
 * Montos a imputar al volver a registrar una operación. A los demás préstamos va
 * lo mismo que la vez original (tope: lo que deben ahora). Lo que había ido al
 * préstamo corregido se reparte FIFO sobre su cronograma nuevo; lo que no entra
 * queda como saldo a favor. El total no supera lo disponible (pago + saldo aplicable),
 * respetando el orden de la cascada.
 */
export function montosReplay(params: {
  /** Deuda a la fecha de la operación, ya con los descuentos aplicados. */
  deudas: Deuda[];
  /** Imputado en la operación original por clave de deuda (sin saldo a favor). */
  originales: Map<string, Decimal.Value>;
  viejoId: string;
  nuevoId: string;
  disponible: Decimal.Value;
}): Map<string, Decimal> {
  const alViejo = [...params.originales]
    .filter(([clave]) => clave.startsWith(`${params.viejoId}:`))
    .reduce((s, [, ars]) => s.plus(ars), new Decimal(0));
  const fifo = distribuirFifo(
    alViejo,
    params.deudas.filter((d) => d.prestamoId === params.nuevoId),
  );

  let resto = Decimal.max(new Decimal(params.disponible), 0);
  const montos = new Map<string, Decimal>();
  for (const d of params.deudas) {
    const pedido = d.prestamoId === params.nuevoId ? (fifo.get(d.clave) ?? new Decimal(0)) : new Decimal(params.originales.get(d.clave) ?? 0);
    const m = Decimal.min(pedido, d.total, resto);
    if (m.gt(0)) montos.set(d.clave, m);
    resto = resto.minus(m);
  }
  return montos;
}

export interface DescuentoOriginal {
  prestamoId: string;
  /** null = cargos sin cuota. */
  cuotaNumero: number | null;
  /** Monto positivo descontado. */
  ars: Decimal.Value;
}

/**
 * Descuentos del préstamo corregido al volver a registrar una operación: pasan a
 * la cuota del mismo número, con tope en su mora más interés a esa fecha. Los
 * descuentos de otros préstamos no se repiten (siguen cargados).
 */
export function descuentosReplay(params: {
  /** Deuda a la fecha, sin descuentos. */
  deudas: Deuda[];
  originales: DescuentoOriginal[];
  viejoId: string;
  nuevoId: string;
}): Map<string, Decimal> {
  const pedido = new Map<number, Decimal>();
  for (const o of params.originales) {
    if (o.prestamoId !== params.viejoId || o.cuotaNumero === null) continue;
    pedido.set(o.cuotaNumero, (pedido.get(o.cuotaNumero) ?? new Decimal(0)).plus(o.ars));
  }
  const descuentos = new Map<string, Decimal>();
  for (const d of params.deudas) {
    if (d.prestamoId !== params.nuevoId || d.cuotaNumero === null) continue;
    const ars = Decimal.min(pedido.get(d.cuotaNumero) ?? 0, d.mora.plus(d.interes));
    if (ars.gt(0)) descuentos.set(d.clave, ars);
  }
  return descuentos;
}

/** "Pronto pago (cuota 3)" → "Pronto pago": el motivo sin la referencia a la fila. */
export const motivoDescuentoBase = (motivo: string) => motivo.replace(/\s*\((cuota \d+|cargos)\)$/, "");

export interface MoraPerdonada {
  cuotaNumero: number;
  fecha: string;
  ars: Decimal.Value;
}

/**
 * Moras anuladas (perdonadas) del préstamo original que siguen perdonadas en el
 * corregido: van a la cuota del mismo número, si existe. Una mora anulada no se
 * vuelve a generar en esa cuota.
 */
export function morasPerdonadasReplay<C extends { id: string; numero: number }>(
  perdonadas: MoraPerdonada[],
  cuotasNuevas: C[],
): (MoraPerdonada & { cuotaId: string })[] {
  const porNumero = new Map(cuotasNuevas.map((c) => [c.numero, c.id]));
  const vistas = new Set<number>();
  return perdonadas.flatMap((m) => {
    const cuotaId = porNumero.get(m.cuotaNumero);
    if (!cuotaId || vistas.has(m.cuotaNumero)) return [];
    vistas.add(m.cuotaNumero);
    return [{ ...m, cuotaId }];
  });
}
