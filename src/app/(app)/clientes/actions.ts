"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clientes } from "@/db/schema";
import { escribir, usuarioActual } from "@/lib/auth";
import { esquemaCliente, type CamposCliente } from "@/lib/clientes";

export type EstadoFormCliente = {
  error?: string;
  errores?: Partial<Record<CamposCliente, string>>;
  valores?: Partial<Record<CamposCliente, string>>;
};

const CAMPOS: CamposCliente[] = [
  "nombre", "documento", "telefono", "email", "direccion", "actividad", "referencias", "estado", "notas",
];

function leerForm(form: FormData) {
  return Object.fromEntries(CAMPOS.map((c) => [c, String(form.get(c) ?? "")])) as Record<CamposCliente, string>;
}

/** postgres-js informa la violación de unicidad con code 23505; Drizzle la envuelve en `cause`. */
function violaUnico(err: unknown, constraint: string): boolean {
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: string; constraint_name?: string };
    if (pg.code === "23505" && pg.constraint_name === constraint) return true;
  }
  return false;
}

async function guardar(form: FormData, id?: string): Promise<EstadoFormCliente> {
  const usuario = await usuarioActual();
  const valores = leerForm(form);
  const parsed = esquemaCliente.safeParse(valores);
  if (!parsed.success) {
    const errores: EstadoFormCliente["errores"] = {};
    for (const issue of parsed.error.issues) {
      const campo = issue.path[0] as CamposCliente;
      errores[campo] ??= issue.message;
    }
    return { errores, valores };
  }

  let clienteId = id;
  try {
    await escribir(usuario, async (tx) => {
      if (id) {
        const [fila] = await tx.update(clientes).set(parsed.data).where(eq(clientes.id, id)).returning({ id: clientes.id });
        if (!fila) throw new Error("Cliente inexistente");
      } else {
        const [fila] = await tx
          .insert(clientes)
          .values({ ...parsed.data, creadoPor: usuario.id })
          .returning({ id: clientes.id });
        clienteId = fila!.id;
      }
    });
  } catch (err) {
    if (violaUnico(err, "clientes_documento_uq")) {
      return { errores: { documento: "Ya hay un cliente con ese documento." }, valores };
    }
    throw err;
  }

  revalidatePath("/clientes");
  redirect(`/clientes/${clienteId}`);
}

export async function crearCliente(_prev: EstadoFormCliente, form: FormData) {
  return guardar(form);
}

export async function actualizarCliente(id: string, _prev: EstadoFormCliente, form: FormData) {
  return guardar(form, id);
}
