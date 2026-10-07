import Decimal from "decimal.js";
import { diasEntre, type Fecha } from "./fechas";

export interface CuotaConPagos {
  id: string;
  numero: number;
  vencimiento: Fecha;
  arsCapital: Decimal.Value;
  arsInteres: Decimal.Value;
  /** Imputado (de pagos no anulados) a esta cuota por concepto. */
  pagadoCapital: Decimal.Value;
  pagadoInteres: Decimal.Value;
}

/** Estado visible de una cuota; vencida tiene prioridad sobre parcial. */
export type SituacionCuota = "pagada" | "vencida" | "parcial" | "pendiente";

export interface CuotaEstado {
  id: string;
  numero: number;
  vencimiento: Fecha;
  saldoCapital: Decimal;
  saldoInteres: Decimal;
  saldo: Decimal;
  pagada: boolean;
  situacion: SituacionCuota;
  /** Días desde el vencimiento si está impaga y vencida; si no, 0. */
  diasAtraso: number;
}

export interface EstadoCuotas {
  cuotas: CuotaEstado[];
  /** Primera cuota impaga (por número), o null si está todo pagado. */
  proxima: CuotaEstado | null;
  /** Atraso de la cuota impaga más vieja; 0 si no hay vencidas. */
  diasAtraso: number;
  cuotasPagadas: number;
  /** Capital + interés impago en ARS (sin mora ni cargos). */
  saldoArs: Decimal;
}

const noNegativo = (d: Decimal) => Decimal.max(d, 0);

/** Estado del plan de pagos a una fecha dada (la fecha se recibe, nunca se asume). */
export function estadoCuotas(cuotas: CuotaConPagos[], hoy: Fecha): EstadoCuotas {
  const estados = [...cuotas]
    .sort((a, b) => a.numero - b.numero)
    .map((c): CuotaEstado => {
      const saldoCapital = noNegativo(new Decimal(c.arsCapital).minus(c.pagadoCapital));
      const saldoInteres = noNegativo(new Decimal(c.arsInteres).minus(c.pagadoInteres));
      const saldo = saldoCapital.plus(saldoInteres);
      const pagada = saldo.isZero();
      const atraso = diasEntre(c.vencimiento, hoy);
      const diasAtraso = !pagada && atraso > 0 ? atraso : 0;
      const parcial = !pagada && saldo.lt(new Decimal(c.arsCapital).plus(c.arsInteres));
      return {
        id: c.id,
        numero: c.numero,
        vencimiento: c.vencimiento,
        saldoCapital,
        saldoInteres,
        saldo,
        pagada,
        situacion: pagada ? "pagada" : diasAtraso > 0 ? "vencida" : parcial ? "parcial" : "pendiente",
        diasAtraso,
      };
    });

  const impagas = estados.filter((c) => !c.pagada);
  return {
    cuotas: estados,
    proxima: impagas[0] ?? null,
    diasAtraso: impagas.reduce((max, c) => Math.max(max, c.diasAtraso), 0),
    cuotasPagadas: estados.length - impagas.length,
    saldoArs: impagas.reduce((s, c) => s.plus(c.saldo), new Decimal(0)),
  };
}

export type NivelRiesgo = "verde" | "amarillo" | "naranja" | "rojo" | "negro";

/**
 * Semáforo por atraso como % del plazo total del préstamo (desembolso → último
 * vencimiento), con los cortes de la leyenda del Overview. Hasta cada límite
 * inclusive; más allá del último, negro. Así un préstamo corto se pone en rojo
 * antes que uno largo con los mismos días de atraso.
 */
export const BANDAS_RIESGO_PCT: { hastaPct: number; nivel: NivelRiesgo }[] = [
  { hastaPct: 3, nivel: "verde" },
  { hastaPct: 10, nivel: "amarillo" },
  { hastaPct: 20, nivel: "naranja" },
  { hastaPct: 45, nivel: "rojo" },
];

/** % del plazo que representa el atraso (4 decimales). */
export function atrasoPctDelPlazo(diasAtraso: number, diasPlazo: number): Decimal {
  if (!Number.isInteger(diasPlazo) || diasPlazo <= 0) throw new Error("El plazo debe ser de al menos 1 día");
  return new Decimal(Math.max(diasAtraso, 0)).div(diasPlazo).times(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function nivelRiesgo(diasAtraso: number, diasPlazo: number): NivelRiesgo {
  if (diasAtraso <= 0) return "verde";
  const pct = atrasoPctDelPlazo(diasAtraso, diasPlazo);
  return BANDAS_RIESGO_PCT.find((b) => pct.lte(b.hastaPct))?.nivel ?? "negro";
}

/**
 * USDT recuperado de un préstamo según el libro: costo recuperado (cuánto bajó
 * la cartera desde el desembolso) más la ganancia reconocida del préstamo.
 * `saldoCartera` y `gananciaAsientos` son sumas de asientos (+ débito / − crédito).
 */
export function recuperadoUsdt(params: {
  usdtPrestado: Decimal.Value;
  saldoCartera: Decimal.Value;
  gananciaAsientos: Decimal.Value;
}): Decimal {
  const costoRecuperado = new Decimal(params.usdtPrestado).minus(params.saldoCartera);
  const ganancia = new Decimal(params.gananciaAsientos).neg();
  return costoRecuperado.plus(ganancia);
}

export interface SaldoExigible {
  /** Capital + interés impago del plan. */
  plan: Decimal;
  /** Cargos vigentes (mora +, descuento −, ajuste ±) menos lo ya imputado a mora. */
  cargos: Decimal;
  /** Mora que corresponde a la fecha y todavía no se cargó (se carga al registrar el pago). */
  moraACargar: Decimal;
  total: Decimal;
}

/** Lo que el cliente debe hoy en ARS por un préstamo. Nunca negativo. */
export function saldoExigible(params: {
  saldoPlan: Decimal.Value;
  /** Montos de cargos no anulados. */
  cargos: Decimal.Value[];
  /** Imputado a mora/cargos por pagos no anulados. */
  imputadoCargos: Decimal.Value;
  moraACargar: Decimal.Value[];
}): SaldoExigible {
  const plan = new Decimal(params.saldoPlan);
  const cargos = params.cargos.reduce<Decimal>((s, c) => s.plus(c), new Decimal(0)).minus(params.imputadoCargos);
  const moraACargar = params.moraACargar.reduce<Decimal>((s, c) => s.plus(c), new Decimal(0));
  return { plan, cargos, moraACargar, total: Decimal.max(plan.plus(cargos).plus(moraACargar), 0) };
}
