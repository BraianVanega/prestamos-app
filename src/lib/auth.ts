import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, type Tx } from "@/db";
import { usuarios } from "@/db/schema";
import { crearSupabase } from "@/lib/supabase/server";

export type Usuario = typeof usuarios.$inferSelect;

/**
 * Usuario logueado, verificado en el servidor: sesión válida de Supabase Auth y
 * mail presente y activo en `usuarios` (la lista de mails permitidos).
 * Sin sesión o sin permiso → /login.
 */
export const usuarioActual = cache(async (): Promise<Usuario> => {
  const supabase = await crearSupabase();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email.toLowerCase() : null;
  if (!email) redirect("/login");

  const [usuario] = await db
    .select()
    .from(usuarios)
    .where(and(eq(usuarios.email, email), eq(usuarios.activo, true)));
  if (!usuario) {
    await supabase.auth.signOut();
    redirect("/login?error=sin-permiso");
  }
  return usuario;
});

/**
 * Transacción de escritura con el usuario (y motivo) seteados para la auditoría.
 * Todo lo que forma una operación va adentro de una sola llamada.
 */
export async function escribir<T>(
  usuario: Pick<Usuario, "id">,
  fn: (tx: Tx) => Promise<T>,
  motivo?: string,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.usuario_id', ${usuario.id}, true)`);
    if (motivo) await tx.execute(sql`select set_config('app.motivo', ${motivo}, true)`);
    return fn(tx);
  });
}
