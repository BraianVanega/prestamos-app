"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ErrorTercero, actualizarTercero as actualizar, insertarPagoTercero, insertarTercero } from "@/db/terceros";
import { escribir, usuarioActual } from "@/lib/auth";
import { hoyArgentina } from "@/lib/hoy";
import { esquemaPagoTercero, esquemaTercero, type CamposPagoTercero, type CamposTercero } from "@/lib/terceros";

export type EstadoFormTercero = {
  error?: string;
  errores?: Partial<Record<CamposTercero, string>>;
};

export type EstadoFormPagoTercero = {
  error?: string;
  errores?: Partial<Record<CamposPagoTercero, string>>;
};

const CAMPOS_TERCERO: CamposTercero[] = ["nombre", "pctDefault", "notas", "activo"];
const CAMPOS_PAGO: CamposPagoTercero[] = ["fecha", "usdt", "notas"];

const leer = <C extends string>(form: FormData, campos: C[]) => Object.fromEntries(campos.map((c) => [c, String(form.get(c) ?? "")]));

function erroresDe<C extends string>(issues: { path: PropertyKey[]; message: string }[]) {
  const errores: Partial<Record<C, string>> = {};
  for (const issue of issues) errores[issue.path[0] as C] ??= issue.message;
  return errores;
}

export async function crearTercero(_prev: EstadoFormTercero, form: FormData): Promise<EstadoFormTercero> {
  const usuario = await usuarioActual();
  const parsed = esquemaTercero.safeParse({ ...leer(form, CAMPOS_TERCERO), activo: "si" });
  if (!parsed.success) return { errores: erroresDe<CamposTercero>(parsed.error.issues) };

  const { id } = await escribir(usuario, (tx) => insertarTercero(tx, parsed.data), "Alta de tercero");
  revalidatePath("/terceros");
  redirect(`/terceros/${id}`);
}

export async function actualizarTercero(id: string, _prev: EstadoFormTercero, form: FormData): Promise<EstadoFormTercero> {
  const usuario = await usuarioActual();
  const parsed = esquemaTercero.safeParse(leer(form, CAMPOS_TERCERO));
  if (!parsed.success) return { errores: erroresDe<CamposTercero>(parsed.error.issues) };

  try {
    await escribir(usuario, (tx) => actualizar(tx, id, parsed.data), "Edición de tercero");
  } catch (e) {
    if (e instanceof ErrorTercero) return { error: e.message };
    throw e;
  }
  revalidatePath("/terceros", "layout");
  redirect(`/terceros/${id}`);
}

export async function registrarPagoTercero(terceroId: string, _prev: EstadoFormPagoTercero, form: FormData): Promise<EstadoFormPagoTercero> {
  const usuario = await usuarioActual();
  const parsed = esquemaPagoTercero.safeParse(leer(form, CAMPOS_PAGO));
  if (!parsed.success) return { errores: erroresDe<CamposPagoTercero>(parsed.error.issues) };
  const hoy = hoyArgentina();
  if (parsed.data.fecha > hoy) return { errores: { fecha: "La fecha no puede ser futura." } };

  let id: string;
  try {
    ({ transaccionId: id } = await escribir(
      usuario,
      (tx) => insertarPagoTercero(tx, { terceroId, ...parsed.data }, { usuarioId: usuario.id, hoy }),
      "Pago a tercero",
    ));
  } catch (e) {
    if (e instanceof ErrorTercero) return { error: e.message };
    throw e;
  }
  // Cambia la caja: Overview y Socios también.
  revalidatePath("/", "layout");
  redirect(`/terceros/${terceroId}?pago=${id}`);
}
