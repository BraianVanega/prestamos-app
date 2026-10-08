/**
 * Anulaciones contra la base real: contraasientos, reapertura de préstamos,
 * dependencias (conversión antes que el pago, lo más nuevo primero) y cargos.
 * Termina siempre en ROLLBACK.
 */
import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, type Tx } from "@/db";
import { insertarPrestamo } from "@/db/alta-prestamo";
import { anular, anularPrestamo, ErrorAnulacion, historialAnulaciones } from "@/db/anulaciones";
import { efectivoPendiente, insertarConversion } from "@/db/conversion";
import { cargarDeudaCliente, insertarPago } from "@/db/registrar-pago";
import { asientos, cargos, clientes, participantes, prestamos, usuarios } from "@/db/schema";
import { cuentasSocios, insertarAporte } from "@/db/socios";
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

const HOY = "2026-10-07";

/** Préstamo de 100.000 ARS a TC 1.600 (62,5 USDT), 2 cuotas mensuales de 60.000 (vencen 01/02 y 01/03). */
async function alta(tx: Tx) {
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
  return { usuarioId: u!.id, clienteId: c!.id, prestamoId, ctx: { usuarioId: u!.id, hoy: HOY } };
}

type Escenario = Awaited<ReturnType<typeof alta>>;

async function pagar(
  tx: Tx,
  s: Escenario,
  fecha: string,
  ars: string,
  o: { efectivo?: boolean; tc?: string; descuentoCuota?: number; descuento?: string } = {},
) {
  const { deudas } = deudasAFecha(await cargarDeudaCliente(tx, s.clienteId), fecha);
  const descuentos = new Map<string, Decimal>();
  if (o.descuentoCuota) descuentos.set(deudas.find((d) => d.cuotaNumero === o.descuentoCuota)!.clave, new Decimal(o.descuento!));
  const conDescuento = aplicarDescuentos(deudas, descuentos).deudas;
  const { pagoId } = await insertarPago(
    tx,
    {
      clienteId: s.clienteId,
      fecha,
      tipo: o.efectivo ? "efectivo" : "transferencia",
      ars: new Decimal(ars),
      tcSalida: o.efectivo ? null : new Decimal(o.tc ?? "1600"),
      metodo: null,
      notas: null,
      montos: distribuirFifo(ars, conDescuento),
      usarSaldo: false,
      descuentos,
      motivoDescuento: descuentos.size ? "Pronto pago" : null,
    },
    { usuarioId: s.usuarioId },
  );
  return pagoId!;
}

const saldo = async (tx: Tx, cuenta: "cartera" | "ganancia" | "caja_efectivo_ars", prestamoId?: string) =>
  new Decimal(
    (
      await tx
        .select({ m: sql<string>`coalesce(sum(${asientos.monto}), 0)` })
        .from(asientos)
        .where(prestamoId ? and(eq(asientos.cuenta, cuenta), eq(asientos.prestamoId, prestamoId)) : eq(asientos.cuenta, cuenta))
    )[0]!.m,
  ).toFixed(8);

const estado = async (tx: Tx, id: string) => (await tx.select({ e: prestamos.estado }).from(prestamos).where(eq(prestamos.id, id)))[0]!.e;

const pendienteTotal = async (tx: Tx, s: Escenario, fecha: string) =>
  deudasAFecha(await cargarDeudaCliente(tx, s.clienteId), fecha)
    .deudas.reduce((t, d) => t.plus(d.total), new Decimal(0))
    .toFixed(2);

describe("anular pago", () => {
  it("revierte recupero y ganancia, reabre el préstamo y no se anula dos veces", async () => {
    await enRollback(async (tx) => {
      const s = await alta(tx);
      const pagoId = await pagar(tx, s, "2026-01-20", "120000"); // 75 USDT: 62,5 recupero + 12,5 ganancia
      expect(await estado(tx, s.prestamoId)).toBe("cancelado");
      expect(await saldo(tx, "ganancia", s.prestamoId)).toBe("-12.50000000");

      const r = await anular(tx, "pagos", { id: pagoId, motivo: "Transferencia rebotada" }, s.ctx);
      expect(r.reabiertos).toEqual([s.prestamoId]);
      expect(await estado(tx, s.prestamoId)).toBe("vigente");
      expect(await saldo(tx, "cartera", s.prestamoId)).toBe("62.50000000");
      expect(await saldo(tx, "ganancia", s.prestamoId)).toBe("0.00000000");
      expect(await pendienteTotal(tx, s, "2026-01-20")).toBe("120000.00");

      await expect(anular(tx, "pagos", { id: pagoId, motivo: "otra vez" }, s.ctx)).rejects.toThrow(/ya está anulado/);
      const [h] = await historialAnulaciones(tx);
      expect(h!.descripcion).toBe("Pago por transferencia de $120.000,00 de Cliente test (20/01/2026)");
      expect(h!.motivo).toBe("Transferencia rebotada");
    });
  });

  it("lo más nuevo primero: un pago posterior sobre el mismo préstamo bloquea", async () => {
    await enRollback(async (tx) => {
      const s = await alta(tx);
      const primero = await pagar(tx, s, "2026-01-20", "60000");
      const segundo = await pagar(tx, s, "2026-01-25", "60000");
      await expect(anular(tx, "pagos", { id: primero, motivo: "error" }, s.ctx)).rejects.toThrow(/movimiento posterior/);
      await anular(tx, "pagos", { id: segundo, motivo: "error" }, s.ctx);
      await anular(tx, "pagos", { id: primero, motivo: "error" }, s.ctx);
      expect(await saldo(tx, "cartera", s.prestamoId)).toBe("62.50000000");
      expect(await estado(tx, s.prestamoId)).toBe("vigente");
    });
  });

  it("efectivo convertido: primero la conversión, después el pago", async () => {
    await enRollback(async (tx) => {
      const s = await alta(tx);
      const cajaAntes = await saldo(tx, "caja_efectivo_ars");
      const pagoId = await pagar(tx, s, "2026-01-20", "120000", { efectivo: true });
      const { conversionId } = await insertarConversion(
        tx,
        { fecha: "2026-01-21", ars: new Decimal("120000"), tc: new Decimal("1605"), notas: null, lotes: new Map([[pagoId, new Decimal("120000")]]) },
        { usuarioId: s.usuarioId },
      );
      await expect(anular(tx, "pagos", { id: pagoId, motivo: "error" }, s.ctx)).rejects.toThrow(/anulá primero la conversión/);

      await anular(tx, "conversiones", { id: conversionId, motivo: "TC mal cargado" }, s.ctx);
      expect(await saldo(tx, "cartera", s.prestamoId)).toBe("62.50000000");
      expect(await saldo(tx, "ganancia", s.prestamoId)).toBe("0.00000000");
      expect((await efectivoPendiente(tx)).find((p) => p.pagoId === pagoId)?.pendiente.toFixed(2)).toBe("120000.00");

      await anular(tx, "pagos", { id: pagoId, motivo: "error" }, s.ctx);
      expect(await saldo(tx, "caja_efectivo_ars")).toBe(cajaAntes);
      expect((await efectivoPendiente(tx)).some((p) => p.pagoId === pagoId)).toBe(false);
      expect(await estado(tx, s.prestamoId)).toBe("vigente");
    });
  });
});

describe("anular cargo", () => {
  it("una mora cobrada no se anula hasta anular el pago; después queda perdonada", async () => {
    await enRollback(async (tx) => {
      const s = await alta(tx);
      // 10/02: 9 días de atraso > 5 de gracia → mora 20% × 50.000 = 10.000.
      const pagoId = await pagar(tx, s, "2026-02-10", "70000");
      const [mora] = await tx.select().from(cargos).where(and(eq(cargos.prestamoId, s.prestamoId), eq(cargos.tipo, "mora")));
      expect(mora!.ars).toBe("10000.00");
      await expect(anular(tx, "cargos", { id: mora!.id, motivo: "Se perdona" }, s.ctx)).rejects.toThrow(/ya se cobró/);

      await anular(tx, "pagos", { id: pagoId, motivo: "error" }, s.ctx);
      await anular(tx, "cargos", { id: mora!.id, motivo: "Se perdona" }, s.ctx);
      // Sin mora nueva para la cuota 1: queda el plan original.
      expect(await pendienteTotal(tx, s, "2026-02-10")).toBe("120000.00");
    });
  });

  it("anular un descuento reabre el préstamo que había cancelado", async () => {
    await enRollback(async (tx) => {
      const s = await alta(tx);
      await pagar(tx, s, "2026-01-20", "110000", { descuentoCuota: 2, descuento: "10000" });
      expect(await estado(tx, s.prestamoId)).toBe("cancelado");
      const [desc] = await tx.select().from(cargos).where(and(eq(cargos.prestamoId, s.prestamoId), eq(cargos.tipo, "descuento")));

      const r = await anular(tx, "cargos", { id: desc!.id, motivo: "No correspondía" }, s.ctx);
      expect(r.reabiertos).toEqual([s.prestamoId]);
      expect(await estado(tx, s.prestamoId)).toBe("vigente");
      expect(await pendienteTotal(tx, s, "2026-01-20")).toBe("10000.00");
    });
  });
});

describe("anular aporte", () => {
  it("saca el aporte de la caja y del capital", async () => {
    await enRollback(async (tx) => {
      const s = await alta(tx);
      const antes = await cuentasSocios(tx);
      const { transaccionId } = await insertarAporte(
        tx,
        { fecha: "2026-10-01", usdt: new Decimal("1000"), socio: "ambos", notas: null },
        { usuarioId: s.usuarioId },
      );
      await anular(tx, "aportes", { id: transaccionId, motivo: "Duplicado" }, s.ctx);
      const despues = await cuentasSocios(tx);
      expect(despues.caja.minus(antes.caja).toFixed(8)).toBe("0.00000000");
      expect(despues.socios.map((x) => x.capital.toFixed(8))).toEqual(antes.socios.map((x) => x.capital.toFixed(8)));
      await expect(anular(tx, "aportes", { id: transaccionId, motivo: "x" }, s.ctx)).rejects.toBeInstanceOf(ErrorAnulacion);
    });
  });
});

describe("corregir préstamo", () => {
  const caja = async (tx: Tx) =>
    new Decimal(
      (await tx.select({ m: sql<string>`coalesce(sum(${asientos.monto}), 0)` }).from(asientos).where(eq(asientos.cuenta, "caja_usdt")))[0]!.m,
    );

  it("anula el original (desembolso revertido) y da de alta el corregido vinculado", async () => {
    await enRollback(async (tx) => {
      const s = await alta(tx);
      const cajaAntes = await caja(tx);
      const [soc] = await tx.select().from(participantes).where(eq(participantes.tipo, "sociedad"));

      await anularPrestamo(tx, { id: s.prestamoId, motivo: "TC mal cargado" }, s.ctx);
      const { id: nuevoId } = await insertarPrestamo(
        tx,
        {
          clienteId: s.clienteId,
          fechaDesembolso: "2026-01-01",
          arsCapital: new Decimal("100000"),
          tcEntrada: new Decimal("1250"), // 80 USDT
          tasaMensualPct: new Decimal("10"),
          tasaTotalPct: new Decimal("20"),
          frecuencia: "mes",
          nCuotas: 2,
          moraPct: new Decimal("20"),
          diasGracia: 5,
          notas: null,
        },
        { usuarioId: s.usuarioId, sociedadId: soc!.id, corrigeAId: s.prestamoId },
      );

      const [viejo] = await tx.select().from(prestamos).where(eq(prestamos.id, s.prestamoId));
      expect(viejo!.estado).toBe("anulado");
      expect(viejo!.fechaCierre).toBe(HOY);
      expect(await saldo(tx, "cartera", s.prestamoId)).toBe("0.00000000");
      // El desembolso original vuelve a caja; sale solo el corregido.
      expect((await caja(tx)).minus(cajaAntes).toFixed(8)).toBe("-17.50000000");
      const [nuevo] = await tx.select().from(prestamos).where(eq(prestamos.id, nuevoId));
      expect(nuevo!.corrigeAId).toBe(s.prestamoId);

      // Ya no aparece entre las deudas del cliente; solo el corregido.
      expect((await cargarDeudaCliente(tx, s.clienteId)).map((p) => p.id)).toEqual([nuevoId]);
      const [h] = await historialAnulaciones(tx, 1);
      expect(h).toMatchObject({ entidad: "prestamos", motivo: "TC mal cargado", enlace: `/prestamos/${s.prestamoId}` });

      await expect(anularPrestamo(tx, { id: s.prestamoId, motivo: "otra vez" }, s.ctx)).rejects.toThrow("ya está anulado");
    });
  });

  it("con pagos vigentes (aunque sean efectivo sin convertir) no se corrige hasta anularlos", async () => {
    await enRollback(async (tx) => {
      const s = await alta(tx);
      const pagoId = await pagar(tx, s, "2026-01-20", "10000", { efectivo: true });
      await expect(anularPrestamo(tx, { id: s.prestamoId, motivo: "error" }, s.ctx)).rejects.toThrow("un pago vigente");

      await anular(tx, "pagos", { id: pagoId, motivo: "mal cargado" }, s.ctx);
      await anularPrestamo(tx, { id: s.prestamoId, motivo: "error" }, s.ctx);
      expect(await estado(tx, s.prestamoId)).toBe("anulado");
    });
  });

  it("un préstamo cancelado no se corrige", async () => {
    await enRollback(async (tx) => {
      const s = await alta(tx);
      await pagar(tx, s, "2026-01-20", "120000");
      expect(await estado(tx, s.prestamoId)).toBe("cancelado");
      await expect(anularPrestamo(tx, { id: s.prestamoId, motivo: "error" }, s.ctx)).rejects.toThrow("Solo se puede corregir un préstamo vigente");
    });
  });
});
