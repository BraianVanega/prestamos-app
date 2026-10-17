import Decimal from "decimal.js";
import type { Frecuencia } from "@/engine/fechas";
import { formatearFecha } from "./formato";
import { formatearArs, formatearPct, formatearTc } from "./numeros";
import { FRECUENCIAS } from "./prestamos";

/** Lo que se carga en un préstamo y puede cambiar al editarlo. */
export interface CamposVersion {
  cliente: string;
  fechaDesembolso: string;
  arsCapital: Decimal.Value;
  tcEntrada: Decimal.Value;
  frecuencia: Frecuencia;
  nCuotas: number;
  tasaTotalPct: Decimal.Value;
  moraPct: Decimal.Value;
  diasGracia: number;
  /** Quién puso la plata, en texto ("Sociedad 80% · Juan 20%"). */
  estructura: string;
  notas: string | null;
}

export interface Diferencia {
  campo: string;
  antes: string;
  ahora: string;
}

const mora = (v: CamposVersion) =>
  new Decimal(v.moraPct).isZero() ? "Sin recargo" : `${formatearPct(v.moraPct)}% · ${v.diasGracia} días de gracia`;

const CAMPOS: [string, (v: CamposVersion) => string][] = [
  ["Cliente", (v) => v.cliente],
  ["Entregado el", (v) => formatearFecha(v.fechaDesembolso)],
  ["Capital", (v) => `$${formatearArs(v.arsCapital)}`],
  ["Dólar del préstamo", (v) => `$${formatearTc(v.tcEntrada)}`],
  ["Cuotas", (v) => `${v.nCuotas} ${v.nCuotas === 1 ? FRECUENCIAS[v.frecuencia].plural.replace(/es$|s$/, "") : FRECUENCIAS[v.frecuencia].plural}`],
  ["Tasa total", (v) => `${formatearPct(v.tasaTotalPct)}%`],
  ["Recargo por atraso", mora],
  ["Quién puso la plata", (v) => v.estructura],
  ["Notas", (v) => v.notas?.trim() || "—"],
];

/** Qué cambió entre dos versiones de un préstamo, en el orden del formulario. */
export function diferenciasPrestamo(antes: CamposVersion, ahora: CamposVersion): Diferencia[] {
  return CAMPOS.flatMap(([campo, texto]) => {
    const a = texto(antes);
    const b = texto(ahora);
    return a === b ? [] : [{ campo, antes: a, ahora: b }];
  });
}
