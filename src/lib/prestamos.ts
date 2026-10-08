import { z } from "zod";
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
  tasaMensualPct: decimal({ campo: "la tasa mensual", decimales: 4, maxEnteros: 5, min: "noNeg" }),
  frecuencia: z.enum(["dia", "semana", "quincena", "mes"], "Elegí la frecuencia."),
  nCuotas: entero("la cantidad de cuotas", 1, 365),
  tasaTotalPct: decimal({ campo: "la tasa total", decimales: 4, maxEnteros: 5, min: "noNeg" }),
  moraPct: decimal({ campo: "la mora", decimales: 4, maxEnteros: 5, min: "noNeg" }),
  diasGracia: entero("los días de gracia", 0, 365),
  notas: z
    .string()
    .trim()
    .transform((v) => v || null),
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
