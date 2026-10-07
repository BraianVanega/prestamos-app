import Decimal from "decimal.js";
import { diasDelPlazo, vencimientoPeriodo, type Fecha, type Frecuencia } from "./fechas";
import { redondearArs, redondearPct, redondearUsdt } from "./redondeo";

/** Meses del plazo: cantidad de cuotas si es mensual; si no, días / 30. */
export function mesesDelPlazo(frecuencia: Frecuencia, nCuotas: number): Decimal {
  if (frecuencia === "mes") return new Decimal(nCuotas);
  return new Decimal(diasDelPlazo(frecuencia, nCuotas)).div(30);
}

/** Tasa del plazo completo sugerida = tasa mensual × meses (editable en el alta). */
export function tasaTotalSugerida(
  tasaMensualPct: Decimal.Value,
  frecuencia: Frecuencia,
  nCuotas: number,
): Decimal {
  return redondearPct(new Decimal(tasaMensualPct).times(mesesDelPlazo(frecuencia, nCuotas)));
}

export interface DatosPrestamo {
  arsCapital: Decimal.Value;
  tcEntrada: Decimal.Value;
  tasaTotalPct: Decimal.Value;
  fechaDesembolso: Fecha;
  frecuencia: Frecuencia;
  nCuotas: number;
}

export interface CuotaPlan {
  numero: number;
  vencimiento: Fecha;
  arsCapital: Decimal;
  arsInteres: Decimal;
}

export interface PlanPrestamo {
  /** round(ars_capital / tc_entrada, 8), igual al CHECK `usdt_prestado_ok`. */
  usdtPrestado: Decimal;
  /** round(ars_capital × tasa_total_pct / 100, 2), igual al CHECK `interes_pactado_ok`. */
  arsInteresPactado: Decimal;
  arsTotal: Decimal;
  vencimientoFinal: Fecha;
  cuotas: CuotaPlan[];
}

/** Reparte en partes iguales a 2 decimales; la diferencia de redondeo va a la última. */
function repartirEnPartesIguales(total: Decimal, n: number): Decimal[] {
  const parte = redondearArs(total.div(n));
  const ultima = total.minus(parte.times(n - 1));
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? ultima : parte));
}

export function calcularPlan(datos: DatosPrestamo): PlanPrestamo {
  const { fechaDesembolso, frecuencia, nCuotas } = datos;
  if (!Number.isInteger(nCuotas) || nCuotas < 1) throw new Error("La cantidad de cuotas debe ser un entero mayor a 0");

  const arsCapital = new Decimal(datos.arsCapital);
  const tcEntrada = new Decimal(datos.tcEntrada);
  const tasaTotalPct = new Decimal(datos.tasaTotalPct);
  if (arsCapital.lte(0)) throw new Error("El capital debe ser mayor a 0");
  if (tcEntrada.lte(0)) throw new Error("El TC de entrada debe ser mayor a 0");
  if (tasaTotalPct.lt(0)) throw new Error("La tasa no puede ser negativa");

  const usdtPrestado = redondearUsdt(arsCapital.div(tcEntrada));
  const arsInteresPactado = redondearArs(arsCapital.times(tasaTotalPct).div(100));

  const capitales = repartirEnPartesIguales(arsCapital, nCuotas);
  const intereses = repartirEnPartesIguales(arsInteresPactado, nCuotas);
  const cuotas = capitales.map((capital, i) => ({
    numero: i + 1,
    vencimiento: vencimientoPeriodo(fechaDesembolso, frecuencia, i + 1),
    arsCapital: capital,
    arsInteres: intereses[i]!,
  }));

  return {
    usdtPrestado,
    arsInteresPactado,
    arsTotal: arsCapital.plus(arsInteresPactado),
    vencimientoFinal: cuotas[cuotas.length - 1]!.vencimiento,
    cuotas,
  };
}

export interface ProyeccionUsdt {
  /** Total a cobrar convertido al TC de entrada: la meta en USDT si el TC no se mueve. */
  totalUsdt: Decimal;
  /** Interés pactado al TC de entrada: ganancia proyectada (no realizada). */
  gananciaUsdt: Decimal;
  /** Tasa nominal anual = tasa mensual × 12. */
  tnaPct: Decimal;
  cuotas: { numero: number; totalArs: Decimal; totalUsdt: Decimal }[];
}

/**
 * Proyección del plan en USDT al TC de entrada, solo para mostrar en el alta.
 * La ganancia real se reconoce al cobrar, por recuperación de costo en USDT.
 */
export function proyectarUsdt(plan: PlanPrestamo, tcEntrada: Decimal.Value, tasaMensualPct: Decimal.Value): ProyeccionUsdt {
  const tc = new Decimal(tcEntrada);
  return {
    totalUsdt: redondearUsdt(plan.arsTotal.div(tc)),
    gananciaUsdt: redondearUsdt(plan.arsInteresPactado.div(tc)),
    tnaPct: redondearPct(new Decimal(tasaMensualPct).times(12)),
    cuotas: plan.cuotas.map((c) => {
      const totalArs = c.arsCapital.plus(c.arsInteres);
      return { numero: c.numero, totalArs, totalUsdt: redondearUsdt(totalArs.div(tc)) };
    }),
  };
}
