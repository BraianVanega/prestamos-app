/**
 * Seed mínimo: los 2 usuarios (perfil en `usuarios` + cuenta en Supabase Auth),
 * participante 'Sociedad' y dos socios al 50%, cada uno vinculado a su usuario.
 * Idempotente: se puede correr varias veces. La contraseña solo se setea al crear
 * la cuenta en Auth; si ya existe no se toca (puede haberla cambiado el usuario).
 */
import { createClient } from "@supabase/supabase-js";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./index";
import { participantes, usuarios } from "./schema";

const SOCIOS = [
  { nombre: "Socio 1", pctSociedad: "50", email: "kevinvanegaa@gmail.com", envPassword: "SEED_PASSWORD_SOCIO_1" },
  { nombre: "Socio 2", pctSociedad: "50", email: "kevinisaias99@yahoo.com", envPassword: "SEED_PASSWORD_SOCIO_2" },
];

const nombreDesdeEmail = (email: string) => email.split("@")[0]!;

async function crearCuentasAuth() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Faltan SUPABASE_URL / SUPABASE_SECRET_KEY");
  const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const existentes = new Set(data.users.map((u) => u.email?.toLowerCase()));

  for (const socio of SOCIOS) {
    if (existentes.has(socio.email)) {
      console.log(`Auth: ${socio.email} ya existe (contraseña sin cambios)`);
      continue;
    }
    const password = process.env[socio.envPassword];
    if (!password) throw new Error(`Falta ${socio.envPassword} para crear la cuenta de ${socio.email}`);
    const { error: errCrear } = await supabase.auth.admin.createUser({
      email: socio.email,
      password,
      email_confirm: true,
    });
    if (errCrear) throw new Error(`No se pudo crear ${socio.email}: ${errCrear.message}`);
    console.log(`Auth: ${socio.email} creado`);
  }
}

async function main() {
  await crearCuentasAuth();

  await db.transaction(async (tx) => {
    for (const socio of SOCIOS) {
      await tx
        .insert(usuarios)
        .values({ email: socio.email, nombre: nombreDesdeEmail(socio.email), rol: "admin" })
        .onConflictDoNothing({ target: usuarios.email });
    }
    const [primero] = await tx.select().from(usuarios).where(eq(usuarios.email, SOCIOS[0]!.email));
    if (!primero) throw new Error("No se pudo crear el usuario");

    await tx.execute(sql`select set_config('app.usuario_id', ${primero.id}, true)`);
    await tx.execute(sql`select set_config('app.motivo', 'seed inicial', true)`);

    const [sociedad] = await tx
      .select({ id: participantes.id })
      .from(participantes)
      .where(eq(participantes.tipo, "sociedad"));
    if (!sociedad) {
      await tx.insert(participantes).values({ nombre: "Sociedad", tipo: "sociedad" });
    }

    for (const socio of SOCIOS) {
      const [usuario] = await tx.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, socio.email));
      const [existente] = await tx
        .select({ id: participantes.id, usuarioId: participantes.usuarioId })
        .from(participantes)
        .where(and(eq(participantes.tipo, "socio"), eq(participantes.nombre, socio.nombre)));
      if (!existente) {
        await tx.insert(participantes).values({
          nombre: socio.nombre,
          tipo: "socio",
          pctSociedad: socio.pctSociedad,
          usuarioId: usuario!.id,
        });
      } else if (!existente.usuarioId) {
        await tx.update(participantes).set({ usuarioId: usuario!.id }).where(eq(participantes.id, existente.id));
      }
    }
  });

  const filas = await db
    .select({
      nombre: participantes.nombre,
      tipo: participantes.tipo,
      pct: participantes.pctSociedad,
      usuario: usuarios.email,
    })
    .from(participantes)
    .leftJoin(usuarios, eq(usuarios.id, participantes.usuarioId));
  console.table(filas);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
