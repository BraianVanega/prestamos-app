import "server-only";
import Decimal from "decimal.js";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "./index";
import {
  anulaciones,
  asientos,
  cargos,
  clientes,
  cuotas,
  imputaciones,
  participantes,
  prestamoParticipaciones,
  prestamos,
} from "./schema";
import { cargosDeCuota, estadoCuotas, nivelRiesgo, recuperadoUsdt, type EstadoCuotas, type NivelRiesgo } from "@/engine/estado-prestamo";
import { diasEntre, type Fecha } from "@/engine/fechas";

export interface ResumenPrestamo {
  id: string;
  numero: number;
  estado: (typeof prestamos.$inferSelect)["estado"];
  fechaDesembolso: Fecha;
  nCuotas: number;
  cliente: { id: string; nombre: string; documento: string | null };
  dueno: string;
  arsCapital: Decimal;
  tcEntrada: Decimal;
  usdtPrestado: Decimal;
  recuperadoUsdt: Decimal;
  /** Costo en USDT todavía no recuperado (saldo de cartera). */
  carteraUsdt: Decimal;
  plan: EstadoCuotas;
  riesgo: NivelRiesgo;
}

/** Pagos anulados: sus imputaciones no cuentan. */
const pagosAnulados = db
  .select({ id: anulaciones.entidadId })
  .from(anulaciones)
  .where(eq(anulaciones.entidad, "pagos"));

/** Etiqueta del dueño del capital según las participaciones del préstamo. */
function etiquetaDueno(
  partes: { tipo: string; nombre: string }[],
  socios: { nombre: string; pctSociedad: string | null }[],
): string {
  if (partes.length !== 1) return "Mixto";
  const [p] = partes;
  if (p!.tipo === "sociedad") {
    const pcts = socios.map((s) => new Decimal(s.pctSociedad ?? 0).toDecimalPlaces(0).toString());
    return pcts.length ? `Sociedad ${pcts.join("/")}` : "Sociedad";
  }
  return p!.nombre;
}

/**
 * Resumen de todos los préstamos a la fecha `hoy`: plan de cuotas con saldos
 * (imputaciones de pagos no anulados), atraso, riesgo y USDT recuperado según
 * el libro. Pocas consultas para el conjunto; el cálculo lo hace el motor.
 */
export async function cargarResumenPrestamos(hoy: Fecha): Promise<ResumenPrestamo[]> {
  const filas = await db
    .select({
      id: prestamos.id,
      numero: prestamos.numero,
      estado: prestamos.estado,
      fechaDesembolso: prestamos.fechaDesembolso,
      nCuotas: prestamos.nCuotas,
      vencimientoFinal: prestamos.vencimientoFinal,
      arsCapital: prestamos.arsCapital,
      tcEntrada: prestamos.tcEntrada,
      usdtPrestado: prestamos.usdtPrestado,
      clienteId: clientes.id,
      clienteNombre: clientes.nombre,
      clienteDocumento: clientes.documento,
    })
    .from(prestamos)
    .innerJoin(clientes, eq(clientes.id, prestamos.clienteId));
  if (filas.length === 0) return [];
  const ids = filas.map((f) => f.id);

  const cargosAnulados = db.select({ id: anulaciones.entidadId }).from(anulaciones).where(eq(anulaciones.entidad, "cargos"));
  const [planes, pagado, cargosCuota, libro, partes, socios] = await Promise.all([
    db.select().from(cuotas).where(inArray(cuotas.prestamoId, ids)),
    db
      .select({
        cuotaId: imputaciones.cuotaId,
        concepto: imputaciones.concepto,
        ars: sql<string>`sum(${imputaciones.ars})`,
      })
      .from(imputaciones)
      .where(
        and(
          inArray(imputaciones.prestamoId, ids),
          inArray(imputaciones.concepto, ["capital", "interes", "mora"]),
          notInArray(imputaciones.pagoId, pagosAnulados),
        ),
      )
      .groupBy(imputaciones.cuotaId, imputaciones.concepto),
    db
      .select({ cuotaId: cargos.cuotaId, ars: sql<string>`sum(${cargos.ars})` })
      .from(cargos)
      .where(and(inArray(cargos.prestamoId, ids), notInArray(cargos.id, cargosAnulados)))
      .groupBy(cargos.cuotaId),
    db
      .select({
        prestamoId: asientos.prestamoId,
        cuenta: asientos.cuenta,
        monto: sql<string>`sum(${asientos.monto})`,
      })
      .from(asientos)
      .where(and(inArray(asientos.prestamoId, ids), inArray(asientos.cuenta, ["cartera", "ganancia"])))
      .groupBy(asientos.prestamoId, asientos.cuenta),
    db
      .select({ prestamoId: prestamoParticipaciones.prestamoId, tipo: participantes.tipo, nombre: participantes.nombre })
      .from(prestamoParticipaciones)
      .innerJoin(participantes, eq(participantes.id, prestamoParticipaciones.participanteId))
      .where(inArray(prestamoParticipaciones.prestamoId, ids)),
    db
      .select({ nombre: participantes.nombre, pctSociedad: participantes.pctSociedad })
      .from(participantes)
      .where(eq(participantes.tipo, "socio"))
      .orderBy(participantes.nombre),
  ]);

  const pagadoPorCuota = new Map<string, { capital: string; interes: string; mora: string }>();
  for (const p of pagado) {
    if (!p.cuotaId) continue;
    const actual = pagadoPorCuota.get(p.cuotaId) ?? { capital: "0", interes: "0", mora: "0" };
    if (p.concepto === "capital") actual.capital = p.ars;
    if (p.concepto === "interes") actual.interes = p.ars;
    if (p.concepto === "mora") actual.mora = p.ars;
    pagadoPorCuota.set(p.cuotaId, actual);
  }
  const cargosPorCuota = new Map(cargosCuota.flatMap((c) => (c.cuotaId ? [[c.cuotaId, c.ars] as const] : [])));

  const agrupar = <T extends { prestamoId: string | null }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) if (x.prestamoId) m.set(x.prestamoId, [...(m.get(x.prestamoId) ?? []), x]);
    return m;
  };
  const cuotasPor = agrupar(planes);
  const libroPor = agrupar(libro);
  const partesPor = agrupar(partes);

  return filas.map((f) => {
    const plan = estadoCuotas(
      (cuotasPor.get(f.id) ?? []).map((c) => ({
        id: c.id,
        numero: c.numero,
        vencimiento: c.vencimiento,
        arsCapital: c.arsCapital,
        arsInteres: c.arsInteres,
        pagadoCapital: pagadoPorCuota.get(c.id)?.capital ?? "0",
        pagadoInteres: pagadoPorCuota.get(c.id)?.interes ?? "0",
        descuentoInteres: cargosDeCuota(cargosPorCuota.get(c.id) ?? "0", pagadoPorCuota.get(c.id)?.mora ?? "0").descuentoInteres,
      })),
      hoy,
    );
    const asientosPrestamo = libroPor.get(f.id) ?? [];
    const suma = (cuenta: string) => asientosPrestamo.find((a) => a.cuenta === cuenta)?.monto ?? "0";

    return {
      id: f.id,
      numero: f.numero,
      estado: f.estado,
      fechaDesembolso: f.fechaDesembolso,
      nCuotas: f.nCuotas,
      cliente: { id: f.clienteId, nombre: f.clienteNombre, documento: f.clienteDocumento },
      dueno: etiquetaDueno(partesPor.get(f.id) ?? [], socios),
      arsCapital: new Decimal(f.arsCapital),
      tcEntrada: new Decimal(f.tcEntrada),
      usdtPrestado: new Decimal(f.usdtPrestado),
      // Un anulado no recuperó nada: su cartera quedó en cero por la reversa del desembolso.
      recuperadoUsdt:
        f.estado === "anulado"
          ? new Decimal(0)
          : recuperadoUsdt({
              usdtPrestado: f.usdtPrestado,
              saldoCartera: suma("cartera"),
              gananciaAsientos: suma("ganancia"),
            }),
      carteraUsdt: new Decimal(suma("cartera")),
      plan,
      riesgo: f.estado === "vigente" ? nivelRiesgo(plan.diasAtraso, diasEntre(f.fechaDesembolso, f.vencimientoFinal)) : "verde",
    };
  });
}
