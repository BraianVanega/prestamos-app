"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ErrorImputacion, insertarPago } from "@/db/registrar-pago";
import { escribir, usuarioActual } from "@/lib/auth";
import { hoyArgentina } from "@/lib/hoy";
import { esquemaPago, type CamposPago } from "@/lib/pagos";

export type EstadoFormPago = {
  error?: string;
  errores?: Partial<Record<CamposPago, string>>;
};

const CAMPOS: CamposPago[] = ["clienteId", "fecha", "tipo", "ars", "tcSalida", "metodo", "notas", "montos"];

export async function registrarPago(_prev: EstadoFormPago, form: FormData): Promise<EstadoFormPago> {
  const usuario = await usuarioActual();
  const valores = Object.fromEntries(CAMPOS.map((c) => [c, String(form.get(c) ?? "")]));
  const parsed = esquemaPago.safeParse(valores);
  if (!parsed.success) {
    const errores: EstadoFormPago["errores"] = {};
    for (const issue of parsed.error.issues) errores[issue.path[0] as CamposPago] ??= issue.message;
    return { errores };
  }
  const d = parsed.data;
  if (d.fecha > hoyArgentina()) return { errores: { fecha: "La fecha no puede ser futura." } };

  let resultado: Awaited<ReturnType<typeof insertarPago>>;
  try {
    resultado = await escribir(
      usuario,
      (tx) =>
        insertarPago(
          tx,
          {
            clienteId: d.clienteId,
            fecha: d.fecha,
            tipo: d.tipo,
            ars: d.ars,
            tcSalida: d.tcSalida,
            metodo: d.metodo,
            notas: d.notas,
            montos: new Map(Object.entries(d.montos).map(([k, v]) => [k, new Decimal(v)])),
          },
          { usuarioId: usuario.id },
        ),
      "Registro de pago",
    );
  } catch (e) {
    if (e instanceof ErrorImputacion) return { error: e.message };
    throw e;
  }

  revalidatePath("/prestamos");
  revalidatePath("/clientes");
  revalidatePath("/pagos");
  for (const id of resultado.prestamos) revalidatePath(`/prestamos/${id}`);
  redirect(resultado.prestamos.length ? `/prestamos/${resultado.prestamos[0]}` : `/clientes/${d.clienteId}`);
}
