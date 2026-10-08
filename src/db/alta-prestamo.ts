import type Decimal from "decimal.js";
import type { Tx } from "./index";
import {
  asientos,
  cuotas,
  prestamoParticipaciones,
  prestamos,
  transacciones,
} from "./schema";
import { calcularPlan } from "@/engine/cronograma";
import { asientosDesembolso, participacionSociedad } from "@/engine/desembolso";
import type { Fecha, Frecuencia } from "@/engine/fechas";
import { DECIMALES } from "@/engine/redondeo";
import { numeroPrestamo } from "@/lib/prestamos";

export interface AltaPrestamo {
  clienteId: string;
  fechaDesembolso: Fecha;
  arsCapital: Decimal;
  tcEntrada: Decimal;
  tasaMensualPct: Decimal;
  tasaTotalPct: Decimal;
  frecuencia: Frecuencia;
  nCuotas: number;
  moraPct: Decimal;
  diasGracia: number;
  notas: string | null;
}

/**
 * Alta completa de un préstamo dentro de la transacción recibida: préstamo,
 * participación (Sociedad 100/100), cuotas y desembolso (cartera +, caja −).
 * Los triggers diferidos validan participaciones al 100% y asientos balanceados al COMMIT.
 */
export async function insertarPrestamo(
  tx: Tx,
  d: AltaPrestamo,
  ctx: { usuarioId: string; sociedadId: string; corrigeAId?: string },
): Promise<{ id: string; numero: number }> {
  const plan = calcularPlan(d);

  const [prestamo] = await tx
    .insert(prestamos)
    .values({
      clienteId: d.clienteId,
      fechaDesembolso: d.fechaDesembolso,
      arsCapital: d.arsCapital.toFixed(DECIMALES.ars),
      tcEntrada: d.tcEntrada.toFixed(DECIMALES.tc),
      tasaMensualPct: d.tasaMensualPct.toFixed(DECIMALES.pct),
      tasaTotalPct: d.tasaTotalPct.toFixed(DECIMALES.pct),
      frecuencia: d.frecuencia,
      nCuotas: d.nCuotas,
      vencimientoFinal: plan.vencimientoFinal,
      moraPct: d.moraPct.toFixed(DECIMALES.pct),
      diasGracia: d.diasGracia,
      usdtPrestado: plan.usdtPrestado.toFixed(DECIMALES.usdt),
      arsInteresPactado: plan.arsInteresPactado.toFixed(DECIMALES.ars),
      notas: d.notas,
      corrigeAId: ctx.corrigeAId,
      creadoPor: ctx.usuarioId,
    })
    .returning({ id: prestamos.id, numero: prestamos.numero });
  const { id, numero } = prestamo!;

  await tx.insert(prestamoParticipaciones).values(
    participacionSociedad(ctx.sociedadId).map((p) => ({
      prestamoId: id,
      participanteId: p.participanteId,
      pctCapital: p.pctCapital.toFixed(DECIMALES.pct),
      pctGanancia: p.pctGanancia.toFixed(DECIMALES.pct),
    })),
  );

  await tx.insert(cuotas).values(
    plan.cuotas.map((c) => ({
      prestamoId: id,
      numero: c.numero,
      vencimiento: c.vencimiento,
      arsCapital: c.arsCapital.toFixed(DECIMALES.ars),
      arsInteres: c.arsInteres.toFixed(DECIMALES.ars),
    })),
  );

  const [transaccion] = await tx
    .insert(transacciones)
    .values({
      fecha: d.fechaDesembolso,
      tipo: "desembolso",
      descripcion: `Desembolso ${numeroPrestamo(numero)}`,
      prestamoId: id,
      creadoPor: ctx.usuarioId,
    })
    .returning({ id: transacciones.id });

  await tx.insert(asientos).values(
    asientosDesembolso(id, plan.usdtPrestado).map((a) => ({
      transaccionId: transaccion!.id,
      cuenta: a.cuenta,
      moneda: a.moneda,
      monto: a.monto.toFixed(DECIMALES.usdt),
      prestamoId: a.prestamoId,
      participanteId: a.participanteId,
      clienteId: a.clienteId,
    })),
  );

  return { id, numero };
}
