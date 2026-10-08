import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import type { db, Tx } from "./index";
import {
  anulaciones,
  asientos,
  clientes,
  conversionLotes,
  conversiones,
  imputaciones,
  pagos,
  prestamoParticipaciones,
  prestamos,
  transacciones,
  usuarios,
} from "./schema";
import type { Asiento } from "@/engine/asientos";
import { armarLotes, asientosConversionLote, ErrorConversion, type EfectivoPendiente } from "@/engine/conversion";
import type { Fecha } from "@/engine/fechas";
import { DECIMALES } from "@/engine/redondeo";
import { formatearFecha } from "@/lib/formato";
import { formatearArs, formatearNumero } from "@/lib/numeros";
import { numeroPrestamo } from "@/lib/prestamos";

type Lector = typeof db | Tx;

export { ErrorConversion };

const anuladas = (l: Lector, entidad: string) =>
  l.select({ id: anulaciones.entidadId }).from(anulaciones).where(eq(anulaciones.entidad, entidad));

export interface LoteDisponible extends EfectivoPendiente {
  clienteId: string;
  clienteNombre: string;
  ars: Decimal;
  convertido: Decimal;
  pendiente: Decimal;
  /** Imputación vigente del pago: ARS por préstamo (con su número) y saldo a favor. */
  porPrestamo: { prestamoId: string; numero: number; ars: Decimal }[];
  saldoFavor: Decimal;
}

/** Pagos en efectivo con ARS sin convertir, del más viejo al más nuevo. */
export async function efectivoPendiente(l: Lector): Promise<LoteDisponible[]> {
  const convertido = sql<string>`coalesce((
    select sum(${conversionLotes.ars}) from ${conversionLotes}
    where ${conversionLotes.pagoId} = ${pagos.id}
      and ${conversionLotes.conversionId} not in (select entidad_id from anulaciones where entidad = 'conversiones')
  ), 0)`;
  const filas = await l
    .select({
      pagoId: pagos.id,
      fecha: pagos.fecha,
      ars: pagos.ars,
      clienteId: clientes.id,
      clienteNombre: clientes.nombre,
      convertido,
    })
    .from(pagos)
    .innerJoin(clientes, eq(clientes.id, pagos.clienteId))
    .where(and(eq(pagos.tipo, "efectivo"), notInArray(pagos.id, anuladas(l, "pagos")), sql`${pagos.ars} > ${convertido}`))
    .orderBy(asc(pagos.fecha), asc(pagos.creadoEn));
  if (filas.length === 0) return [];

  const imps = await l
    .select({
      pagoId: imputaciones.pagoId,
      prestamoId: imputaciones.prestamoId,
      numero: prestamos.numero,
      ars: sql<string>`sum(${imputaciones.ars})`,
    })
    .from(imputaciones)
    .leftJoin(prestamos, eq(prestamos.id, imputaciones.prestamoId))
    .where(inArray(imputaciones.pagoId, filas.map((f) => f.pagoId)))
    .groupBy(imputaciones.pagoId, imputaciones.prestamoId, prestamos.numero)
    .orderBy(asc(prestamos.numero));

  return filas.map((f) => {
    const propias = imps.filter((i) => i.pagoId === f.pagoId);
    const ars = new Decimal(f.ars);
    const conv = new Decimal(f.convertido);
    return {
      pagoId: f.pagoId,
      fecha: f.fecha,
      clienteId: f.clienteId,
      clienteNombre: f.clienteNombre,
      ars,
      convertido: conv,
      pendiente: ars.minus(conv),
      porPrestamo: propias
        .filter((i) => i.prestamoId && new Decimal(i.ars).gt(0))
        .map((i) => ({ prestamoId: i.prestamoId!, numero: i.numero!, ars: new Decimal(i.ars) })),
      saldoFavor: new Decimal(propias.find((i) => !i.prestamoId)?.ars ?? 0),
    };
  });
}

export interface NuevaConversion {
  fecha: Fecha;
  ars: Decimal;
  tc: Decimal;
  notas: string | null;
  /** ARS a convertir por pago en efectivo. */
  lotes: Map<string, Decimal>;
}

/**
 * Registra una conversión de efectivo a USDT con sus lotes. Cada lote es una
 * transacción propia (con el pago de origen) que saca los ARS de la caja de
 * efectivo, ingresa los USDT y, según la imputación del pago, recupera costo,
 * reconoce ganancia o deja saldo a favor. Los pagos se bloquean para que dos
 * conversiones simultáneas no conviertan el mismo efectivo.
 */
export async function insertarConversion(
  tx: Tx,
  d: NuevaConversion,
  ctx: { usuarioId: string; creadoEn?: SQL },
): Promise<{ conversionId: string; prestamos: string[] }> {
  const alta = { creadoPor: ctx.usuarioId, ...(ctx.creadoEn && { creadoEn: ctx.creadoEn }) };
  const ids = [...d.lotes.keys()];
  if (ids.length) await tx.select({ id: pagos.id }).from(pagos).where(inArray(pagos.id, ids)).for("update");

  const pendientes = await efectivoPendiente(tx);
  const { usdt, lotes } = armarLotes({ fecha: d.fecha, ars: d.ars, tc: d.tc, pendientes, lotes: d.lotes });
  const porPago = new Map(pendientes.map((p) => [p.pagoId, p]));

  const [conversion] = await tx
    .insert(conversiones)
    .values({
      fecha: d.fecha,
      ars: d.ars.toFixed(DECIMALES.ars),
      tc: d.tc.toFixed(DECIMALES.tc),
      usdtResultante: usdt.toFixed(DECIMALES.usdt),
      notas: d.notas,
      ...alta,
    })
    .returning({ id: conversiones.id });
  const conversionId = conversion!.id;
  await tx.insert(conversionLotes).values(lotes.map((l) => ({ conversionId, pagoId: l.pagoId, ars: l.ars.toFixed(DECIMALES.ars) })));

  const prestamoIds = [...new Set(lotes.flatMap((l) => porPago.get(l.pagoId)!.porPrestamo.map((p) => p.prestamoId)))];
  const [carteras, partes] = prestamoIds.length
    ? await Promise.all([
        tx
          .select({ prestamoId: asientos.prestamoId, monto: sql<string>`sum(${asientos.monto})` })
          .from(asientos)
          .where(and(inArray(asientos.prestamoId, prestamoIds), eq(asientos.cuenta, "cartera")))
          .groupBy(asientos.prestamoId),
        tx.select().from(prestamoParticipaciones).where(inArray(prestamoParticipaciones.prestamoId, prestamoIds)),
      ])
    : [[], []];
  const cartera = new Map<string, Decimal.Value>(carteras.map((c) => [c.prestamoId!, c.monto]));
  const participaciones = new Map(
    prestamoIds.map((id) => [
      id,
      partes.filter((x) => x.prestamoId === id).map((x) => ({ participanteId: x.participanteId, pctGanancia: x.pctGanancia })),
    ]),
  );

  for (const l of lotes) {
    const p = porPago.get(l.pagoId)!;
    const destino = [...p.porPrestamo.map((x) => numeroPrestamo(x.numero)), ...(p.saldoFavor.gt(0) ? ["saldo a favor"] : [])].join(", ");
    const [t] = await tx
      .insert(transacciones)
      .values({
        fecha: d.fecha,
        tipo: "conversion",
        descripcion: `Conversión de $${formatearArs(l.ars)} en efectivo (${p.clienteNombre}, pago del ${formatearFecha(p.fecha)}) a TC ${formatearNumero(d.tc, d.tc.decimalPlaces())} → ${destino}`,
        prestamoId: p.porPrestamo.length === 1 ? p.porPrestamo[0]!.prestamoId : null,
        pagoId: l.pagoId,
        conversionId,
        ...alta,
      })
      .returning({ id: transacciones.id });
    const { asientos: lineas } = asientosConversionLote({
      ars: l.ars,
      usdt: l.usdt,
      porPrestamo: p.porPrestamo,
      saldoFavorArs: p.saldoFavor,
      clienteId: p.clienteId,
      cartera,
      participaciones,
    });
    for (const a of lineas) if (a.cuenta === "cartera") cartera.set(a.prestamoId!, new Decimal(cartera.get(a.prestamoId!) ?? 0).plus(a.monto));
    await tx.insert(asientos).values(lineas.map((a: Asiento) => ({
      transaccionId: t!.id,
      cuenta: a.cuenta,
      moneda: a.moneda,
      monto: a.monto.toFixed(DECIMALES.usdt),
      prestamoId: a.prestamoId,
      participanteId: a.participanteId,
      clienteId: a.clienteId,
    })));
  }

  return { conversionId, prestamos: prestamoIds };
}

export interface ConversionHistorial {
  id: string;
  fecha: Fecha;
  ars: Decimal;
  tc: Decimal;
  usdt: Decimal;
  lotes: number;
  notas: string | null;
  usuario: string;
  anulada: boolean;
}

export async function historialConversiones(l: Lector, limite = 50): Promise<ConversionHistorial[]> {
  const filas = await l
    .select({
      id: conversiones.id,
      fecha: conversiones.fecha,
      ars: conversiones.ars,
      tc: conversiones.tc,
      usdt: conversiones.usdtResultante,
      notas: conversiones.notas,
      usuario: usuarios.nombre,
      lotes: sql<number>`(select count(*)::int from ${conversionLotes} where ${conversionLotes.conversionId} = ${conversiones.id})`,
      anulada: sql<boolean>`${conversiones.id} in (select entidad_id from anulaciones where entidad = 'conversiones')`,
    })
    .from(conversiones)
    .innerJoin(usuarios, eq(usuarios.id, conversiones.creadoPor))
    .orderBy(desc(conversiones.fecha), desc(conversiones.creadoEn))
    .limit(limite);
  return filas.map((f) => ({ ...f, ars: new Decimal(f.ars), tc: new Decimal(f.tc), usdt: new Decimal(f.usdt) }));
}

/** Saldo de la caja de efectivo según el libro (debería coincidir con lo pendiente de convertir). */
export async function saldoCajaEfectivo(l: Lector): Promise<Decimal> {
  const [fila] = await l
    .select({ ars: sql<string>`coalesce(sum(${asientos.monto}), 0)` })
    .from(asientos)
    .where(eq(asientos.cuenta, "caja_efectivo_ars"));
  return new Decimal(fila?.ars ?? 0);
}
