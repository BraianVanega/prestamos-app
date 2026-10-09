import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");

// Reusa la conexión entre recargas de `next dev`.
// `prepare: false`: en producción se conecta por el pooler de Supabase en modo
// transacción (puerto 6543), que no soporta prepared statements.
// En Vercel cada instancia es un proceso aparte (y se congela entre pedidos):
// pocas conexiones por instancia y se cierran al quedar inactivas, para no
// agotar el pooler.
const globalForDb = globalThis as unknown as { pg?: postgres.Sql };
const client = globalForDb.pg ?? postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 15 });
if (process.env.NODE_ENV !== "production") globalForDb.pg = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;

/** Transacción de Drizzle (lo que recibe el callback de `db.transaction`). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
