"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { insertarPrestamo } from "@/db/alta-prestamo";
import { ErrorAnulacion } from "@/db/anulaciones";
import { corregirPrestamo as corregir } from "@/db/correccion-prestamo";
import { ErrorImputacion } from "@/db/registrar-pago";
import { clientes, participantes } from "@/db/schema";
import { escribir, usuarioActual } from "@/lib/auth";
import { hoyArgentina } from "@/lib/hoy";
import { esquemaMotivoCorreccion, esquemaPrestamo, type CamposPrestamo, type DatosPrestamoForm } from "@/lib/prestamos";

export type EstadoFormPrestamo = {
  error?: string;
  errores?: Partial<Record<CamposPrestamo | "motivo", string>>;
};

const CAMPOS: CamposPrestamo[] = [
  "clienteId", "fechaDesembolso", "arsCapital", "tcEntrada", "tasaMensualPct", "frecuencia",
  "nCuotas", "tasaTotalPct", "moraPct", "diasGracia", "notas",
];

/** Valida el formulario, el cliente y que exista la Sociedad (lo mismo para alta y corrección). */
async function validar(
  form: FormData,
  extra?: { motivo: string | undefined },
): Promise<{ estado: EstadoFormPrestamo } | { datos: DatosPrestamoForm; sociedadId: string }> {
  const valores = Object.fromEntries(CAMPOS.map((c) => [c, String(form.get(c) ?? "")]));
  const parsed = esquemaPrestamo.safeParse(valores);
  const errores: EstadoFormPrestamo["errores"] = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errores[issue.path[0] as CamposPrestamo] ??= issue.message;
  }
  if (extra?.motivo !== undefined) {
    const motivo = esquemaMotivoCorreccion.safeParse(extra.motivo);
    if (!motivo.success) errores.motivo = motivo.error.issues[0]!.message;
  }
  if (!parsed.success || errores.motivo) return { estado: { errores } };
  const datos = parsed.data;

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

  const { id } = await escribir(
    usuario,
    (tx) => insertarPrestamo(tx, datos, { usuarioId: usuario.id, sociedadId }),
    "Alta de préstamo",
  );

  revalidatePath("/prestamos");
  revalidatePath(`/clientes/${datos.clienteId}`);
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
  const v = await validar(form, { motivo });
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
    if (e instanceof ErrorAnulacion || e instanceof ErrorImputacion) return { error: e.message };
    throw e;
  }

  // Cambian caja, cartera y los préstamos de uno o dos clientes: se refresca toda la app.
  revalidatePath("/", "layout");
  redirect(`/prestamos/${nuevo.id}`);
}
