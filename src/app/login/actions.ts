"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { crearSupabase } from "@/lib/supabase/server";

export type EstadoLogin = { error?: string; email?: string };

const CREDENCIALES_INVALIDAS = "Mail o contraseña incorrectos.";

export async function ingresar(_prev: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Completá el mail y la contraseña.", email };

  // Solo los mails de `usuarios` activos pueden entrar; mismo mensaje para no revelar cuáles son.
  const [permitido] = await db
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(and(eq(usuarios.email, email), eq(usuarios.activo, true)));
  if (!permitido) return { error: CREDENCIALES_INVALIDAS, email };

  const supabase = await crearSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: CREDENCIALES_INVALIDAS, email };

  redirect("/");
}

export async function salir() {
  const supabase = await crearSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
