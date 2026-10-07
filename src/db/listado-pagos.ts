import Decimal from "decimal.js";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { db, Tx } from "./index";
import { anulaciones, asientos, clientes, conversionLotes, conversiones, imputaciones, pagos, prestamos, transacciones, usuarios } from "./schema";
import { usdtConversion } from "@/engine/conversion";
import type { Fecha } from "@/engine/fechas";

type Lector = typeof db | Tx;

export type EstadoConversion = "sin_convertir" | "parcial" | "convertido";

export interface PagoListado {
  id: string;
  fecha: Fecha;
  en: Date;
  tipo: "transferencia" | "efectivo";
  ars: Decimal;
  /** Solo transferencia. */
  tcSalida: Decimal | null;
  /** Transferencia: ars / TC. Efectivo: USDT de las conversiones vigentes. */
  usdt: Decimal;
  /** Efectivo: ARS convertido por conversiones vigentes; null en transferencias. */
  convertidoArs: Decimal | null;
  conversion: EstadoConversion | null;
  metodo: string | null;
  notas: string | null;
  cliente: { id: string; nombre: string; documento: string | null };
  /** Imputado por préstamo (incluye saldo a favor aplicado después desde este pago). */
  prestamos: { id: string; numero: number; ars: Decimal }[];
  /** Saldo a favor que le queda al pago. */
  saldoFavor: Decimal;
  usuario: string;
  anulado: boolean;
  motivoAnulacion: string | null;
}

/** Todos los pagos, del más nuevo al más viejo, con su imputación, conversión y anulación. */
export async function cargarPagos(l: Lector): Promise<PagoListado[]> {
  const anulacionesPago = l
    .select({ id: anulaciones.entidadId, motivo: anulaciones.motivo })
    .from(anulaciones)
    .where(eq(anulaciones.entidad, "pagos"))
    .as("anulacion_pago");
  const filas = await l
    .select({
      id: pagos.id,
      fecha: pagos.fecha,
      en: pagos.creadoEn,
      tipo: pagos.tipo,
      ars: pagos.ars,
      tcSalida: pagos.tcSalida,
      metodo: pagos.metodo,
      notas: pagos.notas,
      cliente: { id: clientes.id, nombre: clientes.nombre, documento: clientes.documento },
      usuario: usuarios.nombre,
      motivoAnulacion: anulacionesPago.motivo,
    })
    .from(pagos)
    .innerJoin(clientes, eq(clientes.id, pagos.clienteId))
    .innerJoin(usuarios, eq(usuarios.id, pagos.creadoPor))
    .leftJoin(anulacionesPago, eq(anulacionesPago.id, pagos.id))
    .orderBy(desc(pagos.fecha), desc(pagos.creadoEn));
  if (filas.length === 0) return [];
  const ids = filas.map((f) => f.id);
  const efectivo = filas.filter((f) => f.tipo === "efectivo").map((f) => f.id);
  const conversionAnulada = sql`${conversiones.id} in (select entidad_id from anulaciones where entidad = 'conversiones')`;

  const [porPrestamo, saldos, lotes, usdtConvertido] = await Promise.all([
    l
      .select({
        pagoId: imputaciones.pagoId,
        id: prestamos.id,
        numero: prestamos.numero,
        ars: sql<string>`sum(${imputaciones.ars})`,
      })
      .from(imputaciones)
      .innerJoin(prestamos, eq(prestamos.id, imputaciones.prestamoId))
      .where(inArray(imputaciones.pagoId, ids))
      .groupBy(imputaciones.pagoId, prestamos.id)
      .orderBy(prestamos.numero),
    l
      .select({ pagoId: imputaciones.pagoId, ars: sql<string>`sum(${imputaciones.ars})` })
      .from(imputaciones)
      .where(and(inArray(imputaciones.pagoId, ids), eq(imputaciones.concepto, "saldo_favor")))
      .groupBy(imputaciones.pagoId),
    efectivo.length
      ? l
          .select({ pagoId: conversionLotes.pagoId, ars: sql<string>`sum(${conversionLotes.ars})` })
          .from(conversionLotes)
          .innerJoin(conversiones, eq(conversiones.id, conversionLotes.conversionId))
          .where(and(inArray(conversionLotes.pagoId, efectivo), sql`not ${conversionAnulada}`))
          .groupBy(conversionLotes.pagoId)
      : [],
    efectivo.length
      ? l
          .select({ pagoId: transacciones.pagoId, usdt: sql<string>`sum(${asientos.monto})` })
          .from(asientos)
          .innerJoin(transacciones, eq(transacciones.id, asientos.transaccionId))
          .innerJoin(conversiones, eq(conversiones.id, transacciones.conversionId))
          .where(
            and(
              inArray(transacciones.pagoId, efectivo),
              eq(transacciones.tipo, "conversion"),
              eq(asientos.cuenta, "caja_usdt"),
              sql`not ${conversionAnulada}`,
            ),
          )
          .groupBy(transacciones.pagoId)
      : [],
  ]);

  return filas.map((f): PagoListado => {
    const ars = new Decimal(f.ars);
    const convertidoArs = f.tipo === "efectivo" ? new Decimal(lotes.find((x) => x.pagoId === f.id)?.ars ?? 0) : null;
    return {
      ...f,
      ars,
      tcSalida: f.tcSalida ? new Decimal(f.tcSalida) : null,
      usdt: f.tcSalida ? usdtConversion(ars, f.tcSalida) : new Decimal(usdtConvertido.find((x) => x.pagoId === f.id)?.usdt ?? 0),
      convertidoArs,
      conversion:
        convertidoArs === null ? null : convertidoArs.isZero() ? "sin_convertir" : convertidoArs.gte(ars) ? "convertido" : "parcial",
      prestamos: porPrestamo.filter((x) => x.pagoId === f.id).map((x) => ({ id: x.id, numero: x.numero, ars: new Decimal(x.ars) })),
      saldoFavor: new Decimal(saldos.find((x) => x.pagoId === f.id)?.ars ?? 0),
      anulado: f.motivoAnulacion !== null,
    };
  });
}
