import "server-only";
import Decimal from "decimal.js";
import { aliasedTable, and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "./index";
import {
  anulaciones,
  asientos,
  cargos,
  clientes,
  cuotas,
  imputaciones,
  pagos,
  participantes,
  prestamoParticipaciones,
  prestamos,
  transacciones,
  usuarios,
} from "./schema";
import {
  estadoCuotas,
  nivelRiesgo,
  recuperadoUsdt,
  saldoExigible,
  type EstadoCuotas,
  type NivelRiesgo,
  type SaldoExigible,
} from "@/engine/estado-prestamo";
import { diasEntre, type Fecha } from "@/engine/fechas";
import { moraACargar, type MoraACargar } from "@/engine/mora";
import { DECIMALES } from "@/engine/redondeo";
import { abrirSociedad, repartir } from "@/engine/reparto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UltimoPago {
  fecha: Fecha;
  tipo: "transferencia" | "efectivo";
  tcSalida: Decimal | null;
}

export interface CargoFicha {
  id: string;
  fecha: Fecha;
  tipo: "mora" | "descuento" | "ajuste";
  ars: Decimal;
  motivo: string;
  cuotaNumero: number | null;
  creadoPor: string;
  anulado: boolean;
}

export interface EventoFicha {
  id: string;
  en: Date;
  tipo: (typeof transacciones.$inferSelect)["tipo"];
  descripcion: string | null;
  motivo: string | null;
  usuario: string;
  /** Movimiento de cartera + ganancia de este préstamo en la transacción (USDT). */
  usdt: Decimal;
  anulada: boolean;
}

export interface TitularFicha {
  id: string;
  nombre: string;
  /** % efectivo sobre el capital del préstamo (la Sociedad ya abierta por socio). */
  pctCapital: Decimal;
  capitalUsdt: Decimal;
  gananciaUsdt: Decimal;
}

export interface FichaPrestamo {
  prestamo: typeof prestamos.$inferSelect;
  cliente: { id: string; nombre: string; documento: string | null; estado: string };
  plan: EstadoCuotas;
  /** Capital e interés pactados por cuota (el plan trae saldos). */
  cuotasOriginales: Map<string, { capital: Decimal; interes: Decimal }>;
  ultimoPagoPorCuota: Map<string, UltimoPago>;
  riesgo: NivelRiesgo;
  diasPlazo: number;
  /** Total imputado (todos los conceptos) por pagos no anulados. */
  cobradoArs: Decimal;
  recuperadoUsdt: Decimal;
  gananciaUsdt: Decimal;
  saldo: SaldoExigible;
  moraPendiente: (MoraACargar & { cuotaNumero: number })[];
  cargos: CargoFicha[];
  /** "Sociedad", nombre del titular o "Mixto". */
  estructura: string;
  titulares: TitularFicha[];
  historial: EventoFicha[];
}

/** Todo lo que muestra la ficha del préstamo a la fecha `hoy`. */
export async function cargarFichaPrestamo(id: string, hoy: Fecha): Promise<FichaPrestamo | null> {
  if (!UUID.test(id)) return null;
  const [fila] = await db
    .select({
      prestamo: prestamos,
      cliente: { id: clientes.id, nombre: clientes.nombre, documento: clientes.documento, estado: clientes.estado },
    })
    .from(prestamos)
    .innerJoin(clientes, eq(clientes.id, prestamos.clienteId))
    .where(eq(prestamos.id, id));
  if (!fila) return null;
  const p = fila.prestamo;

  const anulacionPago = aliasedTable(anulaciones, "anulacion_pago");
  const anulacionCargo = aliasedTable(anulaciones, "anulacion_cargo");
  const pagosDelPrestamo = db.selectDistinct({ id: imputaciones.pagoId }).from(imputaciones).where(eq(imputaciones.prestamoId, id));

  const consultaHistorial = db
      .select({
        id: transacciones.id,
        en: transacciones.creadoEn,
        tipo: transacciones.tipo,
        descripcion: transacciones.descripcion,
        motivo: transacciones.motivo,
        usuario: usuarios.nombre,
        anulada: sql<boolean>`exists (select 1 from transacciones anulante where anulante.anula_transaccion_id = ${transacciones.id})`,
      })
      .from(transacciones)
      .innerJoin(usuarios, eq(usuarios.id, transacciones.creadoPor))
      .where(or(eq(transacciones.prestamoId, id), inArray(transacciones.pagoId, pagosDelPrestamo)))
      .orderBy(desc(transacciones.creadoEn));

  const [plan, imputado, filasCargos, partes, socios, libro, txs] = await Promise.all([
    db.select().from(cuotas).where(eq(cuotas.prestamoId, id)).orderBy(asc(cuotas.numero)),
    db
      .select({
        cuotaId: imputaciones.cuotaId,
        concepto: imputaciones.concepto,
        ars: imputaciones.ars,
        fecha: pagos.fecha,
        tipo: pagos.tipo,
        tcSalida: pagos.tcSalida,
        anulado: sql<boolean>`${anulacionPago.id} is not null`,
      })
      .from(imputaciones)
      .innerJoin(pagos, eq(pagos.id, imputaciones.pagoId))
      .leftJoin(anulacionPago, and(eq(anulacionPago.entidad, "pagos"), eq(anulacionPago.entidadId, pagos.id)))
      .where(eq(imputaciones.prestamoId, id))
      .orderBy(asc(pagos.fecha), asc(imputaciones.creadoEn)),
    db
      .select({
        id: cargos.id,
        cuotaId: cargos.cuotaId,
        fecha: cargos.fecha,
        tipo: cargos.tipo,
        ars: cargos.ars,
        motivo: cargos.motivo,
        creadoPor: usuarios.nombre,
        anulado: sql<boolean>`${anulacionCargo.id} is not null`,
      })
      .from(cargos)
      .innerJoin(usuarios, eq(usuarios.id, cargos.creadoPor))
      .leftJoin(anulacionCargo, and(eq(anulacionCargo.entidad, "cargos"), eq(anulacionCargo.entidadId, cargos.id)))
      .where(eq(cargos.prestamoId, id))
      .orderBy(desc(cargos.fecha), desc(cargos.creadoEn)),
    db
      .select({
        participanteId: prestamoParticipaciones.participanteId,
        pctCapital: prestamoParticipaciones.pctCapital,
        tipo: participantes.tipo,
        nombre: participantes.nombre,
      })
      .from(prestamoParticipaciones)
      .innerJoin(participantes, eq(participantes.id, prestamoParticipaciones.participanteId))
      .where(eq(prestamoParticipaciones.prestamoId, id)),
    db
      .select({ id: participantes.id, nombre: participantes.nombre, pctSociedad: participantes.pctSociedad })
      .from(participantes)
      .where(eq(participantes.tipo, "socio"))
      .orderBy(participantes.nombre),
    db
      .select({
        transaccionId: asientos.transaccionId,
        cuenta: asientos.cuenta,
        participanteId: asientos.participanteId,
        monto: sql<string>`sum(${asientos.monto})`,
      })
      .from(asientos)
      .where(and(eq(asientos.prestamoId, id), inArray(asientos.cuenta, ["cartera", "ganancia"])))
      .groupBy(asientos.transaccionId, asientos.cuenta, asientos.participanteId),
    consultaHistorial,
  ]);

  // Plan con lo imputado por pagos vigentes.
  const vigentes = imputado.filter((i) => !i.anulado);
  const porCuota = new Map<string, { capital: Decimal; interes: Decimal; pagosCapital: { fecha: Fecha; ars: string }[] }>();
  const ultimoPagoPorCuota = new Map<string, UltimoPago>();
  for (const i of vigentes) {
    if (!i.cuotaId) continue;
    const a = porCuota.get(i.cuotaId) ?? { capital: new Decimal(0), interes: new Decimal(0), pagosCapital: [] };
    if (i.concepto === "capital") {
      a.capital = a.capital.plus(i.ars);
      a.pagosCapital.push({ fecha: i.fecha, ars: i.ars });
    }
    if (i.concepto === "interes") a.interes = a.interes.plus(i.ars);
    porCuota.set(i.cuotaId, a);
    if (i.concepto === "capital" || i.concepto === "interes") {
      ultimoPagoPorCuota.set(i.cuotaId, { fecha: i.fecha, tipo: i.tipo, tcSalida: i.tcSalida ? new Decimal(i.tcSalida) : null });
    }
  }
  const estado = estadoCuotas(
    plan.map((c) => ({
      id: c.id,
      numero: c.numero,
      vencimiento: c.vencimiento,
      arsCapital: c.arsCapital,
      arsInteres: c.arsInteres,
      pagadoCapital: porCuota.get(c.id)?.capital ?? "0",
      pagadoInteres: porCuota.get(c.id)?.interes ?? "0",
    })),
    hoy,
  );

  // Mora y cargos.
  const numeroCuota = new Map(plan.map((c) => [c.id, c.numero]));
  const cargosFicha: CargoFicha[] = filasCargos.map((c) => ({
    id: c.id,
    fecha: c.fecha,
    tipo: c.tipo,
    ars: new Decimal(c.ars),
    motivo: c.motivo,
    cuotaNumero: c.cuotaId ? (numeroCuota.get(c.cuotaId) ?? null) : null,
    creadoPor: c.creadoPor,
    anulado: c.anulado,
  }));
  const conMora = new Set(filasCargos.filter((c) => c.tipo === "mora" && c.cuotaId).map((c) => c.cuotaId));
  const moraPendiente =
    p.estado === "vigente"
      ? moraACargar({
          fecha: hoy,
          moraPct: p.moraPct,
          diasGracia: p.diasGracia,
          cuotas: plan.map((c) => ({
            cuotaId: c.id,
            vencimiento: c.vencimiento,
            arsCapital: c.arsCapital,
            pagosCapital: porCuota.get(c.id)?.pagosCapital ?? [],
            tieneMora: conMora.has(c.id),
          })),
        }).map((m) => ({ ...m, cuotaNumero: numeroCuota.get(m.cuotaId)! }))
      : [];
  const saldo = saldoExigible({
    saldoPlan: estado.saldoArs,
    cargos: cargosFicha.filter((c) => !c.anulado).map((c) => c.ars),
    imputadoCargos: vigentes.filter((i) => i.concepto === "mora").reduce((s, i) => s.plus(i.ars), new Decimal(0)),
    moraACargar: moraPendiente.map((m) => m.ars),
  });

  // Libro: cartera, ganancia por participante y movimiento por transacción.
  const sumaCuenta = (cuenta: string) =>
    libro.filter((a) => a.cuenta === cuenta).reduce((s, a) => s.plus(a.monto), new Decimal(0));
  const gananciaPor = new Map<string, Decimal>();
  const usdtPorTx = new Map<string, Decimal>();
  for (const a of libro) {
    usdtPorTx.set(a.transaccionId, (usdtPorTx.get(a.transaccionId) ?? new Decimal(0)).plus(a.monto));
    if (a.cuenta === "ganancia" && a.participanteId) {
      gananciaPor.set(a.participanteId, (gananciaPor.get(a.participanteId) ?? new Decimal(0)).minus(a.monto));
    }
  }

  // Titulares finales (la Sociedad abierta por socio).
  const partesSocios = socios.map((s) => ({ id: s.id, pct: s.pctSociedad ?? "0" }));
  const esSociedad = new Map(partes.map((x) => [x.participanteId, x.tipo === "sociedad"]));
  const capitalPor = repartir(
    p.usdtPrestado,
    partes.map((x) => ({ id: x.participanteId, pct: x.pctCapital })),
    DECIMALES.usdt,
  );
  const abrir = (montos: { id: string; monto: Decimal }[], decimales: number) =>
    abrirSociedad(
      montos.map((m) => ({ participanteId: m.id, esSociedad: esSociedad.get(m.id) ?? false, monto: m.monto })),
      partesSocios,
      decimales,
    );
  const pctAbierto = abrir(
    partes.map((x) => ({ id: x.participanteId, monto: new Decimal(x.pctCapital) })),
    DECIMALES.pct,
  );
  const capitalAbierto = abrir(capitalPor, DECIMALES.usdt);
  const gananciaAbierta = abrir(
    [...gananciaPor].map(([pid, monto]) => ({ id: pid, monto })),
    DECIMALES.usdt,
  );
  const nombres = new Map([...socios.map((s) => [s.id, s.nombre] as const), ...partes.map((x) => [x.participanteId, x.nombre] as const)]);
  const titulares: TitularFicha[] = pctAbierto
    .filter((t) => !t.monto.isZero())
    .map((t) => ({
      id: t.id,
      nombre: nombres.get(t.id) ?? "—",
      pctCapital: t.monto,
      capitalUsdt: capitalAbierto.find((c) => c.id === t.id)?.monto ?? new Decimal(0),
      gananciaUsdt: gananciaAbierta.find((g) => g.id === t.id)?.monto ?? new Decimal(0),
    }));

  const vencimientoFinal = p.vencimientoFinal;
  const diasPlazo = Math.max(diasEntre(p.fechaDesembolso, vencimientoFinal), 1);

  return {
    prestamo: p,
    cliente: fila.cliente,
    plan: estado,
    cuotasOriginales: new Map(plan.map((c) => [c.id, { capital: new Decimal(c.arsCapital), interes: new Decimal(c.arsInteres) }])),
    ultimoPagoPorCuota,
    riesgo: p.estado === "vigente" ? nivelRiesgo(estado.diasAtraso, diasPlazo) : "verde",
    diasPlazo,
    cobradoArs: vigentes.reduce((s, i) => s.plus(i.ars), new Decimal(0)),
    recuperadoUsdt: recuperadoUsdt({
      usdtPrestado: p.usdtPrestado,
      saldoCartera: sumaCuenta("cartera"),
      gananciaAsientos: sumaCuenta("ganancia"),
    }),
    gananciaUsdt: sumaCuenta("ganancia").neg(),
    saldo,
    moraPendiente,
    cargos: cargosFicha,
    estructura: partes.length === 1 ? (partes[0]!.tipo === "sociedad" ? "Sociedad" : partes[0]!.nombre) : "Mixto",
    titulares,
    historial: txs.map((t) => ({ ...t, usdt: usdtPorTx.get(t.id) ?? new Decimal(0) })),
  };
}
