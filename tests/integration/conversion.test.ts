/**
 * Conversión de efectivo contra la base real: lotes completos, recupero de costo
 * y ganancia recién al convertir, conversiones parciales y saldo a favor.
 * Termina siempre en ROLLBACK.
 */
import Decimal from "decimal.js";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, type Tx } from "@/db";
import { insertarPrestamo } from "@/db/alta-prestamo";
import { efectivoPendiente, ErrorConversion, insertarConversion } from "@/db/conversion";
import { cargarDeudaCliente, insertarPago, saldosAFavor } from "@/db/registrar-pago";
import { asientos, clientes, participantes, transacciones, usuarios } from "@/db/schema";
import { deudasAFecha, distribuirFifo } from "@/engine/pago";

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

/** Préstamo de 100.000 ARS a TC 1.600 (62,5 USDT), 2 cuotas de 60.000; cobro en efectivo de `ars` el 01/02. */
async function conEfectivo(tx: Tx, ars: string) {
  const [u] = await tx.insert(usuarios).values({ email: `test-${crypto.randomUUID()}@test.local`, nombre: "Test" }).returning();
  await tx.execute(sql`select set_config('app.usuario_id', ${u!.id}, true)`);
  const [c] = await tx.insert(clientes).values({ nombre: "Cliente test", creadoPor: u!.id }).returning();
  let [soc] = await tx.select().from(participantes).where(eq(participantes.tipo, "sociedad"));
  soc ??= (await tx.insert(participantes).values({ nombre: "Sociedad", tipo: "sociedad" }).returning())[0];
  const { id: prestamoId } = await insertarPrestamo(
    tx,
    {
      clienteId: c!.id,
      fechaDesembolso: "2026-01-01",
      arsCapital: new Decimal("100000"),
      tcEntrada: new Decimal("1600"),
      tasaMensualPct: new Decimal("10"),
      tasaTotalPct: new Decimal("20"),
      frecuencia: "mes",
      nCuotas: 2,
      moraPct: new Decimal("20"),
      diasGracia: 5,
      notas: null,
    },
    { usuarioId: u!.id, sociedadId: soc!.id },
  );
  const { deudas } = deudasAFecha(await cargarDeudaCliente(tx, c!.id), "2026-02-01");
  const { pagoId } = await insertarPago(
    tx,
    {
      clienteId: c!.id,
      fecha: "2026-02-01",
      tipo: "efectivo",
      ars: new Decimal(ars),
      tcSalida: null,
      metodo: null,
      notas: null,
      montos: distribuirFifo(ars, deudas),
      usarSaldo: false,
      descuentos: new Map(),
      motivoDescuento: null,
    },
    { usuarioId: u!.id },
  );
  return { usuarioId: u!.id, clienteId: c!.id, prestamoId, pagoId: pagoId! };
}

const convertir = (tx: Tx, s: { usuarioId: string; pagoId: string }, fecha: string, ars: string, tc: string) =>
  insertarConversion(
    tx,
    { fecha, ars: new Decimal(ars), tc: new Decimal(tc), notas: null, lotes: new Map([[s.pagoId, new Decimal(ars)]]) },
    { usuarioId: s.usuarioId },
  );

const saldoCuenta = async (tx: Tx, cuenta: "cartera" | "ganancia", prestamoId: string) =>
  (
    await tx
      .select({ m: sql<string>`coalesce(sum(${asientos.monto}), 0)` })
      .from(asientos)
      .where(sql`${asientos.cuenta} = ${cuenta} and ${asientos.prestamoId} = ${prestamoId}`)
  )[0]!.m;

describe("insertarConversion", () => {
  it("ejemplo de la spec en efectivo: la ganancia aparece recién al convertir", async () => {
    await enRollback(async (tx) => {
      const s = await conEfectivo(tx, "120000");
      expect(await saldoCuenta(tx, "cartera", s.prestamoId)).toBe("62.50000000");
      expect((await efectivoPendiente(tx)).find((p) => p.pagoId === s.pagoId)?.pendiente.toFixed(2)).toBe("120000.00");

      const { conversionId } = await convertir(tx, s, "2026-02-03", "120000", "1605");
      expect(await saldoCuenta(tx, "cartera", s.prestamoId)).toBe("0.00000000");
      expect(await saldoCuenta(tx, "ganancia", s.prestamoId)).toBe("-12.26635514");
      const [t] = await tx.select().from(transacciones).where(eq(transacciones.conversionId, conversionId));
      expect([t!.tipo, t!.pagoId, t!.prestamoId]).toEqual(["conversion", s.pagoId, s.prestamoId]);
      expect((await efectivoPendiente(tx)).some((p) => p.pagoId === s.pagoId)).toBe(false);
    });
  });

  it("en dos conversiones parciales: la segunda termina de recuperar y gana", async () => {
    await enRollback(async (tx) => {
      const s = await conEfectivo(tx, "120000");
      await convertir(tx, s, "2026-02-02", "64000", "1600"); // 40 USDT: todo recupero
      expect(await saldoCuenta(tx, "cartera", s.prestamoId)).toBe("22.50000000");
      expect(await saldoCuenta(tx, "ganancia", s.prestamoId)).toBe("0");
      await convertir(tx, s, "2026-02-05", "56000", "1400"); // 40 USDT: 22,5 recupero + 17,5 ganancia
      expect(await saldoCuenta(tx, "cartera", s.prestamoId)).toBe("0.00000000");
      expect(await saldoCuenta(tx, "ganancia", s.prestamoId)).toBe("-17.50000000");
    });
  });

  it("no convierte más que lo pendiente", async () => {
    await enRollback(async (tx) => {
      const s = await conEfectivo(tx, "120000");
      await expect(convertir(tx, s, "2026-02-02", "120000.01", "1600")).rejects.toBeInstanceOf(ErrorConversion);
    });
  });

  it("efectivo con saldo a favor: se aplica sin convertir y la conversión sigue la imputación nueva", async () => {
    await enRollback(async (tx) => {
      const s = await conEfectivo(tx, "130000"); // 120.000 cancelan, 10.000 a favor
      const [saldo] = await saldosAFavor(tx, s.clienteId);
      expect([saldo!.ars.toFixed(2), saldo!.usdt, saldo!.aplicable]).toEqual(["10000.00", null, true]);

      await convertir(tx, s, "2026-02-03", "130000", "1300"); // 100 USDT
      // 120/130 al préstamo (92,30769231): 62,5 recupero + 29,80769231 ganancia; 10/130 a favor (7,69230769)
      expect(await saldoCuenta(tx, "ganancia", s.prestamoId)).toBe("-29.80769231");
      const [despues] = await saldosAFavor(tx, s.clienteId);
      expect([despues!.usdt!.toFixed(8), despues!.aplicable]).toEqual(["7.69230769", true]);
    });
  });
});
