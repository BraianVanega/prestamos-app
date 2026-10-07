import { z } from "zod";
import { decimal, fecha } from "./validacion";

export const TIPOS_PAGO = {
  transferencia: "Transferencia",
  efectivo: "Efectivo",
} as const;

/** Montos por deuda como los manda la pantalla: `{ "<prestamo>:<cuota>": "1234.56" }` (punto decimal). */
const montos = z.string().transform((texto, ctx) => {
  let valor: unknown;
  try {
    valor = JSON.parse(texto || "{}");
  } catch {
    valor = null;
  }
  const r = z.record(z.string().regex(/^[0-9a-f-]{36}:([0-9a-f-]{36}|cargos)$/), z.string().regex(/^\d{1,18}(\.\d{1,2})?$/)).safeParse(valor);
  if (!r.success) {
    ctx.addIssue({ code: "custom", message: "La distribución del pago no es válida." });
    return z.NEVER;
  }
  return r.data;
});

export const esquemaPago = z
  .object({
    clienteId: z.uuid("Elegí un cliente."),
    fecha,
    tipo: z.enum(["transferencia", "efectivo"], "Elegí el medio de cobro."),
    ars: decimal({ campo: "el monto cobrado", decimales: 2, maxEnteros: 18, min: "pos" }),
    tcSalida: z.string(),
    metodo: z.string().trim().max(120, "Máximo 120 caracteres.").transform((v) => v || null),
    notas: z.string().trim().transform((v) => v || null),
    montos,
  })
  .transform((d, ctx) => {
    if (d.tipo === "efectivo") return { ...d, tcSalida: null };
    const tc = decimal({ campo: "el TC de liquidación", decimales: 6, maxEnteros: 14, min: "pos" }).safeParse(d.tcSalida);
    if (!tc.success) {
      ctx.addIssue({ code: "custom", path: ["tcSalida"], message: tc.error.issues[0]!.message });
      return z.NEVER;
    }
    return { ...d, tcSalida: tc.data };
  });

export type CamposPago = keyof z.input<typeof esquemaPago>;
