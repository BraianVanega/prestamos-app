import Decimal from "decimal.js";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { db, Tx } from "./index";
import {
  anulaciones,
  asientos,
  cargos,
  clientes,
  cuotas,
  imputaciones,
  pagos,
  prestamoParticipaciones,
  prestamos,
  transacciones,
} from "./schema";
import type { Asiento } from "@/engine/asientos";
import type { Fecha } from "@/engine/fechas";
import {
  asientosCobroEfectivo,
  asientosIngresoUsdt,
  deudasAFecha,
  ErrorImputacion,
  imputarPago,
  type CuotaParaCobro,
  type PrestamoParaCobro,
} from "@/engine/pago";
import { DECIMALES } from "@/engine/redondeo";
import { formatearArs, formatearPct } from "@/lib/numeros";
import { numeroPrestamo } from "@/lib/prestamos";

type Lector = typeof db | Tx;

/** Pagos anulados: sus imputaciones no cuentan. */
const pagosAnulados = (l: Lector) =>
  l.select({ id: anulaciones.entidadId }).from(anulaciones).where(eq(anulaciones.entidad, "pagos"));

/**
 * Préstamos vigentes del cliente con todo lo que el motor necesita para armar
 * la deuda a cualquier fecha. Los montos viajan como string (se pueden pasar al cliente).
 */
export async function cargarDeudaCliente(l: Lector, clienteId: string): Promise<PrestamoParaCobro[]> {
  const vigentes = await l
    .select({
      id: prestamos.id,
      numero: prestamos.numero,
      nCuotas: prestamos.nCuotas,
      moraPct: prestamos.moraPct,
      diasGracia: prestamos.diasGracia,
    })
    .from(prestamos)
    .where(and(eq(prestamos.clienteId, clienteId), eq(prestamos.estado, "vigente")))
    .orderBy(asc(prestamos.numero));
  if (vigentes.length === 0) return [];
  const ids = vigentes.map((p) => p.id);

  const anuladosCargos = l.select({ id: anulaciones.entidadId }).from(anulaciones).where(eq(anulaciones.entidad, "cargos"));
  const [plan, imputado, filasCargos] = await Promise.all([
    l.select().from(cuotas).where(inArray(cuotas.prestamoId, ids)).orderBy(asc(cuotas.numero)),
    l
      .select({
        prestamoId: imputaciones.prestamoId,
        cuotaId: imputaciones.cuotaId,
        concepto: imputaciones.concepto,
        fecha: imputaciones.fecha,
        ars: imputaciones.ars,
      })
      .from(imputaciones)
      .where(and(inArray(imputaciones.prestamoId, ids), notInArray(imputaciones.pagoId, pagosAnulados(l))))
      .orderBy(asc(imputaciones.fecha)),
    l
      .select({
        prestamoId: cargos.prestamoId,
        cuotaId: cargos.cuotaId,
        tipo: cargos.tipo,
        fecha: cargos.fecha,
        ars: cargos.ars,
        anulado: sql<boolean>`${cargos.id} in ${anuladosCargos}`,
      })
      .from(cargos)
      .where(inArray(cargos.prestamoId, ids)),
  ]);

  const sumar = (xs: { ars: string }[]) => xs.reduce((s, x) => s.plus(x.ars), new Decimal(0)).toFixed(DECIMALES.ars);

  return vigentes.map((p) => {
    const impP = imputado.filter((i) => i.prestamoId === p.id);
    const carP = filasCargos.filter((c) => c.prestamoId === p.id);
    const cuotasP: CuotaParaCobro[] = plan
      .filter((c) => c.prestamoId === p.id)
      .map((c) => {
        const impC = impP.filter((i) => i.cuotaId === c.id);
        const carC = carP.filter((x) => x.cuotaId === c.id);
        const capital = impC.filter((i) => i.concepto === "capital");
        return {
          id: c.id,
          numero: c.numero,
          vencimiento: c.vencimiento,
          arsCapital: c.arsCapital,
          arsInteres: c.arsInteres,
          pagadoCapital: sumar(capital),
          pagadoInteres: sumar(impC.filter((i) => i.concepto === "interes")),
          pagadoCargos: sumar(impC.filter((i) => i.concepto === "mora")),
          pagosCapital: capital.map((i) => ({ fecha: i.fecha, ars: i.ars })),
          cargos: sumar(carC.filter((x) => !x.anulado)),
          tieneMora: carC.some((x) => x.tipo === "mora"),
        };
      });
    const sueltos = carP.filter((x) => !x.cuotaId && !x.anulado);
    const pagadoSueltos = impP.filter((i) => !i.cuotaId && i.concepto === "mora");
    return {
      id: p.id,
      numero: p.numero,
      nCuotas: p.nCuotas,
      moraPct: p.moraPct,
      diasGracia: p.diasGracia,
      cuotas: cuotasP,
      cargosSinCuota: sueltos.length
        ? { fecha: sueltos.map((x) => x.fecha).sort()[0]!, neto: sumar(sueltos), pagado: sumar(pagadoSueltos) }
        : null,
    };
  });
}

/** Saldo a favor vigente del cliente en ARS (imputaciones saldo_favor de pagos no anulados). */
export async function saldoFavorCliente(l: Lector, clienteId: string): Promise<Decimal> {
  const [fila] = await l
    .select({ ars: sql<string>`coalesce(sum(${imputaciones.ars}), 0)` })
    .from(imputaciones)
    .innerJoin(pagos, eq(pagos.id, imputaciones.pagoId))
    .where(
      and(eq(pagos.clienteId, clienteId), eq(imputaciones.concepto, "saldo_favor"), notInArray(pagos.id, pagosAnulados(l))),
    );
  return new Decimal(fila?.ars ?? 0);
}

export interface NuevoPago {
  clienteId: string;
  fecha: Fecha;
  tipo: "transferencia" | "efectivo";
  ars: Decimal;
  /** Solo transferencia. */
  tcSalida: Decimal | null;
  metodo: string | null;
  notas: string | null;
  /** Monto a imputar por clave de deuda (ver `deudasAFecha`). */
  montos: Map<string, Decimal>;
}

export { ErrorImputacion };

const filaAsiento = (transaccionId: string, a: Asiento) => ({
  transaccionId,
  cuenta: a.cuenta,
  moneda: a.moneda,
  monto: a.monto.toFixed(DECIMALES.usdt),
  prestamoId: a.prestamoId,
  participanteId: a.participanteId,
  clienteId: a.clienteId,
});

/**
 * Registra un pago completo dentro de la transacción recibida: mora que nace a la
 * fecha (cargos), pago, imputaciones, transacción de cobro con sus asientos y
 * cierre de los préstamos que quedan saldados. La deuda se vuelve a calcular acá
 * con el cliente bloqueado, así dos pagos simultáneos no imputan lo mismo.
 * Lanza `ErrorImputacion` si los montos no cierran con la deuda actual.
 */
export async function insertarPago(
  tx: Tx,
  d: NuevoPago,
  ctx: { usuarioId: string },
): Promise<{ pagoId: string; prestamos: string[]; cancelados: string[] }> {
  const [cliente] = await tx
    .select({ id: clientes.id, nombre: clientes.nombre })
    .from(clientes)
    .where(eq(clientes.id, d.clienteId))
    .for("update");
  if (!cliente) throw new ErrorImputacion("El cliente no existe.");
  if ((d.tipo === "transferencia") !== (d.tcSalida !== null)) throw new ErrorImputacion("El TC va solo en transferencias.");

  const deuda = await cargarDeudaCliente(tx, d.clienteId);
  const { deudas, moraNueva } = deudasAFecha(deuda, d.fecha);
  const imp = imputarPago(d.ars, deudas, d.montos);
  const numeros = new Map(deuda.map((p) => [p.id, p.numero]));

  if (moraNueva.length) {
    await tx.insert(cargos).values(
      moraNueva.map((m) => ({
        prestamoId: m.prestamoId,
        cuotaId: m.cuotaId,
        fecha: m.fecha,
        tipo: "mora" as const,
        ars: m.ars.toFixed(DECIMALES.ars),
        motivo: `Mora ${formatearPct(m.moraPct)}% sobre $${formatearArs(m.base)} de capital impago (cuota ${m.cuotaNumero})`,
        creadoPor: ctx.usuarioId,
      })),
    );
  }

  const [pago] = await tx
    .insert(pagos)
    .values({
      clienteId: d.clienteId,
      fecha: d.fecha,
      ars: d.ars.toFixed(DECIMALES.ars),
      tipo: d.tipo,
      tcSalida: d.tcSalida?.toFixed(DECIMALES.tc) ?? null,
      metodo: d.metodo,
      notas: d.notas,
      creadoPor: ctx.usuarioId,
    })
    .returning({ id: pagos.id });
  const pagoId = pago!.id;

  await tx.insert(imputaciones).values(
    imp.lineas.map((l) => ({
      pagoId,
      fecha: d.fecha,
      prestamoId: l.prestamoId,
      cuotaId: l.cuotaId,
      concepto: l.concepto,
      ars: l.ars.toFixed(DECIMALES.ars),
      creadoPor: ctx.usuarioId,
    })),
  );

  const ids = imp.porPrestamo.map((p) => p.prestamoId);
  const destino = [
    ...ids.map((id) => numeroPrestamo(numeros.get(id)!)),
    ...(imp.saldoFavor.gt(0) ? ["saldo a favor"] : []),
  ].join(", ");
  const [transaccion] = await tx
    .insert(transacciones)
    .values({
      fecha: d.fecha,
      tipo: "cobro",
      descripcion: `Cobro ${d.tipo === "efectivo" ? "en efectivo" : "por transferencia"} de $${formatearArs(d.ars)} → ${destino}`,
      prestamoId: ids.length === 1 ? ids[0] : null,
      pagoId,
      creadoPor: ctx.usuarioId,
    })
    .returning({ id: transacciones.id });

  let lineas: Asiento[];
  if (d.tipo === "efectivo") {
    lineas = asientosCobroEfectivo(d.ars);
  } else {
    const [carteras, partes] = ids.length
      ? await Promise.all([
          tx
            .select({ prestamoId: asientos.prestamoId, monto: sql<string>`sum(${asientos.monto})` })
            .from(asientos)
            .where(and(inArray(asientos.prestamoId, ids), eq(asientos.cuenta, "cartera")))
            .groupBy(asientos.prestamoId),
          tx.select().from(prestamoParticipaciones).where(inArray(prestamoParticipaciones.prestamoId, ids)),
        ])
      : [[], []];
    lineas = asientosIngresoUsdt({
      tc: d.tcSalida!,
      porPrestamo: imp.porPrestamo,
      saldoFavorArs: imp.saldoFavor,
      clienteId: d.clienteId,
      cartera: new Map(carteras.map((c) => [c.prestamoId!, c.monto])),
      participaciones: new Map(
        ids.map((id) => [
          id,
          partes.filter((x) => x.prestamoId === id).map((x) => ({ participanteId: x.participanteId, pctGanancia: x.pctGanancia })),
        ]),
      ),
    }).asientos;
  }
  await tx.insert(asientos).values(lineas.map((a) => filaAsiento(transaccion!.id, a)));

  if (imp.cancelados.length) {
    await tx
      .update(prestamos)
      .set({ estado: "cancelado", fechaCierre: d.fecha })
      .where(inArray(prestamos.id, imp.cancelados));
  }

  return { pagoId, prestamos: ids, cancelados: imp.cancelados };
}
