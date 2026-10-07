/**
 * Fechas de calendario como `YYYY-MM-DD` (lo que devuelve Drizzle para `date`).
 * Se calcula en UTC para que la zona horaria del servidor no corra los días.
 */
export type Fecha = string;

export type Frecuencia = "dia" | "semana" | "quincena" | "mes";

const DIAS_POR_PERIODO: Record<Exclude<Frecuencia, "mes">, number> = {
  dia: 1,
  semana: 7,
  quincena: 15,
};

const FORMATO = /^(\d{4})-(\d{2})-(\d{2})$/;

function aUtc(fecha: Fecha): Date {
  const m = FORMATO.exec(fecha);
  if (!m) throw new Error(`Fecha inválida: ${fecha}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.toISOString().slice(0, 10) !== fecha) throw new Error(`Fecha inválida: ${fecha}`);
  return d;
}

const aFecha = (d: Date): Fecha => d.toISOString().slice(0, 10);

export function sumarDias(fecha: Fecha, dias: number): Fecha {
  const d = aUtc(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return aFecha(d);
}

/** Mismo día del mes; si no existe en el mes destino, el último día de ese mes. */
export function sumarMeses(fecha: Fecha, meses: number): Fecha {
  const d = aUtc(fecha);
  const dia = d.getUTCDate();
  const destino = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, 1));
  const ultimoDia = new Date(
    Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0),
  ).getUTCDate();
  destino.setUTCDate(Math.min(dia, ultimoDia));
  return aFecha(destino);
}

/**
 * Vencimiento del período `k` (1 = primera cuota) contado siempre desde la
 * fecha de desembolso, para que el ajuste a fin de mes no se arrastre
 * (31/01 → 28/02 → 31/03).
 */
export function vencimientoPeriodo(desembolso: Fecha, frecuencia: Frecuencia, k: number): Fecha {
  if (frecuencia === "mes") return sumarMeses(desembolso, k);
  return sumarDias(desembolso, DIAS_POR_PERIODO[frecuencia] * k);
}

/** Días que dura el plazo para frecuencias de días fijos (no aplica a "mes"). */
export function diasDelPlazo(frecuencia: Exclude<Frecuencia, "mes">, nCuotas: number): number {
  return DIAS_POR_PERIODO[frecuencia] * nCuotas;
}

/** Días corridos de `desde` a `hasta` (negativo si `hasta` es anterior). */
export function diasEntre(desde: Fecha, hasta: Fecha): number {
  return Math.round((aUtc(hasta).getTime() - aUtc(desde).getTime()) / 86_400_000);
}
