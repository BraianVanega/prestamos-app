import Decimal from "decimal.js";
import { aliasedTable, and, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { db, Tx } from "./index";
import { cargarDeuda } from "./registrar-pago";
import {
  anulaciones,
  asientos,
  cargos,
  clientes,
  conversionLotes,
  conversiones,
  cuotas,
  imputaciones,
  pagos,
  prestamos,
  transacciones,
  usuarios,
} from "./schema";
import {
  asientosReversa,
  ErrorAnulacion,
  transaccionesPosteriores,
  validarAnulacionCargo,
  type HuellaTransaccion,
} from "@/engine/anulacion";
import type { Asiento } from "@/engine/asientos";
import type { Fecha } from "@/engine/fechas";
import { deudasAFecha } from "@/engine/pago";
import { DECIMALES } from "@/engine/redondeo";
import type { EntidadAnulable } from "@/lib/anulaciones";
import { formatearFecha } from "@/lib/formato";
import { formatearArs, formatearTc } from "@/lib/numeros";
import { numeroPrestamo } from "@/lib/prestamos";

type Lector = typeof db | Tx;

export { ErrorAnulacion };

export type { EntidadAnulable };

export interface ContextoAnulacion {
  usuarioId: string;
  /** Fecha de la anulación (las contratransacciones van a esta fecha). */
  hoy: Fecha;
  /**
   * Corrección de un préstamo: se rebobina todo en orden (del más nuevo al más
   * viejo) para volver a registrarlo, así que no se exige anular antes lo
   * posterior, y cada contratransacción va a la fecha de la original (la
   * ganancia de cada mes queda como si se hubiera cargado bien desde el principio).
   */
  correccion?: boolean;
}

export interface ResultadoAnulacion {
  /** Préstamos cuya deuda o cartera cambió. */
  prestamos: string[];
  /** Préstamos que se reabrieron (o se cerraron) al recalcular la deuda. */
  reabiertos: string[];
  cerrados: string[];
}

/** Tabla que se marca en `anulaciones`; un aporte se marca por su transacción. */
const ENTIDAD_TABLA: Record<EntidadAnulable, string> = {
  pagos: "pagos",
  conversiones: "conversiones",
  aportes: "transacciones",
  cargos: "cargos",
};

const TIPOS_TX: Record<string, string> = {
  cobro: "Cobro",
  conversion: "Conversión",
  aplicacion_saldo_favor: "Aplicación de saldo a favor",
  desembolso: "Desembolso",
  aporte: "Aporte",
};

const revertida = (id: typeof transacciones.id) =>
  sql`exists (select 1 from transacciones anulante where anulante.anula_transaccion_id = ${id})`;

async function yaAnulada(tx: Tx, entidad: EntidadAnulable, id: string) {
  const [fila] = await tx
    .select({ id: anulaciones.id })
    .from(anulaciones)
    .where(and(eq(anulaciones.entidad, ENTIDAD_TABLA[entidad]), eq(anulaciones.entidadId, id)));
  return !!fila;
}

type Huella = HuellaTransaccion & { fecha: Fecha; tipo: string; descripcion: string | null };

/** Huellas de las transacciones vigentes (ni anulación ni ya revertidas) que cumplen `condicion`. */
async function huellas(tx: Tx, condicion: SQL | undefined): Promise<Huella[]> {
  const filas = await tx
    .select({
      id: transacciones.id,
      fecha: transacciones.fecha,
      tipo: transacciones.tipo,
      descripcion: transacciones.descripcion,
      pagoId: transacciones.pagoId,
      orden: sql<string>`min(${asientos.id})`,
      prestamos: sql<string[]>`coalesce(json_agg(distinct ${asientos.prestamoId}) filter (where ${asientos.cuenta} = 'cartera'), '[]')`,
      clientes: sql<string[]>`coalesce(json_agg(distinct ${asientos.clienteId}) filter (where ${asientos.cuenta} = 'saldo_favor'), '[]')`,
    })
    .from(transacciones)
    .innerJoin(asientos, eq(asientos.transaccionId, transacciones.id))
    .where(and(ne(transacciones.tipo, "anulacion"), sql`not ${revertida(transacciones.id)}`, condicion))
    .groupBy(transacciones.id);
  return filas.map((f) => ({ ...f, orden: Number(f.orden) }));
}

/** Corta si hay movimientos posteriores que se calcularon sobre lo que se anula. */
async function verificarSinPosteriores(tx: Tx, objetivo: Huella[], ctx: ContextoAnulacion) {
  if (objetivo.length === 0 || ctx.correccion) return;
  const desde = Math.min(...objetivo.map((t) => t.orden));
  const candidatas = await huellas(tx, sql`${transacciones.id} in (select transaccion_id from asientos where id > ${desde})`);
  const bloquean = transaccionesPosteriores(objetivo, candidatas);
  if (bloquean.length === 0) return;
  const lista = bloquean
    .slice(0, 3)
    .map((t) => `${TIPOS_TX[t.tipo] ?? t.tipo} del ${formatearFecha(t.fecha)}${t.descripcion ? ` (${t.descripcion})` : ""}`)
    .join("; ");
  throw new ErrorAnulacion(
    `Hay ${bloquean.length === 1 ? "un movimiento posterior que depende" : `${bloquean.length} movimientos posteriores que dependen`} de esto: ${lista}${bloquean.length > 3 ? "…" : ""}. Anulalos primero, del más nuevo al más viejo.`,
  );
}

/** Registra una transacción tipo anulación con los contraasientos de cada una. Devuelve la primera. */
async function revertir(tx: Tx, ids: string[], motivo: string, ctx: ContextoAnulacion): Promise<string | null> {
  let primera: string | null = null;
  for (const id of ids) {
    const [orig] = await tx.select().from(transacciones).where(eq(transacciones.id, id));
    const lineas = await tx.select().from(asientos).where(eq(asientos.transaccionId, id)).orderBy(asientos.id);
    const reversa = asientosReversa(
      lineas.map(
        (a): Asiento => ({
          cuenta: a.cuenta,
          moneda: a.moneda,
          monto: new Decimal(a.monto),
          prestamoId: a.prestamoId ?? undefined,
          participanteId: a.participanteId ?? undefined,
          clienteId: a.clienteId ?? undefined,
        }),
      ),
    );
    const [t] = await tx
      .insert(transacciones)
      .values({
        fecha: ctx.correccion ? orig!.fecha : ctx.hoy,
        tipo: "anulacion",
        descripcion: `Anulación de ${(TIPOS_TX[orig!.tipo] ?? orig!.tipo).toLowerCase()} del ${formatearFecha(orig!.fecha)}${orig!.descripcion ? `: ${orig!.descripcion}` : ""}`,
        prestamoId: orig!.prestamoId,
        pagoId: orig!.pagoId,
        conversionId: orig!.conversionId,
        anulaTransaccionId: id,
        motivo,
        creadoPor: ctx.usuarioId,
      })
      .returning({ id: transacciones.id });
    await tx.insert(asientos).values(
      reversa.map((a) => ({
        transaccionId: t!.id,
        cuenta: a.cuenta,
        moneda: a.moneda,
        monto: a.monto.toFixed(DECIMALES.usdt),
        prestamoId: a.prestamoId,
        participanteId: a.participanteId,
        clienteId: a.clienteId,
      })),
    );
    primera ??= t!.id;
  }
  return primera;
}

/**
 * Recalcula la deuda de los préstamos tocados: un cancelado que vuelve a deber
 * se reabre; un vigente que queda en cero se cancela.
 */
async function sincronizarEstados(tx: Tx, ids: string[], hoy: Fecha) {
  if (ids.length === 0) return { reabiertos: [], cerrados: [] };
  const filas = await tx
    .select({ id: prestamos.id, estado: prestamos.estado })
    .from(prestamos)
    .where(and(inArray(prestamos.id, ids), inArray(prestamos.estado, ["vigente", "cancelado"])));
  const deuda = await cargarDeuda(tx, inArray(prestamos.id, filas.map((f) => f.id)));
  const reabiertos: string[] = [];
  const cerrados: string[] = [];
  for (const p of deuda) {
    const pendiente = deudasAFecha([p], hoy).deudas.reduce((s, d) => s.plus(d.total), new Decimal(0));
    const estado = filas.find((f) => f.id === p.id)!.estado;
    if (estado === "cancelado" && pendiente.gt(0)) reabiertos.push(p.id);
    if (estado === "vigente" && pendiente.isZero()) cerrados.push(p.id);
  }
  if (reabiertos.length) await tx.update(prestamos).set({ estado: "vigente", fechaCierre: null }).where(inArray(prestamos.id, reabiertos));
  if (cerrados.length) await tx.update(prestamos).set({ estado: "cancelado", fechaCierre: hoy }).where(inArray(prestamos.id, cerrados));
  return { reabiertos, cerrados };
}

/**
 * Anula un pago: sus imputaciones dejan de contar (incluido el saldo a favor que
 * se haya aplicado desde él) y se revierten todas sus transacciones. El
 * efectivo convertido requiere anular antes la conversión. Los cargos de mora y
 * descuento que nacieron con el pago quedan: se anulan aparte.
 */
export async function anularPago(tx: Tx, d: { id: string; motivo: string }, ctx: ContextoAnulacion): Promise<ResultadoAnulacion> {
  const [pago] = await tx.select().from(pagos).where(eq(pagos.id, d.id));
  if (!pago) throw new ErrorAnulacion("El pago no existe.");
  // Mismo bloqueo que al registrar pagos del cliente.
  await tx.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, pago.clienteId)).for("update");
  if (await yaAnulada(tx, "pagos", d.id)) throw new ErrorAnulacion("El pago ya está anulado.");

  const anuladas = tx.select({ id: anulaciones.entidadId }).from(anulaciones).where(eq(anulaciones.entidad, "conversiones"));
  const lotes = await tx
    .select({ fecha: conversiones.fecha })
    .from(conversionLotes)
    .innerJoin(conversiones, eq(conversiones.id, conversionLotes.conversionId))
    .where(and(eq(conversionLotes.pagoId, d.id), sql`${conversiones.id} not in ${anuladas}`));
  if (lotes.length) {
    throw new ErrorAnulacion(
      `Este efectivo ya se convirtió (${lotes.map((l) => formatearFecha(l.fecha)).join(", ")}): anulá primero la conversión.`,
    );
  }

  const objetivo = await huellas(tx, eq(transacciones.pagoId, d.id));
  await verificarSinPosteriores(tx, objetivo, ctx);
  const transaccionId = await revertir(
    tx,
    objetivo.sort((a, b) => b.orden - a.orden).map((t) => t.id),
    d.motivo,
    ctx,
  );
  await tx.insert(anulaciones).values({ entidad: "pagos", entidadId: d.id, transaccionId, motivo: d.motivo, creadoPor: ctx.usuarioId });

  const tocados = await tx
    .selectDistinct({ id: imputaciones.prestamoId })
    .from(imputaciones)
    .where(and(eq(imputaciones.pagoId, d.id), sql`${imputaciones.prestamoId} is not null`));
  const ids = tocados.map((t) => t.id!);
  return { prestamos: ids, ...(await sincronizarEstados(tx, ids, ctx.hoy)) };
}

/**
 * Anula una conversión: el efectivo vuelve a quedar sin convertir y se revierten
 * la salida de caja, el ingreso de USDT y el recupero de cada lote.
 */
export async function anularConversion(tx: Tx, d: { id: string; motivo: string }, ctx: ContextoAnulacion): Promise<ResultadoAnulacion> {
  const [conv] = await tx.select({ id: conversiones.id }).from(conversiones).where(eq(conversiones.id, d.id));
  if (!conv) throw new ErrorAnulacion("La conversión no existe.");
  const lotes = await tx.select({ pagoId: conversionLotes.pagoId }).from(conversionLotes).where(eq(conversionLotes.conversionId, d.id));
  // Mismo bloqueo que al convertir.
  await tx.select({ id: pagos.id }).from(pagos).where(inArray(pagos.id, lotes.map((l) => l.pagoId))).for("update");
  if (await yaAnulada(tx, "conversiones", d.id)) throw new ErrorAnulacion("La conversión ya está anulada.");

  const objetivo = await huellas(tx, eq(transacciones.conversionId, d.id));
  await verificarSinPosteriores(tx, objetivo, ctx);
  const transaccionId = await revertir(
    tx,
    objetivo.sort((a, b) => b.orden - a.orden).map((t) => t.id),
    d.motivo,
    ctx,
  );
  await tx.insert(anulaciones).values({ entidad: "conversiones", entidadId: d.id, transaccionId, motivo: d.motivo, creadoPor: ctx.usuarioId });
  return { prestamos: [...new Set(objetivo.flatMap((t) => t.prestamos))], reabiertos: [], cerrados: [] };
}

/** Anula un aporte de socio: sale de la caja y del capital (la caja puede quedar negativa). */
export async function anularAporte(tx: Tx, d: { id: string; motivo: string }, ctx: ContextoAnulacion): Promise<ResultadoAnulacion> {
  const [t] = await tx
    .select({ id: transacciones.id, tipo: transacciones.tipo })
    .from(transacciones)
    .where(eq(transacciones.id, d.id))
    .for("update");
  if (!t || t.tipo !== "aporte") throw new ErrorAnulacion("El aporte no existe.");
  if (await yaAnulada(tx, "aportes", d.id)) throw new ErrorAnulacion("El aporte ya está anulado.");
  const transaccionId = await revertir(tx, [d.id], d.motivo, ctx);
  await tx.insert(anulaciones).values({ entidad: "transacciones", entidadId: d.id, transaccionId, motivo: d.motivo, creadoPor: ctx.usuarioId });
  return { prestamos: [], reabiertos: [], cerrados: [] };
}

/**
 * Anula un cargo (mora, descuento o ajuste). No mueve el libro: cambia la deuda.
 * Una mora anulada no se vuelve a generar en esa cuota (queda perdonada).
 */
export async function anularCargo(tx: Tx, d: { id: string; motivo: string }, ctx: ContextoAnulacion): Promise<ResultadoAnulacion> {
  const [cargo] = await tx.select().from(cargos).where(eq(cargos.id, d.id));
  if (!cargo) throw new ErrorAnulacion("El cargo no existe.");
  const [p] = await tx.select({ clienteId: prestamos.clienteId }).from(prestamos).where(eq(prestamos.id, cargo.prestamoId));
  await tx.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, p!.clienteId)).for("update");
  if (await yaAnulada(tx, "cargos", d.id)) throw new ErrorAnulacion("El cargo ya está anulado.");

  const mismaCuota = cargo.cuotaId ? eq(cargos.cuotaId, cargo.cuotaId) : isNull(cargos.cuotaId);
  const anuladosCargos = tx.select({ id: anulaciones.entidadId }).from(anulaciones).where(eq(anulaciones.entidad, "cargos"));
  const anuladosPagos = tx.select({ id: anulaciones.entidadId }).from(anulaciones).where(eq(anulaciones.entidad, "pagos"));
  const [restantes, [cobrado]] = await Promise.all([
    tx
      .select({ ars: cargos.ars })
      .from(cargos)
      .where(and(eq(cargos.prestamoId, cargo.prestamoId), mismaCuota, ne(cargos.id, d.id), sql`${cargos.id} not in ${anuladosCargos}`)),
    tx
      .select({ ars: sql<string>`coalesce(sum(${imputaciones.ars}), 0)` })
      .from(imputaciones)
      .where(
        and(
          eq(imputaciones.prestamoId, cargo.prestamoId),
          cargo.cuotaId ? eq(imputaciones.cuotaId, cargo.cuotaId) : isNull(imputaciones.cuotaId),
          eq(imputaciones.concepto, "mora"),
          sql`${imputaciones.pagoId} not in ${anuladosPagos}`,
        ),
      ),
  ]);
  validarAnulacionCargo({ restantes: restantes.map((r) => r.ars), pagadoMora: cobrado?.ars ?? "0" });

  await tx.insert(anulaciones).values({ entidad: "cargos", entidadId: d.id, transaccionId: null, motivo: d.motivo, creadoPor: ctx.usuarioId });
  return { prestamos: [cargo.prestamoId], ...(await sincronizarEstados(tx, [cargo.prestamoId], ctx.hoy)) };
}

/**
 * Anula un préstamo cargado con error (paso previo a darlo de alta corregido):
 * se revierte el desembolso y queda en estado `anulado`. Solo un vigente sin
 * pagos vigentes: si ya cobró algo, primero se anulan esos pagos.
 */
export async function anularPrestamo(tx: Tx, d: { id: string; motivo: string }, ctx: ContextoAnulacion): Promise<{ clienteId: string; numero: number }> {
  const [p] = await tx
    .select({ clienteId: prestamos.clienteId, numero: prestamos.numero })
    .from(prestamos)
    .where(eq(prestamos.id, d.id));
  if (!p) throw new ErrorAnulacion("El préstamo no existe.");
  // Mismo bloqueo que al registrar pagos del cliente: nadie cobra mientras se corrige.
  await tx.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, p.clienteId)).for("update");
  const [actual] = await tx.select({ estado: prestamos.estado }).from(prestamos).where(eq(prestamos.id, d.id)).for("update");
  if (actual!.estado === "anulado") throw new ErrorAnulacion("El préstamo ya está anulado.");
  if (actual!.estado !== "vigente") throw new ErrorAnulacion("Solo se puede corregir un préstamo vigente.");

  const anuladosPagos = tx.select({ id: anulaciones.entidadId }).from(anulaciones).where(eq(anulaciones.entidad, "pagos"));
  const conPagos = await tx
    .selectDistinct({ id: imputaciones.pagoId })
    .from(imputaciones)
    .where(and(eq(imputaciones.prestamoId, d.id), sql`${imputaciones.pagoId} not in ${anuladosPagos}`));
  if (conPagos.length) {
    throw new ErrorAnulacion(
      `El préstamo tiene ${conPagos.length === 1 ? "un pago vigente" : `${conPagos.length} pagos vigentes`}: anulalos primero (del más nuevo al más viejo) y después corregilo.`,
    );
  }

  const objetivo = await huellas(tx, and(eq(transacciones.prestamoId, d.id), eq(transacciones.tipo, "desembolso")));
  await verificarSinPosteriores(tx, objetivo, ctx);
  const transaccionId = await revertir(tx, objetivo.map((t) => t.id), d.motivo, ctx);
  await tx.insert(anulaciones).values({ entidad: "prestamos", entidadId: d.id, transaccionId, motivo: d.motivo, creadoPor: ctx.usuarioId });
  await tx.update(prestamos).set({ estado: "anulado", fechaCierre: ctx.hoy }).where(eq(prestamos.id, d.id));
  return { clienteId: p.clienteId, numero: p.numero };
}

export function anular(tx: Tx, entidad: EntidadAnulable, d: { id: string; motivo: string }, ctx: ContextoAnulacion) {
  const fn = { pagos: anularPago, conversiones: anularConversion, aportes: anularAporte, cargos: anularCargo }[entidad];
  return fn(tx, d, ctx);
}

/* ───────────── Historial ───────────── */

export interface AnulacionHistorial {
  id: string;
  en: Date;
  entidad: EntidadAnulable | "prestamos";
  descripcion: string;
  motivo: string;
  usuario: string;
  /** A dónde ir para ver lo anulado. */
  enlace: string;
}

const TIPOS_CARGO = { mora: "Mora", descuento: "Descuento", ajuste: "Ajuste" } as const;

export async function historialAnulaciones(l: Lector, limite = 100): Promise<AnulacionHistorial[]> {
  const filas = await l
    .select({
      id: anulaciones.id,
      en: anulaciones.creadoEn,
      entidad: anulaciones.entidad,
      entidadId: anulaciones.entidadId,
      motivo: anulaciones.motivo,
      usuario: usuarios.nombre,
    })
    .from(anulaciones)
    .innerJoin(usuarios, eq(usuarios.id, anulaciones.creadoPor))
    .orderBy(desc(anulaciones.creadoEn))
    .limit(limite);
  const ids = (e: string) => filas.filter((f) => f.entidad === e).map((f) => f.entidadId);
  const vacio = <T>(xs: string[], q: () => Promise<T[]>) => (xs.length ? q() : Promise.resolve([] as T[]));
  const cuotaDe = aliasedTable(cuotas, "cuota_cargo");

  const [filasPagos, filasConv, filasTx, filasCargos, filasPrestamos] = await Promise.all([
    vacio(ids("pagos"), () =>
      l
        .select({ id: pagos.id, fecha: pagos.fecha, ars: pagos.ars, tipo: pagos.tipo, clienteId: clientes.id, cliente: clientes.nombre })
        .from(pagos)
        .innerJoin(clientes, eq(clientes.id, pagos.clienteId))
        .where(inArray(pagos.id, ids("pagos"))),
    ),
    vacio(ids("conversiones"), () =>
      l
        .select({ id: conversiones.id, fecha: conversiones.fecha, ars: conversiones.ars, tc: conversiones.tc })
        .from(conversiones)
        .where(inArray(conversiones.id, ids("conversiones"))),
    ),
    vacio(ids("transacciones"), () =>
      l
        .select({ id: transacciones.id, fecha: transacciones.fecha, descripcion: transacciones.descripcion })
        .from(transacciones)
        .where(inArray(transacciones.id, ids("transacciones"))),
    ),
    vacio(ids("cargos"), () =>
      l
        .select({
          id: cargos.id,
          tipo: cargos.tipo,
          ars: cargos.ars,
          motivo: cargos.motivo,
          prestamoId: cargos.prestamoId,
          numero: prestamos.numero,
          cuota: cuotaDe.numero,
        })
        .from(cargos)
        .innerJoin(prestamos, eq(prestamos.id, cargos.prestamoId))
        .leftJoin(cuotaDe, eq(cuotaDe.id, cargos.cuotaId))
        .where(inArray(cargos.id, ids("cargos"))),
    ),
    vacio(ids("prestamos"), () =>
      l
        .select({ id: prestamos.id, numero: prestamos.numero, arsCapital: prestamos.arsCapital, cliente: clientes.nombre })
        .from(prestamos)
        .innerJoin(clientes, eq(clientes.id, prestamos.clienteId))
        .where(inArray(prestamos.id, ids("prestamos"))),
    ),
  ]);

  return filas.map((f): AnulacionHistorial => {
    const base = { id: f.id, en: f.en, motivo: f.motivo, usuario: f.usuario };
    if (f.entidad === "pagos") {
      const p = filasPagos.find((x) => x.id === f.entidadId)!;
      return {
        ...base,
        entidad: "pagos",
        descripcion: `Pago ${p.tipo === "efectivo" ? "en efectivo" : "por transferencia"} de $${formatearArs(p.ars)} de ${p.cliente} (${formatearFecha(p.fecha)})`,
        enlace: `/clientes/${p.clienteId}`,
      };
    }
    if (f.entidad === "conversiones") {
      const c = filasConv.find((x) => x.id === f.entidadId)!;
      return {
        ...base,
        entidad: "conversiones",
        descripcion: `Conversión de $${formatearArs(c.ars)} a TC ${formatearTc(c.tc)} (${formatearFecha(c.fecha)})`,
        enlace: "/efectivo",
      };
    }
    if (f.entidad === "cargos") {
      const c = filasCargos.find((x) => x.id === f.entidadId)!;
      return {
        ...base,
        entidad: "cargos",
        descripcion: `${TIPOS_CARGO[c.tipo]} de $${formatearArs(new Decimal(c.ars).abs())} en ${numeroPrestamo(c.numero)}${c.cuota !== null ? ` · cuota ${c.cuota}` : ""} — ${c.motivo}`,
        enlace: `/prestamos/${c.prestamoId}`,
      };
    }
    if (f.entidad === "prestamos") {
      const p = filasPrestamos.find((x) => x.id === f.entidadId)!;
      return {
        ...base,
        entidad: "prestamos",
        descripcion: `Préstamo ${numeroPrestamo(p.numero)} de $${formatearArs(p.arsCapital)} a ${p.cliente} (editado)`,
        enlace: `/prestamos/${p.id}`,
      };
    }
    const t = filasTx.find((x) => x.id === f.entidadId)!;
    return { ...base, entidad: "aportes", descripcion: `${t.descripcion ?? "Aporte"} (${formatearFecha(t.fecha)})`, enlace: "/socios" };
  });
}
