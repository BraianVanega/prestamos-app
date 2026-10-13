import "server-only";
import Decimal from "decimal.js";
import { and, desc, eq, gte, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { db } from "./index";
import { efectivoPendiente, saldoCajaEfectivo } from "./conversion";
import { cargarResumenPrestamos, type ResumenPrestamo } from "./resumen-prestamos";
import { anulaciones, asientos, conversiones, pagos, participantes, transacciones, usuarios } from "./schema";
import { cuentasSocios, type Cuentas } from "./socios";
import type { Fecha } from "@/engine/fechas";
import {
  gananciaPorMes,
  rankingAtraso,
  ultimosMeses,
  agendaCobros,
  type BloqueAgenda,
  type PrestamoEnAtraso,
} from "@/engine/overview";
import { DECIMALES } from "@/engine/redondeo";

export interface Overview {
  hoy: Fecha;
  cuentas: Cuentas;
  prestamos: Map<string, ResumenPrestamo>;
  vigentes: number;
  /** Capital + interés impago de los vigentes (ARS, sin mora). */
  saldoPlanArs: Decimal;
  mes: {
    /** ARS cobrado en el mes por pagos no anulados. */
    cobradoArs: Decimal;
    pagos: number;
    /** Costo recuperado + ganancia reconocida en el mes (USDT, neto de anulaciones). */
    recuperadoUsdt: Decimal;
    gananciaUsdt: Decimal;
  };
  efectivo: { ars: Decimal; masViejo: Fecha | null };
  /** Cuotas a cobrar: vencidas + las de los próximos `diasAgenda` días. */
  agenda: BloqueAgenda[];
  diasAgenda: number;
  atraso: PrestamoEnAtraso[];
  /** Cartera (USDT) de los préstamos con atraso. */
  exposicionMoraUsdt: Decimal;
  ganancia: { mes: string; porSocio: { id: string; monto: Decimal }[]; total: Decimal }[];
  ultimoTc: { tc: Decimal; fecha: Fecha; origen: "cobro" | "conversión" } | null;
  ultimaOperacion: { en: Date; tipo: string; descripcion: string | null; usuario: string } | null;
}

/** Horizontes de la agenda de cobros (días); el primero es el de entrada. */
export const DIAS_AGENDA = [7, 15, 30] as const;
export const MESES_GANANCIA = 6;

export async function cargarOverview(hoy: Fecha, diasAgenda: number = DIAS_AGENDA[0]): Promise<Overview> {
  const mesActual = hoy.slice(0, 7);
  const meses = ultimosMeses(hoy, MESES_GANANCIA);
  const desde = `${meses[0]}-01`;
  const pagosAnulados = db.select({ id: anulaciones.entidadId }).from(anulaciones).where(eq(anulaciones.entidad, "pagos"));

  const [resumen, cuentas, cajaEfectivo, pendientes, libroMes, movGanancia, socios, cobradoMes, ultimoCobro, ultimaConversion, ultimaTx] =
    await Promise.all([
      cargarResumenPrestamos(hoy),
      cuentasSocios(db),
      saldoCajaEfectivo(db),
      efectivoPendiente(db),
      db
        .select({ cuenta: asientos.cuenta, monto: sql<string>`sum(${asientos.monto})` })
        .from(asientos)
        .innerJoin(transacciones, eq(transacciones.id, asientos.transaccionId))
        .where(
          and(
            inArray(asientos.cuenta, ["cartera", "ganancia"]),
            // Los pagos a terceros no son recupero; la reversa de un desembolso (préstamo corregido) tampoco.
            notInArray(transacciones.tipo, ["desembolso", "apertura", "retiro"]),
            sql`not exists (select 1 from transacciones original where original.id = ${transacciones.anulaTransaccionId} and original.tipo in ('desembolso', 'retiro'))`,
            sql`to_char(${transacciones.fecha}, 'YYYY-MM') = ${mesActual}`,
          ),
        )
        .groupBy(asientos.cuenta),
      db
        .select({
          fecha: transacciones.fecha,
          participanteId: asientos.participanteId,
          esSociedad: sql<boolean>`${participantes.tipo} = 'sociedad'`,
          monto: asientos.monto,
        })
        .from(asientos)
        .innerJoin(transacciones, eq(transacciones.id, asientos.transaccionId))
        .innerJoin(participantes, eq(participantes.id, asientos.participanteId))
        .where(and(eq(asientos.cuenta, "ganancia"), gte(transacciones.fecha, desde))),
      db
        .select({ id: participantes.id, pct: participantes.pctSociedad })
        .from(participantes)
        .where(and(eq(participantes.tipo, "socio"), eq(participantes.activo, true)))
        .orderBy(participantes.nombre),
      db
        .select({ ars: sql<string>`coalesce(sum(${pagos.ars}), 0)`, n: sql<number>`count(*)::int` })
        .from(pagos)
        .where(and(notInArray(pagos.id, pagosAnulados), sql`to_char(${pagos.fecha}, 'YYYY-MM') = ${mesActual}`)),
      db
        .select({ tc: pagos.tcSalida, fecha: pagos.fecha })
        .from(pagos)
        .where(and(isNotNull(pagos.tcSalida), notInArray(pagos.id, pagosAnulados)))
        .orderBy(desc(pagos.fecha), desc(pagos.creadoEn))
        .limit(1),
      db
        .select({ tc: conversiones.tc, fecha: conversiones.fecha })
        .from(conversiones)
        .where(sql`${conversiones.id} not in (select entidad_id from anulaciones where entidad = 'conversiones')`)
        .orderBy(desc(conversiones.fecha), desc(conversiones.creadoEn))
        .limit(1),
      db
        .select({ en: transacciones.creadoEn, tipo: transacciones.tipo, descripcion: transacciones.descripcion, usuario: usuarios.nombre })
        .from(transacciones)
        .innerJoin(usuarios, eq(usuarios.id, transacciones.creadoPor))
        .orderBy(desc(transacciones.creadoEn))
        .limit(1),
    ]);

  const vigentes = resumen.filter((p) => p.estado === "vigente");
  const agenda = resumen.map((p) => ({ id: p.id, estado: p.estado, cuotas: p.plan.cuotas, riesgo: p.riesgo, diasAtraso: p.plan.diasAtraso }));
  const atraso = rankingAtraso(agenda);
  const prestamos = new Map(resumen.map((p) => [p.id, p]));
  const suma = (cuenta: string) => new Decimal(libroMes.find((x) => x.cuenta === cuenta)?.monto ?? 0);
  const gananciaMeses = gananciaPorMes(
    movGanancia.map((m) => ({ ...m, participanteId: m.participanteId! })),
    meses,
    socios.map((s) => ({ id: s.id, pct: s.pct ?? "0" })),
    DECIMALES.usdt,
  );

  // Último TC usado: el más reciente entre cobros por transferencia y conversiones.
  const candidatos = [
    ...ultimoCobro.map((x) => ({ tc: new Decimal(x.tc!), fecha: x.fecha, origen: "cobro" as const })),
    ...ultimaConversion.map((x) => ({ tc: new Decimal(x.tc), fecha: x.fecha, origen: "conversión" as const })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));

  return {
    hoy,
    cuentas,
    prestamos,
    vigentes: vigentes.length,
    saldoPlanArs: vigentes.reduce((s, p) => s.plus(p.plan.saldoArs), new Decimal(0)),
    mes: {
      cobradoArs: new Decimal(cobradoMes[0]?.ars ?? 0),
      pagos: cobradoMes[0]?.n ?? 0,
      recuperadoUsdt: suma("cartera").plus(suma("ganancia")).neg(),
      // La de los socios (sin la parte de los terceros), como la tarjeta.
      gananciaUsdt: gananciaMeses.at(-1)?.total ?? new Decimal(0),
    },
    efectivo: { ars: cajaEfectivo, masViejo: pendientes[0]?.fecha ?? null },
    agenda: agendaCobros(agenda, hoy, diasAgenda),
    diasAgenda,
    atraso,
    exposicionMoraUsdt: atraso.reduce((s, a) => s.plus(prestamos.get(a.id)!.carteraUsdt), new Decimal(0)),
    ganancia: gananciaMeses,
    ultimoTc: candidatos[0] ?? null,
    ultimaOperacion: ultimaTx[0] ?? null,
  };
}
