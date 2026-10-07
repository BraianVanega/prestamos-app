import { z } from "zod";
import { parsearDecimal } from "./numeros";

/** Decimal desde texto es-AR, con límites de las columnas `numeric` de la base. */
export const decimal = (o: { campo: string; decimales: number; maxEnteros: number; min?: "pos" | "noNeg" }) =>
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

export const entero = (campo: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, `Ingresá ${campo} (número entero).`)
    .transform((v) => Number.parseInt(v, 10))
    .refine((n) => n >= min && n <= max, `Tiene que estar entre ${min} y ${max}.`);

export const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Elegí una fecha.")
  .refine((f) => new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f, "La fecha no es válida.");
