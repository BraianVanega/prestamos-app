/**
 * Integridad garantizada por la base (drizzle/0001_triggers.sql).
 *
 * Cada caso corre en su propia transacción sobre una conexión reservada y
 * nunca deja datos: o falla (y Postgres revierte) o termina en ROLLBACK.
 * Los controles positivos usan `set constraints all immediate` para disparar
 * los triggers diferidos sin necesidad de hacer COMMIT.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let sql: postgres.Sql;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (.env.local)");
  sql = postgres(url, { max: 2, onnotice: () => {} });
  await sql`select 1`;
});

afterAll(async () => {
  await sql?.end();
});

/** Abre una transacción en una conexión dedicada y garantiza su cierre. */
async function enTransaccion(fn: (tx: postgres.ReservedSql) => Promise<void>) {
  const tx = await sql.reserve();
  try {
    await tx`begin`;
    await fn(tx);
  } finally {
    await tx`rollback`.catch(() => {});
    tx.release();
  }
}

async function crearUsuario(tx: postgres.ReservedSql) {
  const [u] = await tx<{ id: string }[]>`
    insert into usuarios (email, nombre)
    values (${`test-${crypto.randomUUID()}@test.local`}, 'Test')
    returning id`;
  return u!.id;
}

async function crearCliente(tx: postgres.ReservedSql, usuarioId: string) {
  const [c] = await tx<{ id: string }[]>`
    insert into clientes (nombre, creado_por) values ('Cliente test', ${usuarioId})
    returning id`;
  return c!.id;
}

/** Préstamo coherente con los CHECK: 1.000.000 ARS / 1.250 = 800 USDT; 10% = 100.000 ARS. */
async function crearPrestamo(tx: postgres.ReservedSql, usuarioId: string) {
  const clienteId = await crearCliente(tx, usuarioId);
  const [p] = await tx<{ id: string }[]>`
    insert into prestamos (
      cliente_id, fecha_desembolso, ars_capital, tc_entrada, tasa_mensual_pct, tasa_total_pct,
      frecuencia, n_cuotas, vencimiento_final, usdt_prestado, ars_interes_pactado, creado_por
    ) values (
      ${clienteId}, '2026-10-01', 1000000, 1250, 10, 10,
      'mes', 1, '2026-11-01', 800, 100000, ${usuarioId}
    ) returning id`;
  return p!.id;
}

async function participanteSociedad(tx: postgres.ReservedSql) {
  const [s] = await tx<{ id: string }[]>`
    select id from participantes where tipo = 'sociedad'`;
  if (s) return s.id;
  const [n] = await tx<{ id: string }[]>`
    insert into participantes (nombre, tipo) values ('Sociedad', 'sociedad') returning id`;
  return n!.id;
}

describe("pagos inmutables", () => {
  it("un UPDATE sobre pagos falla", async () => {
    await enTransaccion(async (tx) => {
      const usuarioId = await crearUsuario(tx);
      const clienteId = await crearCliente(tx, usuarioId);
      const [pago] = await tx<{ id: string }[]>`
        insert into pagos (cliente_id, fecha, ars, tipo, creado_por)
        values (${clienteId}, '2026-10-01', 5000, 'efectivo', ${usuarioId})
        returning id`;
      await tx`
        insert into imputaciones (pago_id, fecha, concepto, ars, creado_por)
        values (${pago!.id}, '2026-10-01', 'saldo_favor', 5000, ${usuarioId})`;

      // Control: el pago en sí es válido (100% imputado).
      await tx`set constraints all immediate`;

      await expect(tx`update pagos set ars = 6000 where id = ${pago!.id}`).rejects.toThrow(
        /La tabla pagos es inmutable \(UPDATE\)/,
      );
    });
  });
});

describe("asientos balanceados por moneda", () => {
  async function cargarTransaccion(tx: postgres.ReservedSql, montos: [string, string]) {
    const usuarioId = await crearUsuario(tx);
    const [t] = await tx<{ id: string }[]>`
      insert into transacciones (fecha, tipo, creado_por)
      values ('2026-10-01', 'apertura', ${usuarioId}) returning id`;
    await tx`
      insert into asientos (transaccion_id, cuenta, moneda, monto) values
        (${t!.id}, 'caja_usdt', 'USDT', ${montos[0]}),
        (${t!.id}, 'apertura',  'USDT', ${montos[1]})`;
  }

  it("una transacción balanceada pasa la validación diferida", async () => {
    await enTransaccion(async (tx) => {
      await cargarTransaccion(tx, ["100", "-100"]);
      await expect(tx`set constraints all immediate`).resolves.toBeDefined();
    });
  });

  it("una transacción desbalanceada falla al hacer COMMIT", async () => {
    await enTransaccion(async (tx) => {
      // Los INSERT pasan: el chequeo es diferido.
      await cargarTransaccion(tx, ["100", "-90"]);
      await expect(tx`commit`).rejects.toThrow(/desbalanceada en USDT: 10/);
    });
  });
});

describe("participaciones del préstamo al 100%", () => {
  it("un préstamo con participaciones al 100% pasa la validación diferida", async () => {
    await enTransaccion(async (tx) => {
      const usuarioId = await crearUsuario(tx);
      const prestamoId = await crearPrestamo(tx, usuarioId);
      const sociedadId = await participanteSociedad(tx);
      await tx`
        insert into prestamo_participaciones (prestamo_id, participante_id, pct_capital, pct_ganancia)
        values (${prestamoId}, ${sociedadId}, 100, 100)`;
      await expect(tx`set constraints all immediate`).resolves.toBeDefined();
    });
  });

  it("un préstamo sin participaciones falla al hacer COMMIT", async () => {
    await enTransaccion(async (tx) => {
      const usuarioId = await crearUsuario(tx);
      await crearPrestamo(tx, usuarioId);
      await expect(tx`commit`).rejects.toThrow(/participaciones suman capital %?0%? \/ ganancia %?0%?/);
    });
  });

  it("un préstamo con participaciones que no suman 100% falla al hacer COMMIT", async () => {
    await enTransaccion(async (tx) => {
      const usuarioId = await crearUsuario(tx);
      const prestamoId = await crearPrestamo(tx, usuarioId);
      const sociedadId = await participanteSociedad(tx);
      await tx`
        insert into prestamo_participaciones (prestamo_id, participante_id, pct_capital, pct_ganancia)
        values (${prestamoId}, ${sociedadId}, 60, 60)`;
      await expect(tx`commit`).rejects.toThrow(/participaciones suman capital %?60\.0000%?/);
    });
  });
});
