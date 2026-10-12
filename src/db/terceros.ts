import "server-only";
import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { db, Tx } from "./index";
import { cargarResumenPrestamos } from "./resumen-prestamos";
import { asientos, participantes, prestamoParticipaciones, prestamos, transacciones, usuarios } from "./schema";
import type { Fecha } from "@/engine/fechas";
import { DECIMALES } from "@/engine/redondeo";
import { asientosPagoTercero, deudaTercero, type DeudaTercero } from "@/engine/tercero";
import { formatearNumero, textoEditable } from "@/lib/numeros";

type Lector = typeof db | Tx;

export class ErrorTercero extends Error {}

export interface Tercero {
  id: string;
  nombre: string;
  pctDefault: Decimal | null;
  notas: string | null;
  activo: boolean;
}

export interface PrestamoDeTercero {
  id: string;
  numero: number;
  estado: string;
  cliente: string;
  pct: Decimal;
  usdtPrestado: Decimal;
  puesto: Decimal;
  recuperado: Decimal;
}

export interface CuentaTercero extends Tercero {
  prestamos: PrestamoDeTercero[];
  deuda: DeudaTercero;
}

const columnasTercero = {
  id: participantes.id,
  nombre: participantes.nombre,
  pctDefault: participantes.pctDefault,
  notas: participantes.notas,
  activo: participantes.activo,
};

const aTercero = (t: { id: string; nombre: string; pctDefault: string | null; notas: string | null; activo: boolean }): Tercero => ({
  ...t,
  pctDefault: t.pctDefault === null ? null : new Decimal(t.pctDefault),
});

/** Terceros activos para elegir en un préstamo (con su % sugerido). */
export async function tercerosActivos(l: Lector): Promise<Tercero[]> {
  const filas = await l
    .select(columnasTercero)
    .from(participantes)
    .where(and(eq(participantes.tipo, "fondeador"), eq(participantes.activo, true)))
    .orderBy(asc(participantes.nombre));
  return filas.map(aTercero);
}

/**
 * Cuentas de los terceros (todos, o uno): sus préstamos no anulados, lo que puso
 * en cada uno, lo recuperado, su ganancia realizada, lo pagado y lo que se le debe.
 */
export async function cuentasTerceros(l: Lector, hoy: Fecha, soloId?: string): Promise<CuentaTercero[]> {
  const lista = await l
    .select(columnasTercero)
    .from(participantes)
    .where(and(eq(participantes.tipo, "fondeador"), soloId ? eq(participantes.id, soloId) : undefined))
    .orderBy(asc(participantes.nombre));
  if (lista.length === 0) return [];
  const ids = lista.map((t) => t.id);

  const original = sql`(select o.tipo::text from transacciones o where o.id = ${transacciones.anulaTransaccionId})`;
  const [partes, puestos, ganancias, pagos, resumen] = await Promise.all([
    l
      .select({ terceroId: prestamoParticipaciones.participanteId, prestamoId: prestamoParticipaciones.prestamoId, pct: prestamoParticipaciones.pctCapital })
      .from(prestamoParticipaciones)
      .innerJoin(prestamos, eq(prestamos.id, prestamoParticipaciones.prestamoId))
      .where(and(inArray(prestamoParticipaciones.participanteId, ids), ne(prestamos.estado, "anulado"))),
    // Lo que puso: su capital en el desembolso de cada préstamo.
    l
      .select({ terceroId: asientos.participanteId, prestamoId: asientos.prestamoId, monto: sql<string>`sum(${asientos.monto})` })
      .from(asientos)
      .innerJoin(transacciones, eq(transacciones.id, asientos.transaccionId))
      .where(and(inArray(asientos.participanteId, ids), eq(asientos.cuenta, "capital"), eq(transacciones.tipo, "desembolso")))
      .groupBy(asientos.participanteId, asientos.prestamoId),
    // Ganancia realizada: todo lo de la cuenta ganancia salvo los pagos al tercero (y sus anulaciones).
    l
      .select({ terceroId: asientos.participanteId, monto: sql<string>`sum(${asientos.monto})` })
      .from(asientos)
      .innerJoin(transacciones, eq(transacciones.id, asientos.transaccionId))
      .where(
        and(
          inArray(asientos.participanteId, ids),
          eq(asientos.cuenta, "ganancia"),
          ne(transacciones.tipo, "retiro"),
          sql`coalesce(${original}, '') <> 'retiro'`,
        ),
      )
      .groupBy(asientos.participanteId),
    // Pagado: pagos al tercero no anulados, separando capital y ganancia.
    l
      .select({ terceroId: asientos.participanteId, cuenta: asientos.cuenta, monto: sql<string>`sum(${asientos.monto})` })
      .from(asientos)
      .innerJoin(transacciones, eq(transacciones.id, asientos.transaccionId))
      .where(
        and(
          inArray(asientos.participanteId, ids),
          eq(transacciones.tipo, "retiro"),
          sql`not exists (select 1 from transacciones a where a.anula_transaccion_id = ${transacciones.id})`,
        ),
      )
      .groupBy(asientos.participanteId, asientos.cuenta),
    cargarResumenPrestamos(hoy, l),
  ]);

  const porPrestamo = new Map(resumen.map((p) => [p.id, p]));
  return lista.map((t) => {
    const suyos = partes
      .filter((p) => p.terceroId === t.id)
      .flatMap((p): PrestamoDeTercero[] => {
        const r = porPrestamo.get(p.prestamoId);
        if (!r) return [];
        const puesto = puestos.find((x) => x.terceroId === t.id && x.prestamoId === p.prestamoId);
        return [
          {
            id: r.id,
            numero: r.numero,
            estado: r.estado,
            cliente: r.cliente.nombre,
            pct: new Decimal(p.pct),
            usdtPrestado: r.usdtPrestado,
            puesto: new Decimal(puesto?.monto ?? 0).neg(),
            recuperado: r.recuperadoUsdt,
          },
        ];
      })
      .sort((a, b) => b.numero - a.numero);
    const pagado = (cuenta: string) => pagos.find((x) => x.terceroId === t.id && x.cuenta === cuenta)?.monto ?? "0";
    return {
      ...aTercero(t),
      prestamos: suyos,
      deuda: deudaTercero({
        prestamos: suyos.map((p) => ({ pct: p.pct, puesto: p.puesto, recuperado: p.recuperado })),
        ganancia: new Decimal(ganancias.find((x) => x.terceroId === t.id)?.monto ?? 0).neg(),
        pagadoCapital: pagado("capital"),
        pagadoGanancia: pagado("ganancia"),
      }),
    };
  });
}

export interface DatosTercero {
  nombre: string;
  pctDefault: Decimal | null;
  notas: string | null;
  activo: boolean;
}

export async function insertarTercero(tx: Tx, d: DatosTercero): Promise<{ id: string }> {
  const [t] = await tx
    .insert(participantes)
    .values({
      nombre: d.nombre,
      tipo: "fondeador",
      pctDefault: d.pctDefault?.toFixed(DECIMALES.pct) ?? null,
      notas: d.notas,
      activo: d.activo,
    })
    .returning({ id: participantes.id });
  return t!;
}

export async function actualizarTercero(tx: Tx, id: string, d: DatosTercero): Promise<void> {
  const r = await tx
    .update(participantes)
    .set({ nombre: d.nombre, pctDefault: d.pctDefault?.toFixed(DECIMALES.pct) ?? null, notas: d.notas, activo: d.activo })
    .where(and(eq(participantes.id, id), eq(participantes.tipo, "fondeador")))
    .returning({ id: participantes.id });
  if (r.length === 0) throw new ErrorTercero("El tercero no existe.");
}

export interface NuevoPagoTercero {
  terceroId: string;
  fecha: Fecha;
  usdt: Decimal;
  notas: string | null;
}

/** Pago al tercero (transacción `retiro`): sale de la caja USDT contra su capital recuperado y su ganancia. */
export async function insertarPagoTercero(tx: Tx, d: NuevoPagoTercero, ctx: { usuarioId: string; hoy: Fecha }): Promise<{ transaccionId: string }> {
  // Bloquea al tercero: dos pagos a la vez no pueden pasar el tope.
  const [t] = await tx
    .select({ id: participantes.id, nombre: participantes.nombre })
    .from(participantes)
    .where(and(eq(participantes.id, d.terceroId), eq(participantes.tipo, "fondeador")))
    .for("update");
  if (!t) throw new ErrorTercero("El tercero no existe.");
  const [cuenta] = await cuentasTerceros(tx, ctx.hoy, d.terceroId);
  const deuda = cuenta!.deuda;
  if (d.usdt.gt(deuda.disponible)) {
    throw new ErrorTercero(`Supera lo que se le debe (${formatearNumero(deuda.disponible, 2)} USDT).`);
  }

  const [tr] = await tx
    .insert(transacciones)
    .values({
      fecha: d.fecha,
      tipo: "retiro",
      descripcion: `Pago a ${t.nombre}: ${formatearNumero(d.usdt, Math.max(2, d.usdt.decimalPlaces()))} USDT${d.notas ? ` · ${d.notas}` : ""}`,
      creadoPor: ctx.usuarioId,
    })
    .returning({ id: transacciones.id });
  await tx.insert(asientos).values(
    asientosPagoTercero(t.id, d.usdt, deuda).map((a) => ({
      transaccionId: tr!.id,
      cuenta: a.cuenta,
      moneda: a.moneda,
      monto: a.monto.toFixed(DECIMALES.usdt),
      participanteId: a.participanteId,
    })),
  );
  return { transaccionId: tr!.id };
}

export interface PagoTerceroHistorial {
  id: string;
  fecha: Fecha;
  descripcion: string | null;
  usuario: string;
  anulado: boolean;
  usdt: Decimal;
}

/** Pagos hechos a un tercero, del más nuevo al más viejo. */
export async function historialPagosTercero(l: Lector, terceroId: string): Promise<PagoTerceroHistorial[]> {
  const filas = await l
    .select({
      id: transacciones.id,
      fecha: transacciones.fecha,
      descripcion: transacciones.descripcion,
      usuario: usuarios.nombre,
      anulado: sql<boolean>`exists (select 1 from transacciones anulante where anulante.anula_transaccion_id = ${transacciones.id})`,
      usdt: sql<string>`(select -sum(a.monto) from asientos a where a.transaccion_id = ${transacciones.id} and a.cuenta = 'caja_usdt')`,
    })
    .from(transacciones)
    .innerJoin(usuarios, eq(usuarios.id, transacciones.creadoPor))
    .where(
      and(
        eq(transacciones.tipo, "retiro"),
        sql`exists (select 1 from asientos a where a.transaccion_id = ${transacciones.id} and a.participante_id = ${terceroId})`,
      ),
    )
    .orderBy(desc(transacciones.fecha), desc(transacciones.creadoEn));
  return filas.map((f) => ({ ...f, fecha: f.fecha as Fecha, usdt: new Decimal(f.usdt ?? 0) }));
}

export interface OpcionesEstructura {
  terceros: { value: string; label: string; pctDefault: string }[];
  socios: { nombre: string; pct: string }[];
  /** Terceros del préstamo que se edita, con su % (texto editable). */
  iniciales: { participanteId: string; pct: string }[];
}

/**
 * Lo que necesita el bloque "Estructura de capital" del formulario de préstamo:
 * terceros activos (y, al editar, los del préstamo aunque estén inactivos),
 * socios con su % de la Sociedad y el reparto actual del préstamo.
 */
export async function opcionesEstructura(l: Lector, prestamoId?: string): Promise<OpcionesEstructura> {
  const [activos, socios, actuales] = await Promise.all([
    tercerosActivos(l),
    l
      .select({ nombre: participantes.nombre, pct: participantes.pctSociedad })
      .from(participantes)
      .where(and(eq(participantes.tipo, "socio"), eq(participantes.activo, true)))
      .orderBy(asc(participantes.nombre)),
    prestamoId
      ? l
          .select({ ...columnasTercero, pct: prestamoParticipaciones.pctCapital })
          .from(prestamoParticipaciones)
          .innerJoin(participantes, eq(participantes.id, prestamoParticipaciones.participanteId))
          .where(and(eq(prestamoParticipaciones.prestamoId, prestamoId), eq(participantes.tipo, "fondeador")))
      : Promise.resolve([]),
  ]);
  const todos = [...activos, ...actuales.filter((a) => !activos.some((t) => t.id === a.id)).map(aTercero)];
  return {
    terceros: todos.map((t) => ({ value: t.id, label: t.nombre, pctDefault: t.pctDefault ? textoEditable(t.pctDefault) : "" })),
    socios: socios.map((s) => ({ nombre: s.nombre, pct: textoEditable(s.pct ?? "0") })),
    iniciales: actuales.map((a) => ({ participanteId: a.id, pct: textoEditable(a.pct) })),
  };
}
