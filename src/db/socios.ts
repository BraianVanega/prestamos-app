import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { db, Tx } from "./index";
import { asientos, participantes, transacciones, usuarios } from "./schema";
import { asientosAporte } from "@/engine/aporte";
import type { Fecha } from "@/engine/fechas";
import { DECIMALES } from "@/engine/redondeo";
import { abrirSociedad } from "@/engine/reparto";
import { formatearNumero, formatearPct } from "@/lib/numeros";

type Lector = typeof db | Tx;

export class ErrorAporte extends Error {}

export interface CuentaSocio {
  id: string;
  nombre: string;
  pctSociedad: Decimal;
  /** Capital aportado (USDT), con su parte de lo que esté a nombre de la Sociedad. */
  capital: Decimal;
  /** Ganancia realizada no retirada (USDT), con su parte de la de la Sociedad. */
  ganancia: Decimal;
}

export interface Cuentas {
  socios: CuentaSocio[];
  caja: Decimal;
  cartera: Decimal;
  saldoFavor: Decimal;
}

const socios = (l: Lector) =>
  l
    .select({ id: participantes.id, nombre: participantes.nombre, pctSociedad: participantes.pctSociedad })
    .from(participantes)
    .where(and(eq(participantes.tipo, "socio"), eq(participantes.activo, true)))
    .orderBy(asc(participantes.nombre));

/** Cuentas de los socios y de la caja según el libro (USDT). */
export async function cuentasSocios(l: Lector): Promise<Cuentas> {
  const [lista, sociedad, saldos] = await Promise.all([
    socios(l),
    l.select({ id: participantes.id }).from(participantes).where(eq(participantes.tipo, "sociedad")),
    l
      .select({ cuenta: asientos.cuenta, participanteId: asientos.participanteId, monto: sql<string>`sum(${asientos.monto})` })
      .from(asientos)
      .where(and(eq(asientos.moneda, "USDT"), inArray(asientos.cuenta, ["caja_usdt", "cartera", "capital", "ganancia", "saldo_favor"])))
      .groupBy(asientos.cuenta, asientos.participanteId),
  ]);
  const idSociedad = sociedad[0]?.id;
  const partes = lista.map((s) => ({ id: s.id, pct: s.pctSociedad ?? "0" }));
  // Capital y ganancia son créditos (−): se muestran en positivo.
  const abrir = (cuenta: "capital" | "ganancia") =>
    abrirSociedad(
      saldos
        .filter((x) => x.cuenta === cuenta && x.participanteId)
        .map((x) => ({ participanteId: x.participanteId!, esSociedad: x.participanteId === idSociedad, monto: new Decimal(x.monto).neg() })),
      partes,
      DECIMALES.usdt,
    );
  const capital = abrir("capital");
  const ganancia = abrir("ganancia");
  const total = (cuenta: string) => saldos.filter((x) => x.cuenta === cuenta).reduce((s, x) => s.plus(x.monto), new Decimal(0));

  return {
    socios: lista.map((s) => ({
      id: s.id,
      nombre: s.nombre,
      pctSociedad: new Decimal(s.pctSociedad ?? 0),
      capital: capital.find((c) => c.id === s.id)?.monto ?? new Decimal(0),
      ganancia: ganancia.find((g) => g.id === s.id)?.monto ?? new Decimal(0),
    })),
    caja: total("caja_usdt"),
    cartera: total("cartera"),
    saldoFavor: total("saldo_favor").neg(),
  };
}

export interface NuevoAporte {
  fecha: Fecha;
  usdt: Decimal;
  /** Un socio, o "ambos" para repartirlo según el % de la sociedad. */
  socio: string;
  notas: string | null;
}

/** Registra un aporte de capital en USDT (transacción `aporte`: caja + / capital − por socio). */
export async function insertarAporte(tx: Tx, d: NuevoAporte, ctx: { usuarioId: string }): Promise<{ transaccionId: string }> {
  const lista = await socios(tx);
  const elegidos =
    d.socio === "ambos"
      ? lista.map((s) => ({ id: s.id, pct: s.pctSociedad ?? "0" }))
      : lista.filter((s) => s.id === d.socio).map((s) => ({ id: s.id, pct: "100" }));
  if (elegidos.length === 0) throw new ErrorAporte("Elegí qué socio aporta.");

  const quien =
    d.socio === "ambos"
      ? `los socios (${lista.map((s) => formatearPct(s.pctSociedad ?? 0)).join(" / ")}%)`
      : lista.find((s) => s.id === d.socio)!.nombre;
  const [t] = await tx
    .insert(transacciones)
    .values({
      fecha: d.fecha,
      tipo: "aporte",
      descripcion: `Aporte de ${quien}: ${formatearNumero(d.usdt, Math.max(2, d.usdt.decimalPlaces()))} USDT${d.notas ? ` · ${d.notas}` : ""}`,
      creadoPor: ctx.usuarioId,
    })
    .returning({ id: transacciones.id });
  await tx.insert(asientos).values(
    asientosAporte(d.usdt, elegidos).map((a) => ({
      transaccionId: t!.id,
      cuenta: a.cuenta,
      moneda: a.moneda,
      monto: a.monto.toFixed(DECIMALES.usdt),
      participanteId: a.participanteId,
    })),
  );
  return { transaccionId: t!.id };
}

export interface AporteHistorial {
  id: string;
  fecha: Fecha;
  descripcion: string | null;
  usdt: Decimal;
  /** Capital por socio en este aporte. */
  porSocio: { participanteId: string; usdt: Decimal }[];
  usuario: string;
  anulado: boolean;
}

export async function historialAportes(l: Lector, limite = 50): Promise<AporteHistorial[]> {
  const filas = await l
    .select({
      id: transacciones.id,
      fecha: transacciones.fecha,
      descripcion: transacciones.descripcion,
      usuario: usuarios.nombre,
      anulado: sql<boolean>`exists (select 1 from transacciones anulante where anulante.anula_transaccion_id = ${transacciones.id})`,
    })
    .from(transacciones)
    .innerJoin(usuarios, eq(usuarios.id, transacciones.creadoPor))
    .where(eq(transacciones.tipo, "aporte"))
    .orderBy(desc(transacciones.fecha), desc(transacciones.creadoEn))
    .limit(limite);
  if (filas.length === 0) return [];
  const lineas = await l
    .select({ transaccionId: asientos.transaccionId, participanteId: asientos.participanteId, monto: asientos.monto })
    .from(asientos)
    .where(and(inArray(asientos.transaccionId, filas.map((f) => f.id)), eq(asientos.cuenta, "capital")));
  return filas.map((f) => {
    const porSocio = lineas
      .filter((x) => x.transaccionId === f.id)
      .map((x) => ({ participanteId: x.participanteId!, usdt: new Decimal(x.monto).neg() }));
    return { ...f, usdt: porSocio.reduce((s, x) => s.plus(x.usdt), new Decimal(0)), porSocio };
  });
}

