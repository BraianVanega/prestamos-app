"use server";

import { revalidatePath } from "next/cache";
import { anular, ErrorAnulacion } from "@/db/anulaciones";
import { escribir, usuarioActual } from "@/lib/auth";
import { esquemaAnulacion, type CamposAnulacion } from "@/lib/anulaciones";
import { hoyArgentina } from "@/lib/hoy";

export type EstadoAnulacion = {
  ok?: boolean;
  error?: string;
  errores?: Partial<Record<CamposAnulacion, string>>;
};

const CAMPOS: CamposAnulacion[] = ["entidad", "id", "motivo"];

export async function anularRegistro(_prev: EstadoAnulacion, form: FormData): Promise<EstadoAnulacion> {
  const usuario = await usuarioActual();
  const parsed = esquemaAnulacion.safeParse(Object.fromEntries(CAMPOS.map((c) => [c, String(form.get(c) ?? "")])));
  if (!parsed.success) {
    const errores: EstadoAnulacion["errores"] = {};
    for (const issue of parsed.error.issues) errores[issue.path[0] as CamposAnulacion] ??= issue.message;
    return { errores };
  }
  const { entidad, id, motivo } = parsed.data;
  try {
    await escribir(usuario, (tx) => anular(tx, entidad, { id, motivo }, { usuarioId: usuario.id, hoy: hoyArgentina() }), `Anulación: ${motivo}`);
  } catch (e) {
    if (e instanceof ErrorAnulacion) return { error: e.message };
    throw e;
  }
  // Una anulación cambia deuda, caja y cartera: se refresca toda la app.
  revalidatePath("/", "layout");
  return { ok: true };
}
