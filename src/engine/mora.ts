import Decimal from "decimal.js";
import { sumarDias, type Fecha } from "./fechas";
import { redondearArs } from "./redondeo";

/** Valores sugeridos en el alta; cada préstamo guarda los suyos (`mora_pct`, `dias_gracia`). */
export const MORA_PCT_SUGERIDA = "20";
export const DIAS_GRACIA_SUGERIDOS = 5;

export interface CuotaParaMora {
  cuotaId: string;
  vencimiento: Fecha;
  arsCapital: Decimal.Value;
  /** Imputaciones de capital vigentes (sin anular) a esta cuota. */
  pagosCapital: { fecha: Fecha; ars: Decimal.Value }[];
  /** Ya tiene un cargo de mora (aunque esté anulado: se cobra o se perdona una sola vez). */
  tieneMora: boolean;
}

export interface MoraACargar {
  cuotaId: string;
  /** Día en que nace la mora: el primero después de la gracia. */
  fecha: Fecha;
  /** Capital impago de la cuota al terminar la gracia. */
  base: Decimal;
  ars: Decimal;
}

/** Primer día con mora: vencimiento + días de gracia + 1. */
export function inicioMora(vencimiento: Fecha, diasGracia: number): Fecha {
  return sumarDias(vencimiento, diasGracia + 1);
}

/**
 * Mora que corresponde cargar a la fecha dada. Es un recargo único por cuota:
 * `mora_pct` × capital impago al terminar la gracia. Si el cliente pagó el
 * capital dentro de la gracia, no hay mora. El interés impago no genera mora.
 */
export function moraACargar(params: {
  fecha: Fecha;
  moraPct: Decimal.Value;
  diasGracia: number;
  cuotas: CuotaParaMora[];
}): MoraACargar[] {
  const { fecha, diasGracia } = params;
  if (!Number.isInteger(diasGracia) || diasGracia < 0) throw new Error("Los días de gracia deben ser un entero no negativo");
  const moraPct = new Decimal(params.moraPct);
  if (moraPct.lt(0)) throw new Error("La mora no puede ser negativa");

  const resultado: MoraACargar[] = [];
  for (const cuota of params.cuotas) {
    if (cuota.tieneMora) continue;
    const nace = inicioMora(cuota.vencimiento, diasGracia);
    if (fecha < nace) continue;

    const pagado = cuota.pagosCapital
      .filter((p) => p.fecha < nace)
      .reduce((acc, p) => acc.plus(p.ars), new Decimal(0));
    const base = Decimal.max(new Decimal(cuota.arsCapital).minus(pagado), 0);
    const ars = redondearArs(base.times(moraPct).div(100));
    if (ars.isZero()) continue;

    resultado.push({ cuotaId: cuota.cuotaId, fecha: nace, base, ars });
  }
  return resultado;
}
