"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ErrorAporte, insertarAporte } from "@/db/socios";
import { escribir, usuarioActual } from "@/lib/auth";
import { esquemaAporte, type CamposAporte } from "@/lib/aportes";
import { hoyArgentina } from "@/lib/hoy";

export type EstadoFormAporte = {
  error?: string;
  errores?: Partial<Record<CamposAporte, string>>;
};

const CAMPOS: CamposAporte[] = ["fecha", "socio", "usdt", "notas"];

export async function registrarAporte(_prev: EstadoFormAporte, form: FormData): Promise<EstadoFormAporte> {
  const usuario = await usuarioActual();
  const parsed = esquemaAporte.safeParse(Object.fromEntries(CAMPOS.map((c) => [c, String(form.get(c) ?? "")])));
  if (!parsed.success) {
    const errores: EstadoFormAporte["errores"] = {};
    for (const issue of parsed.error.issues) errores[issue.path[0] as CamposAporte] ??= issue.message;
    return { errores };
  }
  const d = parsed.data;
  if (d.fecha > hoyArgentina()) return { errores: { fecha: "La fecha no puede ser futura." } };

  let id: string;
  try {
    ({ transaccionId: id } = await escribir(usuario, (tx) => insertarAporte(tx, d, { usuarioId: usuario.id }), "Aporte de socio"));
  } catch (e) {
    if (e instanceof ErrorAporte) return { error: e.message };
    throw e;
  }
  revalidatePath("/socios");
  revalidatePath("/");
  redirect(`/socios?aporte=${id}`);
}
