import Decimal from "decimal.js";
import type { Asiento } from "./asientos";
import { DECIMALES, redondearUsdt } from "./redondeo";

export interface PrestamoTercero {
  /** % del préstamo que es del tercero. */
  pct: Decimal.Value;
  /** USDT que puso el tercero en el préstamo. */
  puesto: Decimal.Value;
  /** USDT recuperado del préstamo (todas las partes). */
  recuperado: Decimal.Value;
}

export interface DeudaTercero {
  puesto: Decimal;
  /** Su parte del capital ya recuperado (tope: lo que puso). */
  capitalRecuperado: Decimal;
  ganancia: Decimal;
  pagadoCapital: Decimal;
  pagadoGanancia: Decimal;
  /** Capital recuperado que todavía no se le pagó. */
  disponibleCapital: Decimal;
  /** Ganancia realizada que todavía no se le pagó. */
  disponibleGanancia: Decimal;
  disponible: Decimal;
}

/**
 * Lo que se le debe a un tercero hoy: su % de lo recuperado de cada préstamo
 * (sin pasar lo que puso) más su ganancia realizada, menos lo ya pagado.
 */
export function deudaTercero(params: {
  prestamos: PrestamoTercero[];
  ganancia: Decimal.Value;
  pagadoCapital: Decimal.Value;
  pagadoGanancia: Decimal.Value;
}): DeudaTercero {
  let puesto = new Decimal(0);
  let capitalRecuperado = new Decimal(0);
  for (const p of params.prestamos) {
    const suyo = redondearUsdt(new Decimal(p.recuperado).times(p.pct).div(100));
    puesto = puesto.plus(p.puesto);
    capitalRecuperado = capitalRecuperado.plus(Decimal.max(0, Decimal.min(suyo, p.puesto)));
  }
  const ganancia = new Decimal(params.ganancia);
  const pagadoCapital = new Decimal(params.pagadoCapital);
  const pagadoGanancia = new Decimal(params.pagadoGanancia);
  const disponibleCapital = Decimal.max(0, capitalRecuperado.minus(pagadoCapital));
  const disponibleGanancia = Decimal.max(0, ganancia.minus(pagadoGanancia));
  return {
    puesto,
    capitalRecuperado,
    ganancia,
    pagadoCapital,
    pagadoGanancia,
    disponibleCapital,
    disponibleGanancia,
    disponible: disponibleCapital.plus(disponibleGanancia),
  };
}

/**
 * Pago al tercero: sale USDT de la caja y baja su cuenta. Primero devuelve
 * capital recuperado y después ganancia; nunca más de lo que se le debe.
 */
export function asientosPagoTercero(
  terceroId: string,
  usdt: Decimal.Value,
  deuda: Pick<DeudaTercero, "disponibleCapital" | "disponibleGanancia">,
): Asiento[] {
  const monto = new Decimal(usdt);
  if (monto.lte(0)) throw new Error("El pago tiene que ser mayor a 0");
  if (monto.decimalPlaces() > DECIMALES.usdt) throw new Error("El pago va con 8 decimales como máximo");
  if (monto.gt(deuda.disponibleCapital.plus(deuda.disponibleGanancia))) throw new Error("Supera lo que se le debe");

  const capital = Decimal.min(monto, deuda.disponibleCapital);
  const ganancia = monto.minus(capital);
  return [
    { cuenta: "caja_usdt", moneda: "USDT", monto: monto.neg() },
    ...(capital.gt(0) ? [{ cuenta: "capital", moneda: "USDT", monto: capital, participanteId: terceroId } as Asiento] : []),
    ...(ganancia.gt(0) ? [{ cuenta: "ganancia", moneda: "USDT", monto: ganancia, participanteId: terceroId } as Asiento] : []),
  ];
}
