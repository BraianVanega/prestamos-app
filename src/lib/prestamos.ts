import { z } from "zod";
import type { Frecuencia } from "@/engine/fechas";
import { parsearDecimal } from "./numeros";

export const FRECUENCIAS: Record<Frecuencia, { etiqueta: string; plural: string }> = {
  dia: { etiqueta: "Diaria (1 día)", plural: "diarias" },
  semana: { etiqueta: "Semanal (7 días)", plural: "semanales" },
  quincena: { etiqueta: "Quincenal (15 días)", plural: "quincenales" },
  mes: { etiqueta: "Mensual (mismo día)", plural: "mensuales" },
};

/** Decimal desde texto es-AR, con límites de las columnas `numeric` de la base. */
const decimal = (o: { campo: string; decimales: number; maxEnteros: number; min?: "pos" | "noNeg" }) =>
  z.string().transform((texto, ctx) => {
    const d = parsearDecimal(texto);
    if (!d) {
      ctx.addIssue({ code: "custom", message: `Ingresá ${o.campo}.` });
      return z.NEVER;
    }
    if (d.decimalPlaces() > o.decimales) {
      ctx.addIssue({ code: "custom", message: `Usá como máximo ${o.decimales} decimales.` });
      return z.NEVER;
    }
    if (d.abs().trunc().toString().length > o.maxEnteros) {
      ctx.addIssue({ code: "custom", message: "El número es demasiado grande." });
      return z.NEVER;
    }
    if (o.min === "pos" && d.lte(0)) {
      ctx.addIssue({ code: "custom", message: "Tiene que ser mayor a 0." });
      return z.NEVER;
    }
    if (o.min === "noNeg" && d.lt(0)) {
      ctx.addIssue({ code: "custom", message: "No puede ser negativo." });
      return z.NEVER;
    }
    return d;
  });

const entero = (campo: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, `Ingresá ${campo} (número entero).`)
    .transform((v) => Number.parseInt(v, 10))
    .refine((n) => n >= min && n <= max, `Tiene que estar entre ${min} y ${max}.`);

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Elegí una fecha.")
  .refine((f) => new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f, "La fecha no es válida.");

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
