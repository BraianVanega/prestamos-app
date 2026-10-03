/**
 * Seed mínimo: usuario admin, participante 'Sociedad' y dos socios al 50%.
 * Idempotente: se puede correr varias veces (participantes no se borran nunca).
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "./index";
import { participantes, usuarios } from "./schema";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@cierre.local";
const ADMIN_NOMBRE = process.env.SEED_ADMIN_NOMBRE ?? "Administrador";

const SOCIOS = [
  { nombre: "Socio 1", pctSociedad: "50" },
  { nombre: "Socio 2", pctSociedad: "50" },
];

async function main() {
  await db.transaction(async (tx) => {
    await tx
      .insert(usuarios)
      .values({ email: ADMIN_EMAIL, nombre: ADMIN_NOMBRE, rol: "admin" })
      .onConflictDoNothing({ target: usuarios.email });
    const [admin] = await tx.select().from(usuarios).where(eq(usuarios.email, ADMIN_EMAIL));
    if (!admin) throw new Error("No se pudo crear el usuario admin");

    await tx.execute(sql`select set_config('app.usuario_id', ${admin.id}, true)`);
    await tx.execute(sql`select set_config('app.motivo', 'seed inicial', true)`);

    const [sociedad] = await tx
      .select({ id: participantes.id })
      .from(participantes)
      .where(eq(participantes.tipo, "sociedad"));
    if (!sociedad) {
      await tx.insert(participantes).values({ nombre: "Sociedad", tipo: "sociedad" });
    }

    for (const socio of SOCIOS) {
      const [existente] = await tx
        .select({ id: participantes.id })
        .from(participantes)
        .where(and(eq(participantes.tipo, "socio"), eq(participantes.nombre, socio.nombre)));
      if (!existente) {
        await tx.insert(participantes).values({ ...socio, tipo: "socio" });
      }
    }
  });

  const filas = await db
    .select({ nombre: participantes.nombre, tipo: participantes.tipo, pct: participantes.pctSociedad })
    .from(participantes);
  console.log(`Admin: ${ADMIN_EMAIL}`);
  console.table(filas);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
