/**
 * La Data API de Supabase (roles anon / authenticated) no tiene acceso a las
 * tablas de la app (drizzle/0002_rls_sin_data_api.sql).
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let sql: postgres.Sql;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (.env.local)");
  sql = postgres(url, { max: 1, onnotice: () => {} });
});

afterAll(async () => {
  await sql?.end();
});

describe("acceso desde la Data API", () => {
  it("todas las tablas de public tienen RLS activado", async () => {
    const sinRls = await sql`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(sinRls.map((r) => r.relname)).toEqual([]);
  });

  for (const rol of ["anon", "authenticated"]) {
    it(`${rol} no puede leer ni escribir`, async () => {
      const tx = await sql.reserve();
      try {
        await tx`begin`;
        await tx.unsafe(`set local role ${rol}`);
        await expect(tx`select count(*) from prestamos`).rejects.toThrow(/permission denied/);
      } finally {
        await tx`rollback`.catch(() => {});
        tx.release();
      }
    });
  }
});
