/**
 * Terceros (fondeadores) contra la base real: su parte entra a la caja en el
 * desembolso, se llevan su % de la ganancia, se les paga con tope en lo que se
 * les debe y todo se revierte al anular o editar. Termina siempre en ROLLBACK.
 */
import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, type Tx } from "@/db";
import { insertarPrestamo, type AltaPrestamo } from "@/db/alta-prestamo";
import { anular } from "@/db/anulaciones";
import { insertarConversion } from "@/db/conversion";
import { corregirPrestamo } from "@/db/correccion-prestamo";
import { cargarDeudaCliente, insertarPago, type NuevoPago } from "@/db/registrar-pago";
import { asientos, clientes, participantes, prestamoParticipaciones, transacciones, usuarios } from "@/db/schema";
import { cuentasTerceros, ErrorTercero, insertarPagoTercero, insertarTercero } from "@/db/terceros";
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

const HOY = "2026-03-01";

/** Préstamo de 100.000 ARS a TC 1.600 (62,5 USDT), 2 cuotas mensuales al 20%. */
const datos = (clienteId: string, pctTercero: string | null, terceroId: string): AltaPrestamo => ({
  clienteId,
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
  terceros: pctTercero ? [{ participanteId: terceroId, pct: new Decimal(pctTercero) }] : [],
});

async function preparar(tx: Tx, pctTercero = "20") {
  const [u] = await tx.insert(usuarios).values({ email: `test-${crypto.randomUUID()}@test.local`, nombre: "Test" }).returning();
  await tx.execute(sql`select set_config('app.usuario_id', ${u!.id}, true)`);
  const [c] = await tx.insert(clientes).values({ nombre: "Cliente test", creadoPor: u!.id }).returning();
  let [soc] = await tx.select().from(participantes).where(eq(participantes.tipo, "sociedad"));
  soc ??= (await tx.insert(participantes).values({ nombre: "Sociedad", tipo: "sociedad" }).returning())[0];
  const { id: terceroId } = await insertarTercero(tx, { nombre: "Tercero test", pctDefault: null, notas: null, activo: true });
  const { id: prestamoId } = await insertarPrestamo(tx, datos(c!.id, pctTercero, terceroId), { usuarioId: u!.id, sociedadId: soc!.id });
  return { usuarioId: u!.id, clienteId: c!.id, sociedadId: soc!.id, terceroId, prestamoId };
}

async function pagoFifo(tx: Tx, clienteId: string, p: Pick<NuevoPago, "fecha" | "tipo" | "ars" | "tcSalida">): Promise<NuevoPago> {
  const { deudas } = deudasAFecha(await cargarDeudaCliente(tx, clienteId), p.fecha);
  const { deudas: netas } = aplicarDescuentos(deudas, new Map());
  return { clienteId, metodo: null, notas: null, usarSaldo: false, descuentos: new Map(), motivoDescuento: null, montos: distribuirFifo(p.ars, netas), ...p };
}

/** El ejemplo de la spec: devuelve 120.000 a TC 1.605 → recupera 62,5 y gana 12,26635514 USDT. */
const cobrarTodo = async (tx: Tx, s: { clienteId: string; usuarioId: string }) =>
  insertarPago(
    tx,
    await pagoFifo(tx, s.clienteId, { fecha: "2026-02-01", tipo: "transferencia", ars: new Decimal("120000"), tcSalida: new Decimal("1605") }),
    { usuarioId: s.usuarioId },
  );

/** Ganancia de un participante (de un préstamo, si se indica). */
const gananciaDe = async (tx: Tx, participanteId: string, prestamoId?: string) =>
  (
    await tx
      .select({ m: sql<string>`coalesce(-sum(${asientos.monto}), 0)` })
      .from(asientos)
      .where(
        and(eq(asientos.cuenta, "ganancia"), eq(asientos.participanteId, participanteId), prestamoId ? eq(asientos.prestamoId, prestamoId) : undefined),
      )
  )[0]!.m;

const deuda = async (tx: Tx, terceroId: string) => (await cuentasTerceros(tx, HOY, terceroId))[0]!.deuda;

describe("terceros", () => {
  it("alta 80/20: la caja pone solo la parte de la Sociedad y el tercero queda con su capital", async () => {
    await enRollback(async (tx) => {
      const s = await preparar(tx);
      const partes = await tx.select().from(prestamoParticipaciones).where(eq(prestamoParticipaciones.prestamoId, s.prestamoId));
      expect(partes.map((p) => [p.participanteId, p.pctCapital, p.pctGanancia]).sort()).toEqual(
        [
          [s.sociedadId, "80.0000", "80.0000"],
          [s.terceroId, "20.0000", "20.0000"],
        ].sort(),
      );

      const [t] = await tx.select().from(transacciones).where(and(eq(transacciones.prestamoId, s.prestamoId), eq(transacciones.tipo, "desembolso")));
      const lineas = await tx.select().from(asientos).where(eq(asientos.transaccionId, t!.id));
      const caja = lineas.filter((a) => a.cuenta === "caja_usdt").reduce((x, a) => x.plus(a.monto), new Decimal(0));
      expect(caja.toFixed(8)).toBe("-50.00000000");
      expect(lineas.filter((a) => a.cuenta === "capital").map((a) => [a.participanteId, a.monto, a.prestamoId])).toEqual([
        [s.terceroId, "-12.50000000", s.prestamoId],
      ]);
      expect((await deuda(tx, s.terceroId)).puesto.toFixed(8)).toBe("12.50000000");
    });
  });

  it("un cobro le da su % de la ganancia y lo recuperado pasa a lo que se le debe", async () => {
    await enRollback(async (tx) => {
      const s = await preparar(tx);
      await cobrarTodo(tx, s);
      const ganTercero = new Decimal(await gananciaDe(tx, s.terceroId));
      const ganSociedad = new Decimal(await gananciaDe(tx, s.sociedadId, s.prestamoId));
      expect(ganTercero.plus(ganSociedad).toFixed(8)).toBe("12.26635514");
      expect(ganTercero.minus(new Decimal("12.26635514").times("0.2")).abs().lte("0.00000001")).toBe(true);

      const d = await deuda(tx, s.terceroId);
      expect([d.capitalRecuperado.toFixed(8), d.ganancia.toFixed(8), d.disponible.toFixed(8)]).toEqual([
        "12.50000000",
        ganTercero.toFixed(8),
        ganTercero.plus("12.5").toFixed(8),
      ]);
    });
  });

  it("el pago al tercero tiene tope, va primero a capital y se puede anular", async () => {
    await enRollback(async (tx) => {
      const s = await preparar(tx);
      await cobrarTodo(tx, s);
      const antes = await deuda(tx, s.terceroId);

      const { transaccionId } = await insertarPagoTercero(
        tx,
        { terceroId: s.terceroId, fecha: HOY, usdt: new Decimal("13"), notas: null },
        { usuarioId: s.usuarioId, hoy: HOY },
      );
      const lineas = await tx.select().from(asientos).where(eq(asientos.transaccionId, transaccionId));
      expect(lineas.map((a) => [a.cuenta, a.monto]).sort()).toEqual([
        ["caja_usdt", "-13.00000000"],
        ["capital", "12.50000000"],
        ["ganancia", "0.50000000"],
      ]);
      const despues = await deuda(tx, s.terceroId);
      expect(despues.disponible.toFixed(8)).toBe(antes.disponible.minus(13).toFixed(8));

      await expect(
        insertarPagoTercero(tx, { terceroId: s.terceroId, fecha: HOY, usdt: despues.disponible.plus("0.01"), notas: null }, { usuarioId: s.usuarioId, hoy: HOY }),
      ).rejects.toBeInstanceOf(ErrorTercero);

      await anular(tx, "pagosTercero", { id: transaccionId, motivo: "Pago cargado de más" }, { usuarioId: s.usuarioId, hoy: HOY });
      expect((await deuda(tx, s.terceroId)).disponible.toFixed(8)).toBe(antes.disponible.toFixed(8));
    });
  });

  it("efectivo convertido reparte la ganancia por la participación del préstamo", async () => {
    await enRollback(async (tx) => {
      const s = await preparar(tx, "50");
      const r = await insertPagoEfectivo(tx, s);
      await insertarConversion(
        tx,
        { fecha: "2026-02-02", ars: new Decimal("120000"), tc: new Decimal("1605"), notas: null, lotes: new Map([[r.pagoId!, new Decimal("120000")]]) },
        { usuarioId: s.usuarioId },
      );
      const ganTercero = new Decimal(await gananciaDe(tx, s.terceroId));
      expect(ganTercero.minus(new Decimal("12.26635514").div(2)).abs().lte("0.00000001")).toBe(true);
    });
  });

  it("editar el préstamo revierte el aporte del tercero y rehace el reparto con los cobros", async () => {
    await enRollback(async (tx) => {
      const s = await preparar(tx);
      await cobrarTodo(tx, s);
      const nuevo = await corregirPrestamo(
        tx,
        { id: s.prestamoId, datos: datos(s.clienteId, "50", s.terceroId), motivo: "El tercero puso la mitad" },
        { usuarioId: s.usuarioId, hoy: HOY, sociedadId: s.sociedadId },
      );

      const d = await deuda(tx, s.terceroId);
      expect(d.puesto.toFixed(8)).toBe("31.25000000");
      expect(d.capitalRecuperado.toFixed(8)).toBe("31.25000000");
      const ganTercero = new Decimal(await gananciaDe(tx, s.terceroId));
      expect(ganTercero.minus(new Decimal("12.26635514").div(2)).abs().lte("0.00000001")).toBe(true);

      const [aporte] = await tx
        .select({ m: sql<string>`sum(${asientos.monto})` })
        .from(asientos)
        .where(and(eq(asientos.cuenta, "capital"), eq(asientos.participanteId, s.terceroId), eq(asientos.prestamoId, nuevo.id)));
      expect(aporte!.m).toBe("-31.25000000");
    });
  });
});

async function insertPagoEfectivo(tx: Tx, s: { clienteId: string; usuarioId: string }) {
  return insertarPago(
    tx,
    await pagoFifo(tx, s.clienteId, { fecha: "2026-02-01", tipo: "efectivo", ars: new Decimal("120000"), tcSalida: null }),
    { usuarioId: s.usuarioId },
  );
}
