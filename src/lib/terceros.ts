import { z } from "zod";
import { decimal, fecha } from "./validacion";

/** Alta o edición de un tercero (fondeador). */
export const esquemaTercero = z.object({
  nombre: z.string().trim().min(2, "Ingresá el nombre.").max(120, "Máximo 120 caracteres."),
  pctDefault: z
    .string()
    .trim()
    .pipe(z.union([z.literal(""), decimal({ campo: "el % sugerido", decimales: 4, maxEnteros: 3, min: "pos" })]))
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || v.lte(100), "No puede pasar el 100%."),
  notas: z.string().trim().max(500, "Máximo 500 caracteres.").transform((v) => v || null),
  activo: z.enum(["si", "no"]).transform((v) => v === "si"),
});

export type CamposTercero = keyof z.input<typeof esquemaTercero>;

/** Pago a un tercero (sale de la caja USDT). */
export const esquemaPagoTercero = z.object({
  fecha,
  usdt: decimal({ campo: "el monto en USDT", decimales: 8, maxEnteros: 12, min: "pos" }),
  notas: z.string().trim().max(200, "Máximo 200 caracteres.").transform((v) => v || null),
});

export type CamposPagoTercero = keyof z.input<typeof esquemaPagoTercero>;
