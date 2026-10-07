/**
 * Alta de préstamo contra la base real: lo que genera el motor tiene que pasar
 * los CHECK (usdt_prestado, interés pactado) y los triggers diferidos
 * (participaciones al 100%, asientos balanceados). Termina siempre en ROLLBACK.
 */
import Decimal from "decimal.js";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { insertarPrestamo, type AltaPrestamo } from "@/db/alta-prestamo";
import { asientos, clientes, cuotas, participantes, prestamos, transacciones, usuarios } from "@/db/schema";

class Rollback extends Error {}

/** Corre `fn` en una transacción, fuerza los triggers diferidos y revierte todo. */
async function enRollback(fn: Parameters<typeof db.transaction>[0]) {
  await expect(
    db.transaction(async (tx) => {
      await fn(tx);
      await tx.execute(sql`set constraints all immediate`);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

const datos = (clienteId: string): AltaPrestamo => ({
  clienteId,
  fechaDesembolso: "2026-10-03",
  arsCapital: new Decimal("3500000"),
  tcEntrada: new Decimal("1285"),
  tasaMensualPct: new Decimal("12"),
  tasaTotalPct: new Decimal("36"),
  frecuencia: "quincena",
  nCuotas: 6,
  moraPct: new Decimal("20"),
  diasGracia: 5,
  notas: null,
});

describe("insertarPrestamo", () => {
  it("guarda préstamo, participación, cuotas y desembolso balanceado", async () => {
    await enRollback(async (tx) => {
      const [u] = await tx
        .insert(usuarios)
        .values({ email: `test-${crypto.randomUUID()}@test.local`, nombre: "Test" })
        .returning();
      await tx.execute(sql`select set_config('app.usuario_id', ${u!.id}, true)`);
      const [c] = await tx.insert(clientes).values({ nombre: "Cliente test", creadoPor: u!.id }).returning();
      let [soc] = await tx.select().from(participantes).where(eq(participantes.tipo, "sociedad"));
      soc ??= (await tx.insert(participantes).values({ nombre: "Sociedad", tipo: "sociedad" }).returning())[0];

      const { id } = await insertarPrestamo(tx, datos(c!.id), { usuarioId: u!.id, sociedadId: soc!.id });

      const [p] = await tx.select().from(prestamos).where(eq(prestamos.id, id));
      expect(p!.usdtPrestado).toBe("2723.73540856");
      expect(p!.arsInteresPactado).toBe("1260000.00");
      expect(p!.vencimientoFinal).toBe("2027-01-01");
      expect(p!.moraPct).toBe("20.0000");

      const cs = await tx.select().from(cuotas).where(eq(cuotas.prestamoId, id));
      expect(cs).toHaveLength(6);
      expect(cs.reduce((s, x) => s.plus(x.arsCapital), new Decimal(0)).toFixed(2)).toBe("3500000.00");

      const [t] = await tx.select().from(transacciones).where(eq(transacciones.prestamoId, id));
      expect(t!.tipo).toBe("desembolso");
      const as = await tx.select().from(asientos).where(eq(asientos.transaccionId, t!.id));
      expect(as.map((a) => [a.cuenta, a.monto]).sort()).toEqual([
        ["caja_usdt", "-2723.73540856"],
        ["cartera", "2723.73540856"],
      ]);
    });
  });
});
