import { z } from "zod";
import { decimal, fecha } from "./validacion";

export const esquemaAporte = z.object({
  fecha,
  socio: z.union([z.uuid(), z.literal("ambos")], "Elegí qué socio aporta."),
  usdt: decimal({ campo: "el monto en USDT", decimales: 8, maxEnteros: 12, min: "pos" }),
  notas: z.string().trim().max(200, "Máximo 200 caracteres.").transform((v) => v || null),
});

export type CamposAporte = keyof z.input<typeof esquemaAporte>;
