/**
 * Registrar pago contra la base real: imputaciones al 100%, asientos balanceados,
 * mora cargada una sola vez, ganancia recién después de recuperar el costo y
 * cierre del préstamo saldado. Termina siempre en ROLLBACK.
 */
import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, type Tx } from "@/db";
import { insertarPrestamo } from "@/db/alta-prestamo";
import { cargarDeudaCliente, ErrorImputacion, insertarPago, saldoFavorCliente, saldosAFavor, type NuevoPago } from "@/db/registrar-pago";
import { asientos, cargos, clientes, imputaciones, participantes, prestamos, transacciones, usuarios } from "@/db/schema";
import { aplicarDescuentos, deudasAFecha, distribuirFifo } from "@/engine/pago";

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

/** Usuario, cliente y un préstamo de 100.000 ARS a TC 1.600 (62,5 USDT), 2 cuotas mensuales al 20%. */
async function preparar(tx: Tx) {
  const [u] = await tx.insert(usuarios).values({ email: `test-${crypto.randomUUID()}@test.local`, nombre: "Test" }).returning();
  await tx.execute(sql`select set_config('app.usuario_id', ${u!.id}, true)`);
  const [c] = await tx.insert(clientes).values({ nombre: "Cliente test", creadoPor: u!.id }).returning();
  let [soc] = await tx.select().from(participantes).where(eq(participantes.tipo, "sociedad"));
  soc ??= (await tx.insert(participantes).values({ nombre: "Sociedad", tipo: "sociedad" }).returning())[0];
  const id = await prestamoDe(tx, c!.id, u!.id, soc!.id, "2026-01-01");
  return { usuarioId: u!.id, clienteId: c!.id, prestamoId: id, sociedadId: soc!.id };
}

async function prestamoDe(tx: Tx, clienteId: string, usuarioId: string, sociedadId: string, fechaDesembolso: string) {
  const { id } = await insertarPrestamo(
    tx,
    {
      clienteId,
      fechaDesembolso,
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
    { usuarioId, sociedadId },
  );
  return id;
}

/** Pago con imputación FIFO calculada como lo hace la pantalla. */
async function pagoFifo(
  tx: Tx,
  clienteId: string,
  p: Pick<NuevoPago, "fecha" | "tipo" | "ars" | "tcSalida"> & Partial<NuevoPago>,
  disponible: Decimal = p.ars,
): Promise<NuevoPago> {
  const { deudas } = deudasAFecha(await cargarDeudaCliente(tx, clienteId), p.fecha);
  const { deudas: netas } = aplicarDescuentos(deudas, p.descuentos ?? new Map());
  return {
    clienteId,
    metodo: null,
    notas: null,
    usarSaldo: false,
    descuentos: new Map(),
    motivoDescuento: null,
    montos: distribuirFifo(disponible, netas),
    ...p,
  };
}

const libro = async (tx: Tx, transaccionId: string) =>
  (await tx.select().from(asientos).where(eq(asientos.transaccionId, transaccionId))).map((a) => [a.cuenta, a.monto]).sort();

describe("insertarPago", () => {
  it("ejemplo de la spec: devuelve 120.000 a TC 1.605 → recupera 62,5 y gana 12,27 USDT; cancela el préstamo", async () => {
    await enRollback(async (tx) => {
      const s = await preparar(tx);
      const r = await insertarPago(
        tx,
        await pagoFifo(tx, s.clienteId, { fecha: "2026-02-01", tipo: "transferencia", ars: new Decimal("120000"), tcSalida: new Decimal("1605") }),
        { usuarioId: s.usuarioId },
      );
      expect(r.cancelados).toEqual([s.prestamoId]);

      const [t] = await tx.select().from(transacciones).where(eq(transacciones.pagoId, r.pagoId!));
      expect(t!.tipo).toBe("cobro");
      expect(await libro(tx, t!.id)).toEqual([
        ["caja_usdt", "74.76635514"],
        ["cartera", "-62.50000000"],
        ["ganancia", "-12.26635514"],
      ]);
      const [p] = await tx.select().from(prestamos).where(eq(prestamos.id, s.prestamoId));
      expect([p!.estado, p!.fechaCierre]).toEqual(["cancelado", "2026-02-01"]);
    });
  });

  it("pago atrasado: carga la mora una vez, imputa mora → interés → capital y deja saldo a favor", async () => {
    await enRollback(async (tx) => {
      const s = await preparar(tx);
      // Cuota 1 vence 01/02 (50.000 + 10.000); el 10/02 ya pasó la gracia → mora 20% × 50.000 = 10.000
      const r = await insertarPago(
        tx,
        await pagoFifo(tx, s.clienteId, { fecha: "2026-02-10", tipo: "transferencia", ars: new Decimal("30000"), tcSalida: new Decimal("2000") }),
        { usuarioId: s.usuarioId },
      );
      const cs = await tx.select().from(cargos).where(eq(cargos.prestamoId, s.prestamoId));
      expect(cs.map((c) => [c.tipo, c.ars, c.fecha])).toEqual([["mora", "10000.00", "2026-02-07"]]);
      const imps = await tx.select().from(imputaciones).where(eq(imputaciones.pagoId, r.pagoId!));
      expect(imps.map((i) => [i.concepto, i.ars])).toEqual([
        ["mora", "10000.00"],
        ["interes", "10000.00"],
        ["capital", "10000.00"],
      ]);

      // Segundo pago: no vuelve a cargar mora; paga todo y sobran 5.000 de saldo a favor
      const r2 = await insertarPago(
        tx,
        await pagoFifo(tx, s.clienteId, { fecha: "2026-02-15", tipo: "transferencia", ars: new Decimal("105000"), tcSalida: new Decimal("2000") }),
        { usuarioId: s.usuarioId },
      );
      expect(await tx.select().from(cargos).where(eq(cargos.prestamoId, s.prestamoId))).toHaveLength(1);
      expect(r2.cancelados).toEqual([s.prestamoId]);
      expect((await saldoFavorCliente(tx, s.clienteId)).toFixed(2)).toBe("5000.00");

      // 105.000 / 2.000 = 52,5 USDT: 47,5 terminan de recuperar el costo (ya bajó 15), 2,5 ganancia, 2,5 saldo a favor
      const [t2] = await tx.select().from(transacciones).where(eq(transacciones.pagoId, r2.pagoId!));
      expect(await libro(tx, t2!.id)).toEqual([
        ["caja_usdt", "52.50000000"],
        ["cartera", "-47.50000000"],
        ["ganancia", "-2.50000000"],
        ["saldo_favor", "-2.50000000"],
      ]);
    });
  });

  it("efectivo: entra a la caja de efectivo en ARS sin mover cartera", async () => {
    await enRollback(async (tx) => {
      const s = await preparar(tx);
      const r = await insertarPago(
        tx,
        await pagoFifo(tx, s.clienteId, { fecha: "2026-01-20", tipo: "efectivo", ars: new Decimal("20000"), tcSalida: null }),
        { usuarioId: s.usuarioId },
      );
      const [t] = await tx.select().from(transacciones).where(eq(transacciones.pagoId, r.pagoId!));
      expect(await libro(tx, t!.id)).toEqual([
        ["caja_efectivo_ars", "20000.00000000"],
        ["puente_cambio", "-20000.00000000"],
      ]);
      const [p] = await tx.select().from(prestamos).where(eq(prestamos.id, s.prestamoId));
      expect(p!.estado).toBe("vigente");
    });
  });

  it("rechaza montos que superan la deuda", async () => {
    await enRollback(async (tx) => {
      const s = await preparar(tx);
      const { deudas } = deudasAFecha(await cargarDeudaCliente(tx, s.clienteId), "2026-01-20");
      await expect(
        insertarPago(
          tx,
          {
            clienteId: s.clienteId,
            fecha: "2026-01-20",
            tipo: "transferencia",
            ars: new Decimal("999999"),
            tcSalida: new Decimal("1600"),
            metodo: null,
            notas: null,
            montos: new Map([[deudas[0]!.clave, new Decimal("999999")]]),
            usarSaldo: false,
            descuentos: new Map(),
            motivoDescuento: null,
          },
          { usuarioId: s.usuarioId },
        ),
      ).rejects.toBeInstanceOf(ErrorImputacion);
    });
  });

  it("descuento por pago adelantado: cargo negativo por cuota y el préstamo se cancela", async () => {
    await enRollback(async (tx) => {
      const s = await preparar(tx);
      const { deudas } = deudasAFecha(await cargarDeudaCliente(tx, s.clienteId), "2026-01-15");
      const descuentos = new Map(deudas.map((d) => [d.clave, new Decimal("10000")]));
      const r = await insertarPago(
        tx,
        await pagoFifo(tx, s.clienteId, {
          fecha: "2026-01-15",
          tipo: "transferencia",
          ars: new Decimal("100000"),
          tcSalida: new Decimal("1600"),
          descuentos,
          motivoDescuento: "Pago adelantado",
        }),
        { usuarioId: s.usuarioId },
      );
      expect(r.cancelados).toEqual([s.prestamoId]);
      const cs = await tx.select().from(cargos).where(eq(cargos.prestamoId, s.prestamoId));
      expect(cs.map((c) => [c.tipo, c.ars, c.motivo]).sort()).toEqual([
        ["descuento", "-10000.00", "Pago adelantado (cuota 1)"],
        ["descuento", "-10000.00", "Pago adelantado (cuota 2)"],
      ]);
      const imps = await tx.select().from(imputaciones).where(eq(imputaciones.pagoId, r.pagoId!));
      expect(imps.every((i) => i.concepto === "capital")).toBe(true);
    });
  });

  it("aplica saldo a favor de una transferencia a otro préstamo, con sus USDT", async () => {
    await enRollback(async (tx) => {
      const s = await preparar(tx);
      // 125.000 a TC 2.000 = 62,5 USDT: 60 bajan cartera del préstamo 1, 2,5 (5.000 ARS) quedan a favor
      const r1 = await insertarPago(
        tx,
        await pagoFifo(tx, s.clienteId, { fecha: "2026-01-20", tipo: "transferencia", ars: new Decimal("125000"), tcSalida: new Decimal("2000") }),
        { usuarioId: s.usuarioId },
      );
      expect(r1.cancelados).toEqual([s.prestamoId]);
      const [saldo] = await saldosAFavor(tx, s.clienteId);
      expect([saldo!.ars.toFixed(2), saldo!.usdt!.toFixed(8), saldo!.aplicable]).toEqual(["5000.00", "2.50000000", true]);

      const p2 = await prestamoDe(tx, s.clienteId, s.usuarioId, s.sociedadId, "2026-01-25");
      const r2 = await insertarPago(
        tx,
        await pagoFifo(
          tx,
          s.clienteId,
          { fecha: "2026-01-26", tipo: "transferencia", ars: new Decimal(0), tcSalida: null, usarSaldo: true },
          new Decimal("5000"),
        ),
        { usuarioId: s.usuarioId },
      );
      expect(r2).toMatchObject({ pagoId: null, prestamos: [p2], cancelados: [] });

      const imps = await tx.select().from(imputaciones).where(eq(imputaciones.pagoId, r1.pagoId!));
      expect(imps.filter((i) => i.prestamoId !== s.prestamoId).map((i) => [i.concepto, i.prestamoId, i.ars])).toEqual(
        expect.arrayContaining([
          ["saldo_favor", null, "-5000.00"],
          ["interes", p2, "5000.00"],
        ]),
      );
      const [t] = await tx
        .select()
        .from(transacciones)
        .where(and(eq(transacciones.tipo, "aplicacion_saldo_favor"), eq(transacciones.pagoId, r1.pagoId!)));
      expect(t!.prestamoId).toBe(p2);
      expect(await libro(tx, t!.id)).toEqual([
        ["cartera", "-2.50000000"],
        ["saldo_favor", "2.50000000"],
      ]);
      expect((await saldoFavorCliente(tx, s.clienteId)).toFixed(2)).toBe("0.00");
      expect(await saldosAFavor(tx, s.clienteId)).toEqual([]);
    });
  });
});
