/**
 * Edición de préstamos con cobros contra la base real: el préstamo se anula, se
 * da de alta el corregido y los cobros se vuelven a imputar sobre él (lo cobrado
 * no cambia). Termina siempre en ROLLBACK.
 */
import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, type Tx } from "@/db";
import { insertarPrestamo, type AltaPrestamo } from "@/db/alta-prestamo";
import { anular, ErrorAnulacion } from "@/db/anulaciones";
import { efectivoPendiente, insertarConversion } from "@/db/conversion";
import { corregirPrestamo } from "@/db/correccion-prestamo";
import { cargarDeudaCliente, insertarPago, saldoFavorCliente } from "@/db/registrar-pago";
import { anulaciones, asientos, cargos, clientes, imputaciones, pagos, participantes, prestamos, usuarios } from "@/db/schema";
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

const HOY = "2026-10-08";

/** 100.000 ARS a TC 1.600 (62,5 USDT), 20% total, 2 cuotas mensuales de 60.000 (vencen 01/02 y 01/03). */
const BASE = (clienteId: string): AltaPrestamo => ({
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
});

async function escenario(tx: Tx) {
  const [u] = await tx.insert(usuarios).values({ email: `test-${crypto.randomUUID()}@test.local`, nombre: "Test" }).returning();
  await tx.execute(sql`select set_config('app.usuario_id', ${u!.id}, true)`);
  const [c] = await tx.insert(clientes).values({ nombre: "Cliente test", creadoPor: u!.id }).returning();
  let [soc] = await tx.select().from(participantes).where(eq(participantes.tipo, "sociedad"));
  soc ??= (await tx.insert(participantes).values({ nombre: "Sociedad", tipo: "sociedad" }).returning())[0];
  const ctx = { usuarioId: u!.id, sociedadId: soc!.id };
  const alta = (cambios: Partial<AltaPrestamo> = {}) => insertarPrestamo(tx, { ...BASE(c!.id), ...cambios }, ctx);
  const { id: prestamoId } = await alta();
  return { ...ctx, clienteId: c!.id, prestamoId, alta, ctxCorreccion: { ...ctx, hoy: HOY } };
}

type Escenario = Awaited<ReturnType<typeof escenario>>;

/** En la app cada operación es una transacción; acá todas comparten una, así que cada una lleva su instante. */
async function instante(tx: Tx) {
  const [f] = await tx.execute<{ t: string }>(sql`select clock_timestamp()::text as t`);
  return sql`${f!.t}::timestamptz`;
}

/** Cobro FIFO sobre toda la deuda del cliente. */
async function pagar(tx: Tx, s: Escenario, fecha: string, ars: string, o: { efectivo?: boolean; tc?: string } = {}) {
  const { deudas } = deudasAFecha(await cargarDeudaCliente(tx, s.clienteId), fecha);
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
      montos: distribuirFifo(ars, deudas),
      usarSaldo: false,
      descuentos: new Map(),
      motivoDescuento: null,
    },
    { usuarioId: s.usuarioId, creadoEn: await instante(tx) },
  );
  return pagoId!;
}

const suma = async (tx: Tx, cuenta: "cartera" | "ganancia" | "caja_usdt" | "caja_efectivo_ars", prestamoId?: string) =>
  new Decimal(
    (
      await tx
        .select({ m: sql<string>`coalesce(sum(${asientos.monto}), 0)` })
        .from(asientos)
        .where(prestamoId ? and(eq(asientos.cuenta, cuenta), eq(asientos.prestamoId, prestamoId)) : eq(asientos.cuenta, cuenta))
    )[0]!.m,
  ).toFixed(8);

const prestamo = async (tx: Tx, id: string) => (await tx.select().from(prestamos).where(eq(prestamos.id, id)))[0]!;

const pagosVigentes = (tx: Tx, clienteId: string) =>
  tx
    .select()
    .from(pagos)
    .where(
      and(
        eq(pagos.clienteId, clienteId),
        sql`${pagos.id} not in (select entidad_id from ${anulaciones} where ${anulaciones.entidad} = 'pagos')`,
      ),
    );

describe("editar préstamo con cobros", () => {
  it("cambia el TC: el cobro se mantiene y se recalcula recupero y ganancia", async () => {
    await enRollback(async (tx) => {
      const s = await escenario(tx);
      await pagar(tx, s, "2026-01-20", "120000"); // 75 USDT: 62,5 recupero + 12,5 ganancia
      expect(await suma(tx, "ganancia", s.prestamoId)).toBe("-12.50000000");
      const caja = new Decimal(await suma(tx, "caja_usdt"));

      const r = await corregirPrestamo(
        tx,
        { id: s.prestamoId, datos: { ...BASE(s.clienteId), tcEntrada: new Decimal("1250") }, motivo: "TC mal cargado" },
        s.ctxCorreccion,
      );
      expect(r.cobros).toBe(1);

      const viejo = await prestamo(tx, s.prestamoId);
      const nuevo = await prestamo(tx, r.id);
      expect(viejo.estado).toBe("anulado");
      expect(nuevo.corrigeAId).toBe(s.prestamoId);
      expect(nuevo.usdtPrestado).toBe("80.00000000");
      // 75 USDT cobrados no alcanzan el costo de 80: todo es recupero, sin ganancia.
      expect(await suma(tx, "cartera", r.id)).toBe("5.00000000");
      expect(await suma(tx, "ganancia", r.id)).toBe("0.00000000");
      expect(await suma(tx, "cartera", s.prestamoId)).toBe("0.00000000");
      expect(await suma(tx, "ganancia", s.prestamoId)).toBe("0.00000000");
      // La plata cobrada no cambia; solo el desembolso (17,5 USDT más).
      expect(new Decimal(await suma(tx, "caja_usdt")).minus(caja).toFixed(8)).toBe("-17.50000000");
      // ARS: pagó los 120.000 que debe → cancelado.
      expect(nuevo.estado).toBe("cancelado");

      const vigentes = await pagosVigentes(tx, s.clienteId);
      expect(vigentes.map((p) => [p.fecha, p.ars, p.tcSalida])).toEqual([["2026-01-20", "120000.00", "1600.000000"]]);
    });
  });

  it("baja el capital: lo cobrado de más queda como saldo a favor", async () => {
    await enRollback(async (tx) => {
      const s = await escenario(tx);
      await pagar(tx, s, "2026-01-20", "120000");

      const r = await corregirPrestamo(
        tx,
        { id: s.prestamoId, datos: { ...BASE(s.clienteId), arsCapital: new Decimal("50000") }, motivo: "Capital mal cargado" },
        s.ctxCorreccion,
      );
      expect((await prestamo(tx, r.id)).estado).toBe("cancelado");
      expect((await saldoFavorCliente(tx, s.clienteId)).toFixed(2)).toBe("60000.00");
    });
  });

  it("la mora se recalcula con las condiciones nuevas", async () => {
    await enRollback(async (tx) => {
      const s = await escenario(tx);
      // Cuota 1 vence 01/02, gracia 5: el 20/02 nace mora 20% × 50.000 = 10.000.
      await pagar(tx, s, "2026-02-20", "70000");

      const r = await corregirPrestamo(
        tx,
        { id: s.prestamoId, datos: { ...BASE(s.clienteId), moraPct: new Decimal("10") }, motivo: "Mora pactada al 10%" },
        s.ctxCorreccion,
      );
      const mora = await tx.select({ ars: cargos.ars }).from(cargos).where(and(eq(cargos.prestamoId, r.id), eq(cargos.tipo, "mora")));
      expect(mora.map((m) => m.ars)).toEqual(["5000.00"]);
      // 70.000 = 5.000 mora + 60.000 cuota 1 + 5.000 a la cuota 2.
      const imp = await tx
        .select({ concepto: imputaciones.concepto, ars: sql<string>`sum(${imputaciones.ars})` })
        .from(imputaciones)
        .where(eq(imputaciones.prestamoId, r.id))
        .groupBy(imputaciones.concepto);
      const por = Object.fromEntries(imp.map((i) => [i.concepto, i.ars]));
      expect(por).toEqual({ mora: "5000.00", interes: "15000.00", capital: "50000.00" });
    });
  });

  it("efectivo convertido: la conversión se repite con el mismo TC", async () => {
    await enRollback(async (tx) => {
      const s = await escenario(tx);
      const pagoId = await pagar(tx, s, "2026-01-20", "120000", { efectivo: true });
      await insertarConversion(
        tx,
        { fecha: "2026-01-21", ars: new Decimal("120000"), tc: new Decimal("1500"), notas: null, lotes: new Map([[pagoId, new Decimal("120000")]]) },
        { usuarioId: s.usuarioId, creadoEn: await instante(tx) },
      );
      const efectivo = await suma(tx, "caja_efectivo_ars");

      const r = await corregirPrestamo(
        tx,
        { id: s.prestamoId, datos: { ...BASE(s.clienteId), tcEntrada: new Decimal("1250") }, motivo: "TC mal cargado" },
        s.ctxCorreccion,
      );
      expect(await suma(tx, "caja_efectivo_ars")).toBe(efectivo);
      expect((await efectivoPendiente(tx)).filter((p) => p.clienteId === s.clienteId)).toEqual([]);
      // 120.000 / 1.500 = 80 USDT = el costo nuevo: recupera todo, sin ganancia.
      expect(await suma(tx, "cartera", r.id)).toBe("0.00000000");
      expect(await suma(tx, "ganancia", r.id)).toBe("0.00000000");
    });
  });

  it("lo que fue a otro préstamo del cliente se repite igual", async () => {
    await enRollback(async (tx) => {
      const s = await escenario(tx);
      const { id: otroId } = await s.alta({ fechaDesembolso: "2025-12-15" }); // vence antes: FIFO primero
      await pagar(tx, s, "2026-01-20", "150000"); // 60.000 al otro (cuota 1) + 60.000 cuota 1 + 30.000 cuota 2 (ambos préstamos)
      const imputadoOtro = async () =>
        (
          await tx
            .select({ ars: sql<string>`coalesce(sum(${imputaciones.ars}), 0)` })
            .from(imputaciones)
            .innerJoin(pagos, eq(pagos.id, imputaciones.pagoId))
            .where(
              and(
                eq(imputaciones.prestamoId, otroId),
                sql`${pagos.id} not in (select entidad_id from ${anulaciones} where ${anulaciones.entidad} = 'pagos')`,
              ),
            )
        )[0]!.ars;
      const antes = await imputadoOtro();
      const carteraOtro = await suma(tx, "cartera", otroId);

      await corregirPrestamo(
        tx,
        { id: s.prestamoId, datos: { ...BASE(s.clienteId), tasaTotalPct: new Decimal("10") }, motivo: "Tasa mal cargada" },
        s.ctxCorreccion,
      );
      expect(await imputadoOtro()).toBe(antes);
      expect(await suma(tx, "cartera", otroId)).toBe(carteraOtro);
    });
  });

  it("los descuentos pasan a la cuota del mismo número del préstamo corregido", async () => {
    await enRollback(async (tx) => {
      const s = await escenario(tx);
      const { deudas } = deudasAFecha(await cargarDeudaCliente(tx, s.clienteId), "2026-01-20");
      const descuentos = new Map([[deudas[0]!.clave, new Decimal("3000")]]);
      await insertarPago(
        tx,
        {
          clienteId: s.clienteId,
          fecha: "2026-01-20",
          tipo: "transferencia",
          ars: new Decimal("57000"),
          tcSalida: new Decimal("1600"),
          metodo: null,
          notas: null,
          montos: new Map([[deudas[0]!.clave, new Decimal("57000")]]),
          usarSaldo: false,
          descuentos,
          motivoDescuento: "Pronto pago",
        },
        { usuarioId: s.usuarioId, creadoEn: await instante(tx) },
      );

      const r = await corregirPrestamo(
        tx,
        { id: s.prestamoId, datos: { ...BASE(s.clienteId), tcEntrada: new Decimal("1500") }, motivo: "TC mal cargado" },
        s.ctxCorreccion,
      );
      const desc = await tx.select({ ars: cargos.ars, motivo: cargos.motivo }).from(cargos).where(and(eq(cargos.prestamoId, r.id), eq(cargos.tipo, "descuento")));
      expect(desc).toEqual([{ ars: "-3000.00", motivo: "Pronto pago (cuota 1)" }]);
      // La cuota 1 sigue saldada: 57.000 + 3.000 de descuento.
      const { deudas: despues } = deudasAFecha(await cargarDeudaCliente(tx, s.clienteId), "2026-01-21");
      expect(despues.map((d) => [d.cuotaNumero, d.total.toFixed(2)])).toEqual([[2, "60000.00"]]);
    });
  });

  it("un saldo a favor aplicado al préstamo arrastra su pago de origen", async () => {
    await enRollback(async (tx) => {
      const s = await escenario(tx);
      const { id: otroId } = await s.alta({ fechaDesembolso: "2025-12-01" });
      await pagar(tx, s, "2026-01-05", "250000"); // dentro de la gracia: salda ambos (240.000) y deja 10.000 a favor
      expect((await saldoFavorCliente(tx, s.clienteId)).toFixed(2)).toBe("10000.00");
      const { id: terceroId } = await s.alta({ fechaDesembolso: "2026-01-15" });
      // Solo aplica el saldo a favor al tercer préstamo.
      const { deudas } = deudasAFecha(await cargarDeudaCliente(tx, s.clienteId), "2026-02-01");
      await insertarPago(
        tx,
        {
          clienteId: s.clienteId,
          fecha: "2026-02-01",
          tipo: "transferencia",
          ars: new Decimal(0),
          tcSalida: null,
          metodo: null,
          notas: null,
          montos: new Map([[deudas[0]!.clave, new Decimal("10000")]]),
          usarSaldo: true,
          descuentos: new Map(),
          motivoDescuento: null,
        },
        { usuarioId: s.usuarioId, creadoEn: await instante(tx) },
      );
      expect((await saldoFavorCliente(tx, s.clienteId)).toFixed(2)).toBe("0.00");

      // Se edita el tercero: hay que rebobinar desde el pago de origen del saldo.
      const r = await corregirPrestamo(
        tx,
        { id: terceroId, datos: { ...BASE(s.clienteId), fechaDesembolso: "2026-01-15", arsCapital: new Decimal("90000") }, motivo: "Capital mal cargado" },
        s.ctxCorreccion,
      );
      expect((await prestamo(tx, s.prestamoId)).estado).toBe("cancelado");
      expect((await prestamo(tx, otroId)).estado).toBe("cancelado");
      const imp = await tx
        .select({ ars: sql<string>`sum(${imputaciones.ars})` })
        .from(imputaciones)
        .where(
          and(
            eq(imputaciones.prestamoId, r.id),
            sql`${imputaciones.pagoId} not in (select entidad_id from ${anulaciones} where ${anulaciones.entidad} = 'pagos')`,
          ),
        );
      expect(imp[0]!.ars).toBe("10000.00");
      expect((await saldoFavorCliente(tx, s.clienteId)).toFixed(2)).toBe("0.00");
      expect(await pagosVigentes(tx, s.clienteId)).toHaveLength(1);
    });
  });

  it("una mora perdonada sigue perdonada en el préstamo editado", async () => {
    await enRollback(async (tx) => {
      const s = await escenario(tx);
      await pagar(tx, s, "2026-02-20", "70000"); // nace mora 10.000 en la cuota 1
      const [mora] = await tx.select().from(cargos).where(and(eq(cargos.prestamoId, s.prestamoId), eq(cargos.tipo, "mora")));
      // Se perdona: para eso primero se anula el pago que la cubrió.
      const [pago] = await pagosVigentes(tx, s.clienteId);
      await anular(tx, "pagos", { id: pago!.id, motivo: "x" }, { usuarioId: s.usuarioId, hoy: HOY });
      await anular(tx, "cargos", { id: mora!.id, motivo: "Perdonada" }, { usuarioId: s.usuarioId, hoy: HOY });
      await pagar(tx, s, "2026-02-21", "60000");

      const r = await corregirPrestamo(
        tx,
        { id: s.prestamoId, datos: { ...BASE(s.clienteId), tasaMensualPct: new Decimal("12") }, motivo: "Tasa mensual" },
        s.ctxCorreccion,
      );
      const { deudas } = deudasAFecha(await cargarDeudaCliente(tx, s.clienteId), "2026-02-21");
      // Sin mora en la cuota 1: los 60.000 la saldaron, queda solo la cuota 2.
      expect(deudas.map((x) => [x.cuotaNumero, x.mora.toFixed(2), x.total.toFixed(2)])).toEqual([[2, "0.00", "60000.00"]]);
      const morasNuevo = await tx.select({ id: cargos.id }).from(cargos).where(and(eq(cargos.prestamoId, r.id), eq(cargos.tipo, "mora")));
      expect(morasNuevo).toHaveLength(1);
    });
  });

  it("con cobros no se cambia el cliente ni se pasa el desembolso después del primer cobro", async () => {
    await enRollback(async (tx) => {
      const s = await escenario(tx);
      await pagar(tx, s, "2026-01-20", "10000");
      const [otro] = await tx.insert(clientes).values({ nombre: "Otro", creadoPor: s.usuarioId }).returning();

      await expect(
        corregirPrestamo(tx, { id: s.prestamoId, datos: BASE(otro!.id), motivo: "x" }, s.ctxCorreccion),
      ).rejects.toThrow("el cliente no se puede cambiar");
      await expect(
        corregirPrestamo(tx, { id: s.prestamoId, datos: { ...BASE(s.clienteId), fechaDesembolso: "2026-01-25" }, motivo: "x" }, s.ctxCorreccion),
      ).rejects.toBeInstanceOf(ErrorAnulacion);
    });
  });
});
