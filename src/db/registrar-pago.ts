import Decimal from "decimal.js";
import { and, asc, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import type { db, Tx } from "./index";
import {
  anulaciones,
  asientos,
  cargos,
  clientes,
  conversionLotes,
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
  aplicarDescuentos,
  asientosAplicacionSaldo,
  asientosCobroEfectivo,
  asientosIngresoUsdt,
  deudasAFecha,
  ErrorImputacion,
  imputarCobro,
  valorSaldoUsdt,
  type CuotaParaCobro,
  type PrestamoParaCobro,
} from "@/engine/pago";
import { DECIMALES } from "@/engine/redondeo";
import { formatearFecha } from "@/lib/formato";
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
export function cargarDeudaCliente(l: Lector, clienteId: string): Promise<PrestamoParaCobro[]> {
  return cargarDeuda(l, and(eq(prestamos.clienteId, clienteId), eq(prestamos.estado, "vigente"))!);
}

/** Igual que `cargarDeudaCliente`, para los préstamos que cumplen `condicion` (cualquier estado). */
export async function cargarDeuda(l: Lector, condicion: SQL): Promise<PrestamoParaCobro[]> {
  const vigentes = await l
    .select({
      id: prestamos.id,
      numero: prestamos.numero,
      nCuotas: prestamos.nCuotas,
      moraPct: prestamos.moraPct,
      diasGracia: prestamos.diasGracia,
    })
    .from(prestamos)
    .where(condicion)
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

export interface SaldoDePago {
  pagoId: string;
  fecha: Fecha;
  tipo: "transferencia" | "efectivo";
  /** Saldo a favor que le queda al pago, en ARS. */
  ars: Decimal;
  /** Lo que vale en USDT según el libro; null si es efectivo todavía sin convertir. */
  usdt: Decimal | null;
  /** Efectivo convertido en parte: no se aplica hasta terminar de convertirlo. */
  aplicable: boolean;
}

/**
 * Saldo a favor del cliente pago por pago, del más viejo al más nuevo. Se aplica
 * contra su pago de origen: una transferencia (o efectivo ya convertido) aporta
 * los USDT que registró; el efectivo sin convertir solo cambia la imputación y
 * la conversión, después, reparte según ella.
 */
export async function saldosAFavor(l: Lector, clienteId: string): Promise<SaldoDePago[]> {
  const filas = await l
    .select({
      pagoId: pagos.id,
      fecha: pagos.fecha,
      tipo: pagos.tipo,
      pagoArs: pagos.ars,
      ars: sql<string>`sum(${imputaciones.ars})`,
    })
    .from(imputaciones)
    .innerJoin(pagos, eq(pagos.id, imputaciones.pagoId))
    .where(and(eq(pagos.clienteId, clienteId), eq(imputaciones.concepto, "saldo_favor"), notInArray(pagos.id, pagosAnulados(l))))
    .groupBy(pagos.id)
    .having(sql`sum(${imputaciones.ars}) > 0`)
    .orderBy(asc(pagos.fecha), asc(pagos.creadoEn));
  if (filas.length === 0) return [];
  const ids = filas.map((f) => f.pagoId);

  const conversionesAnuladas = l.select({ id: anulaciones.entidadId }).from(anulaciones).where(eq(anulaciones.entidad, "conversiones"));
  const [libro, convertido] = await Promise.all([
    l
      .select({ pagoId: transacciones.pagoId, usdt: sql<string>`-sum(${asientos.monto})` })
      .from(asientos)
      .innerJoin(transacciones, eq(transacciones.id, asientos.transaccionId))
      .where(and(inArray(transacciones.pagoId, ids), eq(asientos.cuenta, "saldo_favor")))
      .groupBy(transacciones.pagoId),
    l
      .select({ pagoId: conversionLotes.pagoId, ars: sql<string>`sum(${conversionLotes.ars})` })
      .from(conversionLotes)
      .where(and(inArray(conversionLotes.pagoId, ids), notInArray(conversionLotes.conversionId, conversionesAnuladas)))
      .groupBy(conversionLotes.pagoId),
  ]);

  return filas.map((f) => {
    const usdt = new Decimal(libro.find((x) => x.pagoId === f.pagoId)?.usdt ?? 0);
    const conv = new Decimal(convertido.find((x) => x.pagoId === f.pagoId)?.ars ?? 0);
    const sinConvertir = f.tipo === "efectivo" && conv.isZero();
    return {
      pagoId: f.pagoId,
      fecha: f.fecha,
      tipo: f.tipo,
      ars: new Decimal(f.ars),
      usdt: sinConvertir ? null : usdt,
      aplicable: f.tipo === "transferencia" || sinConvertir || conv.eq(f.pagoArs),
    };
  });
}

export interface NuevoPago {
  clienteId: string;
  fecha: Fecha;
  tipo: "transferencia" | "efectivo";
  /** Monto cobrado ahora; 0 si solo se aplica saldo a favor. */
  ars: Decimal;
  /** Solo transferencia. */
  tcSalida: Decimal | null;
  metodo: string | null;
  notas: string | null;
  /** Monto a imputar por clave de deuda (ver `deudasAFecha`). */
  montos: Map<string, Decimal>;
  /** Aplicar el saldo a favor del cliente antes que el pago nuevo. */
  usarSaldo: boolean;
  /** Descuento por clave de deuda (baja mora y después interés). */
  descuentos: Map<string, Decimal>;
  motivoDescuento: string | null;
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
 * Registra un cobro completo dentro de la transacción recibida: mora que nace a
 * la fecha y descuentos (cargos), saldo a favor aplicado (imputaciones contra su
 * pago de origen + asientos), pago nuevo con sus imputaciones, transacción de
 * cobro y asientos, y cierre de los préstamos que quedan saldados. La deuda se
 * vuelve a calcular acá con el cliente bloqueado, así dos pagos simultáneos no
 * imputan lo mismo. Lanza `ErrorImputacion` si los montos no cierran con la deuda actual.
 */
export async function insertarPago(
  tx: Tx,
  d: NuevoPago,
  ctx: { usuarioId: string },
): Promise<{ pagoId: string | null; prestamos: string[]; cancelados: string[] }> {
  const [cliente] = await tx
    .select({ id: clientes.id, nombre: clientes.nombre })
    .from(clientes)
    .where(eq(clientes.id, d.clienteId))
    .for("update");
  if (!cliente) throw new ErrorImputacion("El cliente no existe.");
  if (d.ars.gt(0) && (d.tipo === "transferencia") !== (d.tcSalida !== null)) throw new ErrorImputacion("El TC va solo en transferencias.");

  const deuda = await cargarDeudaCliente(tx, d.clienteId);
  const aFecha = deudasAFecha(deuda, d.fecha);
  const { deudas, descuentos } = aplicarDescuentos(aFecha.deudas, d.descuentos);
  if (descuentos.length && !d.motivoDescuento) throw new ErrorImputacion("Indicá el motivo del descuento.");
  const saldos = d.usarSaldo ? (await saldosAFavor(tx, d.clienteId)).filter((x) => x.aplicable) : [];
  const imp = imputarCobro({ deudas, montos: d.montos, nuevo: d.ars, saldos });
  const numeros = new Map(deuda.map((p) => [p.id, p.numero]));
  const conCuota = new Map(aFecha.deudas.map((x) => [x.cuotaId, x.cuotaNumero]));

  const nuevosCargos = [
    ...aFecha.moraNueva.map((m) => ({
      prestamoId: m.prestamoId,
      cuotaId: m.cuotaId,
      fecha: m.fecha,
      tipo: "mora" as const,
      ars: m.ars.toFixed(DECIMALES.ars),
      motivo: `Mora ${formatearPct(m.moraPct)}% sobre $${formatearArs(m.base)} de capital impago (cuota ${m.cuotaNumero})`,
    })),
    ...descuentos.map((x) => ({
      prestamoId: x.prestamoId,
      cuotaId: x.cuotaId,
      fecha: d.fecha,
      tipo: "descuento" as const,
      ars: x.ars.neg().toFixed(DECIMALES.ars),
      motivo: `${d.motivoDescuento} (${x.cuotaId ? `cuota ${conCuota.get(x.cuotaId)}` : "cargos"})`,
    })),
  ];
  if (nuevosCargos.length) {
    await tx.insert(cargos).values(nuevosCargos.map((c) => ({ ...c, creadoPor: ctx.usuarioId })));
  }

  // Cartera y participaciones de los préstamos que reciben algo; la cartera se
  // actualiza en memoria a medida que cada parte recupera costo.
  const ids = [...new Set([...imp.aplicaciones, ...(imp.pago ? [imp.pago] : [])].flatMap((f) => f.porPrestamo.map((p) => p.prestamoId)))];
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
  const cartera = new Map<string, Decimal.Value>(carteras.map((c) => [c.prestamoId!, c.monto]));
  const participaciones = new Map(
    ids.map((id) => [
      id,
      partes.filter((x) => x.prestamoId === id).map((x) => ({ participanteId: x.participanteId, pctGanancia: x.pctGanancia })),
    ]),
  );
  const asentar = async (transaccionId: string, lineas: Asiento[]) => {
    for (const a of lineas) if (a.cuenta === "cartera") cartera.set(a.prestamoId!, new Decimal(cartera.get(a.prestamoId!) ?? 0).plus(a.monto));
    await tx.insert(asientos).values(lineas.map((a) => filaAsiento(transaccionId, a)));
  };
  const destino = (porPrestamo: { prestamoId: string }[], saldo: boolean) =>
    [...porPrestamo.map((p) => numeroPrestamo(numeros.get(p.prestamoId)!)), ...(saldo ? ["saldo a favor"] : [])].join(", ");
  const filaImputacion = (pagoId: string) => (l: (typeof imp.aplicaciones)[number]["lineas"][number]) => ({
    pagoId,
    fecha: d.fecha,
    prestamoId: l.prestamoId,
    cuotaId: l.cuotaId,
    concepto: l.concepto,
    ars: l.ars.toFixed(DECIMALES.ars),
    creadoPor: ctx.usuarioId,
  });

  // 1. Saldo a favor aplicado, del pago más viejo al más nuevo.
  for (const a of imp.aplicaciones) {
    const origen = saldos.find((x) => x.pagoId === a.pagoId)!;
    await tx.insert(imputaciones).values(a.lineas.map(filaImputacion(origen.pagoId)));
    if (origen.usdt === null) continue; // efectivo sin convertir: la conversión lo realiza
    const [t] = await tx
      .insert(transacciones)
      .values({
        fecha: d.fecha,
        tipo: "aplicacion_saldo_favor",
        descripcion: `Aplicación de saldo a favor de $${formatearArs(a.aplicado)} (pago del ${formatearFecha(origen.fecha)}) → ${destino(a.porPrestamo, false)}`,
        prestamoId: a.porPrestamo.length === 1 ? a.porPrestamo[0]!.prestamoId : null,
        pagoId: origen.pagoId,
        creadoPor: ctx.usuarioId,
      })
      .returning({ id: transacciones.id });
    await asentar(
      t!.id,
      asientosAplicacionSaldo({
        usdt: valorSaldoUsdt(a.aplicado, origen.ars, origen.usdt),
        porPrestamo: a.porPrestamo,
        clienteId: d.clienteId,
        cartera,
        participaciones,
      }).asientos,
    );
  }

  // 2. El pago nuevo.
  let pagoId: string | null = null;
  if (imp.pago) {
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
    pagoId = pago!.id;
    await tx.insert(imputaciones).values(imp.pago.lineas.map(filaImputacion(pagoId)));

    const porPrestamo = imp.pago.porPrestamo;
    const [t] = await tx
      .insert(transacciones)
      .values({
        fecha: d.fecha,
        tipo: "cobro",
        descripcion: `Cobro ${d.tipo === "efectivo" ? "en efectivo" : "por transferencia"} de $${formatearArs(d.ars)} → ${destino(porPrestamo, imp.pago.saldoFavor.gt(0))}`,
        prestamoId: porPrestamo.length === 1 ? porPrestamo[0]!.prestamoId : null,
        pagoId,
        creadoPor: ctx.usuarioId,
      })
      .returning({ id: transacciones.id });
    await asentar(
      t!.id,
      d.tipo === "efectivo"
        ? asientosCobroEfectivo(d.ars)
        : asientosIngresoUsdt({
            tc: d.tcSalida!,
            porPrestamo,
            saldoFavorArs: imp.pago.saldoFavor,
            clienteId: d.clienteId,
            cartera,
            participaciones,
          }).asientos,
    );
  }

  if (imp.cancelados.length) {
    await tx
      .update(prestamos)
      .set({ estado: "cancelado", fechaCierre: d.fecha })
      .where(inArray(prestamos.id, imp.cancelados));
  }

  return { pagoId, prestamos: [...new Set([...ids, ...imp.cancelados])], cancelados: imp.cancelados };
}
