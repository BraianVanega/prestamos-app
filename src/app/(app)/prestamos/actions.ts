"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { ErrorAltaPrestamo, insertarPrestamo, type AltaPrestamo } from "@/db/alta-prestamo";
import { ErrorAnulacion } from "@/db/anulaciones";
import { corregirPrestamo as corregir } from "@/db/correccion-prestamo";
import { ErrorImputacion } from "@/db/registrar-pago";
import { clientes, participantes, prestamoParticipaciones } from "@/db/schema";
import { escribir, usuarioActual } from "@/lib/auth";
import { hoyArgentina } from "@/lib/hoy";
import { esquemaMotivoCorreccion, esquemaPrestamo, esquemaTercerosPrestamo, type CamposPrestamo } from "@/lib/prestamos";

export type EstadoFormPrestamo = {
  error?: string;
  errores?: Partial<Record<CamposPrestamo | "motivo" | "terceros", string>>;
};

const CAMPOS: CamposPrestamo[] = [
  "clienteId", "fechaDesembolso", "arsCapital", "tcEntrada", "tasaMensualPct", "frecuencia",
  "nCuotas", "tasaTotalPct", "moraPct", "diasGracia", "notas",
];

/**
 * Valida el formulario, el cliente, los terceros y que exista la Sociedad (lo
 * mismo para alta y corrección). Al corregir, `tercerosActuales` son los del
 * préstamo original: siguen valiendo aunque ya estén inactivos.
 */
async function validar(
  form: FormData,
  extra?: { motivo: string | undefined; tercerosActuales?: string[] },
): Promise<{ estado: EstadoFormPrestamo } | { datos: AltaPrestamo; sociedadId: string }> {
  const valores = Object.fromEntries(CAMPOS.map((c) => [c, String(form.get(c) ?? "")]));
  const parsed = esquemaPrestamo.safeParse(valores);
  const errores: EstadoFormPrestamo["errores"] = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errores[issue.path[0] as CamposPrestamo] ??= issue.message;
  }
  const ids = form.getAll("terceroId").map(String);
  const pcts = form.getAll("terceroPct").map(String);
  const terceros = esquemaTercerosPrestamo.safeParse(ids.map((participanteId, i) => ({ participanteId, pct: pcts[i] ?? "" })));
  if (!terceros.success) errores.terceros = terceros.error.issues[0]!.message;
  if (extra?.motivo !== undefined) {
    const motivo = esquemaMotivoCorreccion.safeParse(extra.motivo);
    if (!motivo.success) errores.motivo = motivo.error.issues[0]!.message;
  }
  if (!parsed.success || !terceros.success || errores.motivo) return { estado: { errores } };
  const datos: AltaPrestamo = { ...parsed.data, terceros: terceros.data };

  if (terceros.data.length) {
    const validos = await db
      .select({ id: participantes.id, activo: participantes.activo })
      .from(participantes)
      .where(and(inArray(participantes.id, terceros.data.map((t) => t.participanteId)), eq(participantes.tipo, "fondeador")));
    const ok = terceros.data.every((t) => {
      const v = validos.find((x) => x.id === t.participanteId);
      return v && (v.activo || extra?.tercerosActuales?.includes(t.participanteId));
    });
    if (!ok) return { estado: { errores: { terceros: "Alguno de los terceros no existe o está inactivo." } } };
  }

  const [cliente] = await db
    .select({ estado: clientes.estado })
    .from(clientes)
    .where(eq(clientes.id, datos.clienteId));
  if (!cliente) return { estado: { errores: { clienteId: "El cliente no existe." } } };
  if (cliente.estado !== "activo") {
    return { estado: { errores: { clienteId: `El cliente está ${cliente.estado}: no se le pueden dar préstamos nuevos.` } } };
  }

  const [sociedad] = await db
    .select({ id: participantes.id })
    .from(participantes)
    .where(eq(participantes.tipo, "sociedad"));
  if (!sociedad) return { estado: { error: "Falta el participante Sociedad (corré pnpm db:seed)." } };
  return { datos, sociedadId: sociedad.id };
}

export async function crearPrestamo(_prev: EstadoFormPrestamo, form: FormData): Promise<EstadoFormPrestamo> {
  const usuario = await usuarioActual();
  const v = await validar(form);
  if ("estado" in v) return v.estado;
  const { datos, sociedadId } = v;

  let id: string;
  try {
    ({ id } = await escribir(
      usuario,
      (tx) => insertarPrestamo(tx, datos, { usuarioId: usuario.id, sociedadId }),
      "Alta de préstamo",
    ));
  } catch (e) {
    if (e instanceof ErrorAltaPrestamo) return { error: e.message };
    throw e;
  }

  revalidatePath("/prestamos");
  revalidatePath(`/clientes/${datos.clienteId}`);
  if (datos.terceros?.length) revalidatePath("/terceros", "layout");
  redirect(`/prestamos/${id}`);
}

/**
 * Edita un préstamo: en una sola transacción anula el original y da de alta el
 * corregido, vinculado. Si tiene cobros, se vuelven a imputar sobre el nuevo
 * (lo cobrado no cambia; ver `corregirPrestamo` en db).
 */
export async function corregirPrestamo(id: string, _prev: EstadoFormPrestamo, form: FormData): Promise<EstadoFormPrestamo> {
  const usuario = await usuarioActual();
  const motivo = String(form.get("motivo") ?? "");
  const actuales = await db
    .select({ id: prestamoParticipaciones.participanteId })
    .from(prestamoParticipaciones)
    .where(eq(prestamoParticipaciones.prestamoId, id));
  const v = await validar(form, { motivo, tercerosActuales: actuales.map((a) => a.id) });
  if ("estado" in v) return v.estado;
  const { datos, sociedadId } = v;
  const motivoLimpio = motivo.trim();

  let nuevo: { id: string };
  try {
    nuevo = await escribir(
      usuario,
      (tx) => corregir(tx, { id, datos, motivo: motivoLimpio }, { usuarioId: usuario.id, hoy: hoyArgentina(), sociedadId }),
      `Corrección de préstamo: ${motivoLimpio}`,
    );
  } catch (e) {
    if (e instanceof ErrorAnulacion || e instanceof ErrorImputacion || e instanceof ErrorAltaPrestamo) return { error: e.message };
    throw e;
  }

  // Cambian caja, cartera y los préstamos de uno o dos clientes: se refresca toda la app.
  revalidatePath("/", "layout");
  redirect(`/prestamos/${nuevo.id}`);
}
