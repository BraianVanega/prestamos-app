import Decimal from "decimal.js";
import { z } from "zod";
import { tasaMensualEquivalente } from "@/engine/cronograma";
import type { Frecuencia } from "@/engine/fechas";
import { decimal, entero, fecha } from "./validacion";

export const FRECUENCIAS: Record<Frecuencia, { etiqueta: string; plural: string }> = {
  dia: { etiqueta: "Diaria (1 día)", plural: "diarias" },
  semana: { etiqueta: "Semanal (7 días)", plural: "semanales" },
  quincena: { etiqueta: "Quincenal (15 días)", plural: "quincenales" },
  mes: { etiqueta: "Mensual (mismo día)", plural: "mensuales" },
};

export const esquemaPrestamo = z.object({
  clienteId: z.uuid("Elegí un cliente."),
  fechaDesembolso: fecha,
  arsCapital: decimal({ campo: "el capital", decimales: 2, maxEnteros: 18, min: "pos" }),
  tcEntrada: decimal({ campo: "el TC de entrada", decimales: 6, maxEnteros: 14, min: "pos" }),
  frecuencia: z.enum(["dia", "semana", "quincena", "mes"], "Elegí la frecuencia."),
  nCuotas: entero("la cantidad de cuotas", 1, 365),
  tasaTotalPct: decimal({ campo: "la tasa", decimales: 4, maxEnteros: 5, min: "noNeg" }),
  moraPct: decimal({ campo: "la mora", decimales: 4, maxEnteros: 5, min: "noNeg" }),
  diasGracia: entero("los días de gracia", 0, 365),
  notas: z
    .string()
    .trim()
    .transform((v) => v || null),
})
  // La tasa que se carga es la del préstamo completo; la mensual se deriva (solo informativa).
  .transform((d, ctx) => {
    const tasaMensualPct = tasaMensualEquivalente(d.tasaTotalPct, d.frecuencia, d.nCuotas);
    if (tasaMensualPct.gte(100000)) {
      ctx.issues.push({ code: "custom", path: ["tasaTotalPct"], message: "La tasa es demasiado alta para un plazo tan corto.", input: d.tasaTotalPct });
      return z.NEVER;
    }
    return { ...d, tasaMensualPct };
  });

export type CamposPrestamo = keyof z.input<typeof esquemaPrestamo>;
export type DatosPrestamoForm = z.output<typeof esquemaPrestamo>;

/** "#PR-1082" */
export const numeroPrestamo = (n: number) => `#PR-${String(n).padStart(4, "0")}`;

/** Motivo obligatorio al corregir un préstamo (queda en la anulación del original). */
export const esquemaMotivoCorreccion = z
  .string()
  .trim()
  .min(3, "Indicá qué se corrige (mínimo 3 caracteres).")
  .max(200, "Máximo 200 caracteres.");

/**
 * Terceros que ponen plata en el préstamo (filas del formulario). Cada uno una
 * vez, con % > 0; entre todos no pasan el 100% (el resto es de la Sociedad).
 */
export const esquemaTercerosPrestamo = z
  .array(
    z.object({
      participanteId: z.uuid("Elegí el tercero."),
      pct: decimal({ campo: "el % del tercero", decimales: 4, maxEnteros: 3, min: "pos" }),
    }),
  )
  .superRefine((filas, ctx) => {
    const ids = filas.map((f) => f.participanteId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Cada tercero va una sola vez." });
    const suma = filas.reduce((s, f) => s.plus(f.pct), new Decimal(0));
    if (suma.gt(100)) ctx.addIssue({ code: "custom", message: "Los terceros suman más del 100%." });
  });

export type TerceroPrestamo = z.output<typeof esquemaTercerosPrestamo>[number];
