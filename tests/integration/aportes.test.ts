/** Aportes de socios contra la base real (siempre ROLLBACK). */
import Decimal from "decimal.js";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, type Tx } from "@/db";
import { asientos, participantes, usuarios } from "@/db/schema";
import { cuentasSocios, ErrorAporte, historialAportes, insertarAporte } from "@/db/socios";

class Rollback extends Error {}

async function enRollback(fn: (tx: Tx) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      await tx.execute(sql`set constraints all immediate`);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
    return;
  }
  throw new Error("La transacción no terminó en ROLLBACK");
}

async function preparar(tx: Tx) {
  const [u] = await tx.insert(usuarios).values({ email: `test-${crypto.randomUUID()}@test.local`, nombre: "Test" }).returning();
  await tx.execute(sql`select set_config('app.usuario_id', ${u!.id}, true)`);
  const socios = await tx.select().from(participantes).where(eq(participantes.tipo, "socio")).orderBy(participantes.nombre);
  return { usuarioId: u!.id, socios, antes: await cuentasSocios(tx) };
}

describe("insertarAporte", () => {
  it("un socio: suma a la caja y a su capital", async () => {
    await enRollback(async (tx) => {
      const s = await preparar(tx);
      const socio = s.socios[0]!;
      const { transaccionId } = await insertarAporte(
        tx,
        { fecha: "2026-10-01", usdt: new Decimal("1000"), socio: socio.id, notas: "Transferencia Binance" },
        { usuarioId: s.usuarioId },
      );
      const despues = await cuentasSocios(tx);
      expect(despues.caja.minus(s.antes.caja).toFixed(2)).toBe("1000.00");
      const delta = (c: typeof despues) => c.socios.find((x) => x.id === socio.id)!.capital;
      expect(delta(despues).minus(delta(s.antes)).toFixed(2)).toBe("1000.00");
      const [h] = (await historialAportes(tx)).filter((x) => x.id === transaccionId);
      expect(h!.descripcion).toBe(`Aporte de ${socio.nombre}: 1.000,00 USDT · Transferencia Binance`);
      expect(h!.usdt.toFixed(2)).toBe("1000.00");
    });
  });

  it("ambos: se reparte según el % de la sociedad", async () => {
    await enRollback(async (tx) => {
      const s = await preparar(tx);
      const { transaccionId } = await insertarAporte(tx, { fecha: "2026-10-01", usdt: new Decimal("500"), socio: "ambos", notas: null }, { usuarioId: s.usuarioId });
      const lineas = await tx.select().from(asientos).where(eq(asientos.transaccionId, transaccionId));
      const capital = lineas.filter((a) => a.cuenta === "capital").map((a) => a.monto).sort();
      expect(capital).toEqual(s.socios.map((x) => new Decimal(500).times(x.pctSociedad!).div(100).neg().toFixed(8)).sort());
    });
  });

  it("rechaza un socio que no existe", async () => {
    await enRollback(async (tx) => {
      const s = await preparar(tx);
      await expect(
        insertarAporte(tx, { fecha: "2026-10-01", usdt: new Decimal("1"), socio: crypto.randomUUID(), notas: null }, { usuarioId: s.usuarioId }),
      ).rejects.toBeInstanceOf(ErrorAporte);
    });
  });
});
