import { z } from "zod";
import { decimal, fecha } from "./validacion";

export const TIPOS_PAGO = {
  transferencia: "Transferencia",
  efectivo: "Efectivo",
} as const;

/** Montos por deuda como los manda la pantalla: `{ "<prestamo>:<cuota>": "1234.56" }` (punto decimal). */
const porDeuda = (mensaje: string) => z.string().transform((texto, ctx) => {
  let valor: unknown;
  try {
    valor = JSON.parse(texto || "{}");
  } catch {
    valor = null;
  }
  const r = z.record(z.string().regex(/^[0-9a-f-]{36}:([0-9a-f-]{36}|cargos)$/), z.string().regex(/^\d{1,18}(\.\d{1,2})?$/)).safeParse(valor);
  if (!r.success) {
    ctx.addIssue({ code: "custom", message: mensaje });
    return z.NEVER;
  }
  return r.data;
});

export const esquemaPago = z
  .object({
    clienteId: z.uuid("Elegí un cliente."),
    fecha,
    tipo: z.enum(["transferencia", "efectivo"], "Elegí el medio de cobro."),
    ars: z.string(),
    tcSalida: z.string(),
    metodo: z.string().trim().max(120, "Máximo 120 caracteres.").transform((v) => v || null),
    notas: z.string().trim().transform((v) => v || null),
    montos: porDeuda("La distribución del pago no es válida."),
    usarSaldo: z.string().transform((v) => v === "on"),
    descuentos: porDeuda("Los descuentos no son válidos."),
    motivoDescuento: z.string().trim().max(200, "Máximo 200 caracteres.").transform((v) => v || null),
  })
  .transform((d, ctx) => {
    if (Object.keys(d.descuentos).length && !d.motivoDescuento) {
      ctx.addIssue({ code: "custom", path: ["motivoDescuento"], message: "Indicá el motivo del descuento." });
      return z.NEVER;
    }
    // Solo aplicando saldo a favor el monto cobrado puede quedar vacío.
    const ars = decimal({ campo: "el monto cobrado", decimales: 2, maxEnteros: 18, min: d.usarSaldo ? "noNeg" : "pos" }).safeParse(
      d.usarSaldo && !d.ars.trim() ? "0" : d.ars,
    );
    if (!ars.success) {
      ctx.addIssue({ code: "custom", path: ["ars"], message: ars.error.issues[0]!.message });
      return z.NEVER;
    }
    if (d.tipo === "efectivo" || ars.data.isZero()) return { ...d, ars: ars.data, tcSalida: null };
    const tc = decimal({ campo: "el TC de liquidación", decimales: 6, maxEnteros: 14, min: "pos" }).safeParse(d.tcSalida);
    if (!tc.success) {
      ctx.addIssue({ code: "custom", path: ["tcSalida"], message: tc.error.issues[0]!.message });
      return z.NEVER;
    }
    return { ...d, ars: ars.data, tcSalida: tc.data };
  });

export type CamposPago = keyof z.input<typeof esquemaPago>;
