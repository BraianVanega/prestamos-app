import Decimal from "decimal.js";
import { and, eq, inArray, notInArray, sql, type AnyColumn } from "drizzle-orm";
import type { Tx } from "./index";
import { insertarPrestamo, type AltaPrestamo } from "./alta-prestamo";
import { anularConversion, anularPago, anularPrestamo, ErrorAnulacion, type ContextoAnulacion } from "./anulaciones";
import { insertarConversion } from "./conversion";
import { cargarDeudaCliente, insertarPago, saldosAFavor } from "./registrar-pago";
import { anulaciones, cargos, clientes, conversionLotes, conversiones, cuotas, imputaciones, pagos, prestamos } from "./schema";
import {
  alcanceCorreccion,
  descuentosReplay,
  montosReplay,
  morasPerdonadasReplay,
  motivoDescuentoBase,
  type DescuentoOriginal,
  type OperacionCobro,
} from "@/engine/correccion";
import type { Fecha } from "@/engine/fechas";
import { aplicarDescuentos, deudasAFecha } from "@/engine/pago";
import { DECIMALES } from "@/engine/redondeo";
import { formatearFecha } from "@/lib/formato";
import { numeroPrestamo } from "@/lib/prestamos";

/** Instante de registro como texto ordenable (UTC, con microsegundos). */
const instante = (col: AnyColumn) => sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

const anuladas = (tx: Tx, entidad: string) => tx.select({ id: anulaciones.entidadId }).from(anulaciones).where(eq(anulaciones.entidad, entidad));

interface Operacion extends OperacionCobro {
  fecha: Fecha;
  pago: { tipo: "transferencia" | "efectivo"; ars: string; tcSalida: string | null; metodo: string | null; notas: string | null } | null;
  usarSaldo: boolean;
  /** Imputado por clave de deuda (sin saldo a favor). */
  montos: Map<string, Decimal>;
  descuentos: DescuentoOriginal[];
  motivoDescuento: string | null;
}

interface Conversion {
  id: string;
  instante: string;
  fecha: Fecha;
  ars: string;
  tc: string;
  notas: string | null;
  lotes: { pagoId: string; ars: string }[];
  pagos: string[];
}

/** Cobros (operaciones) y conversiones vigentes del cliente, en el orden en que se registraron. */
async function historiaCliente(tx: Tx, clienteId: string) {
  const pagosAnulados = anuladas(tx, "pagos");
  const [filasPagos, lineas, descuentos] = await Promise.all([
    tx
      .select({
        id: pagos.id,
        instante: instante(pagos.creadoEn),
        tipo: pagos.tipo,
        ars: pagos.ars,
        tcSalida: pagos.tcSalida,
        metodo: pagos.metodo,
        notas: pagos.notas,
      })
      .from(pagos)
      .where(and(eq(pagos.clienteId, clienteId), notInArray(pagos.id, pagosAnulados))),
    tx
      .select({
        pagoId: imputaciones.pagoId,
        instante: instante(imputaciones.creadoEn),
        fecha: imputaciones.fecha,
        prestamoId: imputaciones.prestamoId,
        cuotaId: imputaciones.cuotaId,
        concepto: imputaciones.concepto,
        ars: imputaciones.ars,
      })
      .from(imputaciones)
      .innerJoin(pagos, eq(pagos.id, imputaciones.pagoId))
      .where(and(eq(pagos.clienteId, clienteId), notInArray(pagos.id, pagosAnulados))),
    tx
      .select({
        instante: instante(cargos.creadoEn),
        prestamoId: cargos.prestamoId,
        cuotaNumero: cuotas.numero,
        ars: cargos.ars,
        motivo: cargos.motivo,
      })
      .from(cargos)
      .innerJoin(prestamos, eq(prestamos.id, cargos.prestamoId))
      .leftJoin(cuotas, eq(cuotas.id, cargos.cuotaId))
      .where(and(eq(prestamos.clienteId, clienteId), eq(cargos.tipo, "descuento"), notInArray(cargos.id, anuladas(tx, "cargos")))),
  ]);

  const porInstante = new Map<string, typeof lineas>();
  for (const l of lineas) porInstante.set(l.instante, [...(porInstante.get(l.instante) ?? []), l]);
  const operaciones: Operacion[] = [...porInstante].map(([inst, ls]) => {
    const nuevo = filasPagos.find((p) => p.instante === inst) ?? null;
    const montos = new Map<string, Decimal>();
    for (const l of ls) {
      if (l.concepto === "saldo_favor" || !l.prestamoId) continue;
      const clave = `${l.prestamoId}:${l.cuotaId ?? "cargos"}`;
      montos.set(clave, (montos.get(clave) ?? new Decimal(0)).plus(l.ars));
    }
    const desc = descuentos.filter((d) => d.instante === inst);
    return {
      instante: inst,
      fecha: ls[0]!.fecha,
      pagoNuevoId: nuevo?.id ?? null,
      pago: nuevo,
      pagos: [...new Set(ls.map((l) => l.pagoId))],
      prestamos: [...new Set(ls.flatMap((l) => (l.prestamoId ? [l.prestamoId] : [])))],
      usarSaldo: ls.some((l) => l.pagoId !== nuevo?.id),
      montos,
      descuentos: desc.map((d) => ({ prestamoId: d.prestamoId, cuotaNumero: d.cuotaNumero, ars: new Decimal(d.ars).neg() })),
      motivoDescuento: desc[0] ? motivoDescuentoBase(desc[0].motivo) : null,
    };
  });

  const ids = filasPagos.map((p) => p.id);
  const filasConv = ids.length
    ? await tx
        .select({
          id: conversiones.id,
          instante: instante(conversiones.creadoEn),
          fecha: conversiones.fecha,
          ars: conversiones.ars,
          tc: conversiones.tc,
          notas: conversiones.notas,
        })
        .from(conversiones)
        .where(
          and(
            notInArray(conversiones.id, anuladas(tx, "conversiones")),
            sql`exists (select 1 from ${conversionLotes} where ${conversionLotes.conversionId} = ${conversiones.id} and ${inArray(conversionLotes.pagoId, ids)})`,
          ),
        )
    : [];
  const lotes = filasConv.length
    ? await tx
        .select({ conversionId: conversionLotes.conversionId, pagoId: conversionLotes.pagoId, ars: conversionLotes.ars })
        .from(conversionLotes)
        .where(inArray(conversionLotes.conversionId, filasConv.map((c) => c.id)))
    : [];
  const conversionesCliente: Conversion[] = filasConv.map((c) => {
    const ls = lotes.filter((l) => l.conversionId === c.id);
    return { ...c, lotes: ls, pagos: ls.map((l) => l.pagoId) };
  });

  return { pagos: filasPagos, operaciones, conversiones: conversionesCliente };
}

/** Las moras anuladas del original quedan anuladas en el corregido (no se vuelven a generar). */
async function pasarMorasPerdonadas(tx: Tx, d: { viejo: { id: string; numero: number }; nuevoId: string; usuarioId: string }) {
  const [perdonadas, cuotasNuevas] = await Promise.all([
    tx
      .select({ cuotaNumero: cuotas.numero, fecha: cargos.fecha, ars: cargos.ars })
      .from(cargos)
      .innerJoin(cuotas, eq(cuotas.id, cargos.cuotaId))
      .innerJoin(anulaciones, and(eq(anulaciones.entidad, "cargos"), eq(anulaciones.entidadId, cargos.id)))
      .where(and(eq(cargos.prestamoId, d.viejo.id), eq(cargos.tipo, "mora")))
      .orderBy(cargos.fecha),
    tx.select({ id: cuotas.id, numero: cuotas.numero }).from(cuotas).where(eq(cuotas.prestamoId, d.nuevoId)),
  ]);
  const moras = morasPerdonadasReplay(perdonadas, cuotasNuevas);
  if (moras.length === 0) return;
  const filas = await tx
    .insert(cargos)
    .values(
      moras.map((m) => ({
        prestamoId: d.nuevoId,
        cuotaId: m.cuotaId,
        fecha: m.fecha,
        tipo: "mora" as const,
        ars: new Decimal(m.ars).toFixed(DECIMALES.ars),
        motivo: `Mora perdonada en ${numeroPrestamo(d.viejo.numero)} (cuota ${m.cuotaNumero})`,
        creadoPor: d.usuarioId,
      })),
    )
    .returning({ id: cargos.id });
  await tx.insert(anulaciones).values(
    filas.map((f) => ({
      entidad: "cargos",
      entidadId: f.id,
      transaccionId: null,
      motivo: `Perdonada en ${numeroPrestamo(d.viejo.numero)}: sigue perdonada al editar el préstamo`,
      creadoPor: d.usuarioId,
    })),
  );
}

/** Instante nuevo (distinto y creciente) para cada operación que se vuelve a registrar. */
async function nuevoInstante(tx: Tx) {
  const [fila] = await tx.execute<{ t: string }>(sql`select clock_timestamp()::text as t`);
  return sql`${fila!.t}::timestamptz`;
}

export interface ResultadoCorreccion {
  id: string;
  numero: number;
  /** Cobros que se volvieron a imputar sobre el préstamo corregido. */
  cobros: number;
  conversiones: number;
}

/**
 * Corrige un préstamo dentro de la transacción recibida. Sin cobros: lo anula y
 * da de alta el corregido. Con cobros: rebobina los cobros del cliente desde el
 * primero que tocó el préstamo (y las conversiones de ese efectivo), anula el
 * préstamo, da de alta el corregido y vuelve a registrar todo en el mismo orden
 * con la misma fecha, monto, tipo y TC. Lo cobrado no cambia; la imputación,
 * la mora, el recupero y la ganancia salen de las condiciones nuevas.
 */
export async function corregirPrestamo(
  tx: Tx,
  d: { id: string; datos: AltaPrestamo; motivo: string },
  ctx: { usuarioId: string; hoy: Fecha; sociedadId: string },
): Promise<ResultadoCorreccion> {
  const [viejo] = await tx.select().from(prestamos).where(eq(prestamos.id, d.id));
  if (!viejo) throw new ErrorAnulacion("El préstamo no existe.");
  await tx.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, viejo.clienteId)).for("update");
  if (viejo.estado !== "vigente" && viejo.estado !== "cancelado") {
    throw new ErrorAnulacion(`El préstamo está ${viejo.estado}: no se puede editar.`);
  }

  const historia = await historiaCliente(tx, viejo.clienteId);
  const alcance = alcanceCorreccion({ prestamoId: d.id, ...historia });
  const delPrestamo = alcance.operaciones.filter((o) => o.prestamos.includes(d.id));
  if (delPrestamo.length) {
    if (d.datos.clienteId !== viejo.clienteId) {
      throw new ErrorAnulacion("El préstamo ya tiene cobros: el cliente no se puede cambiar.");
    }
    const primero = delPrestamo.map((o) => o.fecha).sort()[0]!;
    if (d.datos.fechaDesembolso > primero) {
      throw new ErrorAnulacion(`El préstamo tiene cobros desde el ${formatearFecha(primero)}: el desembolso no puede ser posterior.`);
    }
  }

  const motivo = `Corrección de ${numeroPrestamo(viejo.numero)}: ${d.motivo}`;
  const anulacion: ContextoAnulacion = { usuarioId: ctx.usuarioId, hoy: ctx.hoy, correccion: true };

  // 1. Rebobinar, del más nuevo al más viejo: conversiones antes que sus pagos.
  const linea = [
    ...alcance.operaciones.map((o) => ({ instante: o.instante, op: o })),
    ...alcance.conversiones.map((c) => ({ instante: c.instante, conv: c })),
  ].sort((a, b) => a.instante.localeCompare(b.instante));
  for (const paso of [...linea].reverse()) {
    if ("conv" in paso) await anularConversion(tx, { id: paso.conv!.id, motivo }, anulacion);
    else if (paso.op!.pagoNuevoId) await anularPago(tx, { id: paso.op!.pagoNuevoId, motivo }, anulacion);
    // Solo saldo a favor aplicado: se va con el pago de origen (también en el alcance).
  }

  // 2. Anular el préstamo y dar de alta el corregido.
  await anularPrestamo(tx, { id: d.id, motivo: d.motivo }, anulacion);
  const nuevo = await insertarPrestamo(tx, d.datos, { usuarioId: ctx.usuarioId, sociedadId: ctx.sociedadId, corrigeAId: d.id });
  await pasarMorasPerdonadas(tx, { viejo, nuevoId: nuevo.id, usuarioId: ctx.usuarioId });

  // 3. Volver a registrar todo en el mismo orden.
  const pagoNuevo = new Map<string, string>();
  let cobros = 0;
  for (const paso of linea) {
    const creadoEn = await nuevoInstante(tx);
    if ("conv" in paso) {
      const c = paso.conv!;
      await insertarConversion(
        tx,
        {
          fecha: c.fecha,
          ars: new Decimal(c.ars),
          tc: new Decimal(c.tc),
          notas: c.notas,
          lotes: new Map(c.lotes.map((l) => [pagoNuevo.get(l.pagoId) ?? l.pagoId, new Decimal(l.ars)])),
        },
        { usuarioId: ctx.usuarioId, creadoEn },
      );
      continue;
    }

    const op = paso.op!;
    const aFecha = deudasAFecha(await cargarDeudaCliente(tx, viejo.clienteId), op.fecha);
    const descuentos = descuentosReplay({ deudas: aFecha.deudas, originales: op.descuentos, viejoId: d.id, nuevoId: nuevo.id });
    const conDescuentos = aplicarDescuentos(aFecha.deudas, descuentos).deudas;
    const ars = new Decimal(op.pago?.ars ?? 0);
    const saldo = op.usarSaldo
      ? (await saldosAFavor(tx, viejo.clienteId)).filter((s) => s.aplicable).reduce((s, x) => s.plus(x.ars), new Decimal(0))
      : new Decimal(0);
    const montos = montosReplay({
      deudas: conDescuentos,
      originales: op.montos,
      viejoId: d.id,
      nuevoId: nuevo.id,
      disponible: ars.plus(saldo),
    });
    // Un saldo a favor aplicado que ya no tiene qué pagar no se registra.
    if (ars.isZero() && montos.size === 0) continue;

    const r = await insertarPago(
      tx,
      {
        clienteId: viejo.clienteId,
        fecha: op.fecha,
        tipo: op.pago?.tipo ?? "transferencia",
        ars,
        tcSalida: op.pago?.tcSalida ? new Decimal(op.pago.tcSalida) : null,
        metodo: op.pago?.metodo ?? null,
        notas: op.pago?.notas ?? null,
        montos,
        usarSaldo: op.usarSaldo,
        descuentos,
        motivoDescuento: descuentos.size ? (op.motivoDescuento ?? d.motivo) : null,
      },
      { usuarioId: ctx.usuarioId, creadoEn },
    );
    if (op.pagoNuevoId && r.pagoId) pagoNuevo.set(op.pagoNuevoId, r.pagoId);
    if (r.prestamos.includes(nuevo.id)) cobros++;
  }

  return { id: nuevo.id, numero: nuevo.numero, cobros, conversiones: alcance.conversiones.length };
}
