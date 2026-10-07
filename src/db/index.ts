import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");

// Reusa la conexión entre recargas de `next dev`.
const globalForDb = globalThis as unknown as { pg?: postgres.Sql };
const client = globalForDb.pg ?? postgres(url);
if (process.env.NODE_ENV !== "production") globalForDb.pg = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;

/** Transacción de Drizzle (lo que recibe el callback de `db.transaction`). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
