import { z } from "zod";
import { decimal, fecha } from "./validacion";

/** Lotes como los manda la pantalla: `{ "<pagoId>": "1234.56" }` (punto decimal). */
const lotes = z.string().transform((texto, ctx) => {
  let valor: unknown;
  try {
    valor = JSON.parse(texto || "{}");
  } catch {
    valor = null;
  }
  const r = z.record(z.uuid(), z.string().regex(/^\d{1,18}(\.\d{1,2})?$/)).safeParse(valor);
  if (!r.success) {
    ctx.addIssue({ code: "custom", message: "Los lotes no son válidos." });
    return z.NEVER;
  }
  return r.data;
});

export const esquemaConversion = z.object({
  fecha,
  ars: decimal({ campo: "el monto a convertir", decimales: 2, maxEnteros: 18, min: "pos" }),
  tc: decimal({ campo: "el TC de la conversión", decimales: 6, maxEnteros: 14, min: "pos" }),
  notas: z.string().trim().transform((v) => v || null),
  lotes,
});

export type CamposConversion = keyof z.input<typeof esquemaConversion>;
