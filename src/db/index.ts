import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");

// Reusa el pool entre recargas de `next dev`.
// Driver `pg`: en producción se conecta por el pooler de Supabase en modo
// transacción (puerto 6543). postgres.js encolaba varias consultas en la misma
// conexión (pipelining) y con ese pooler quedaban colgadas para siempre (el
// Overview, con ~15 consultas en paralelo, no cargaba); `pg` manda una por vez.
// Las inactivas se cierran: en Vercel la instancia se congela entre pedidos.
const globalForDb = globalThis as unknown as { pg?: Pool };
const pool = globalForDb.pg ?? new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 15_000 });
if (process.env.NODE_ENV !== "production") globalForDb.pg = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;

/** Transacción de Drizzle (lo que recibe el callback de `db.transaction`). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
