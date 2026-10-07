"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { insertarPrestamo } from "@/db/alta-prestamo";
import { clientes, participantes } from "@/db/schema";
import { escribir, usuarioActual } from "@/lib/auth";
import { esquemaPrestamo, type CamposPrestamo } from "@/lib/prestamos";

export type EstadoFormPrestamo = {
  error?: string;
  errores?: Partial<Record<CamposPrestamo, string>>;
};

const CAMPOS: CamposPrestamo[] = [
  "clienteId", "fechaDesembolso", "arsCapital", "tcEntrada", "tasaMensualPct", "frecuencia",
  "nCuotas", "tasaTotalPct", "moraPct", "diasGracia", "notas",
];

export async function crearPrestamo(_prev: EstadoFormPrestamo, form: FormData): Promise<EstadoFormPrestamo> {
  const usuario = await usuarioActual();
  const valores = Object.fromEntries(CAMPOS.map((c) => [c, String(form.get(c) ?? "")]));
  const parsed = esquemaPrestamo.safeParse(valores);
  if (!parsed.success) {
    const errores: EstadoFormPrestamo["errores"] = {};
    for (const issue of parsed.error.issues) errores[issue.path[0] as CamposPrestamo] ??= issue.message;
    return { errores };
  }
  const datos = parsed.data;

  const [cliente] = await db
    .select({ estado: clientes.estado })
    .from(clientes)
    .where(eq(clientes.id, datos.clienteId));
  if (!cliente) return { errores: { clienteId: "El cliente no existe." } };
  if (cliente.estado !== "activo") {
    return { errores: { clienteId: `El cliente está ${cliente.estado}: no se le pueden dar préstamos nuevos.` } };
  }

  const [sociedad] = await db
    .select({ id: participantes.id })
    .from(participantes)
    .where(eq(participantes.tipo, "sociedad"));
  if (!sociedad) return { error: "Falta el participante Sociedad (corré pnpm db:seed)." };

  const { id } = await escribir(
    usuario,
    (tx) => insertarPrestamo(tx, datos, { usuarioId: usuario.id, sociedadId: sociedad.id }),
    "Alta de préstamo",
  );

  revalidatePath("/prestamos");
  revalidatePath(`/clientes/${datos.clienteId}`);
  redirect(`/prestamos/${id}`);
}
