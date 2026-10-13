import Decimal from "decimal.js";
import type { CuotaEstado, NivelRiesgo } from "./estado-prestamo";
import { diasEntre, sumarMeses, type Fecha } from "./fechas";
import { abrirSociedad, type Parte } from "./reparto";

/** Los últimos `n` meses ("AAAA-MM") hasta el de `hoy` inclusive, del más viejo al actual. */
export function ultimosMeses(hoy: Fecha, n: number): string[] {
  const primero = `${hoy.slice(0, 7)}-01`;
  return Array.from({ length: n }, (_, i) => sumarMeses(primero, i - n + 1).slice(0, 7));
}

export interface PrestamoParaAgenda {
  id: string;
  estado: string;
  cuotas: CuotaEstado[];
}

export interface Vencimiento {
  prestamoId: string;
  cuota: CuotaEstado;
  /** 0 = hoy, 1 = mañana…; negativo si ya venció. */
  enDias: number;
}

/** Cuotas impagas de préstamos vigentes, la más vieja primero. */
function cuotasImpagas(prestamos: PrestamoParaAgenda[], hoy: Fecha): Vencimiento[] {
  return prestamos
    .filter((p) => p.estado === "vigente")
    .flatMap((p) => p.cuotas.filter((c) => !c.pagada).map((c) => ({ prestamoId: p.id, cuota: c, enDias: diasEntre(hoy, c.vencimiento) })))
    .sort((a, b) => a.enDias - b.enDias || a.cuota.numero - b.cuota.numero);
}

export type GrupoAgenda = "vencidas" | "hoy" | "manana" | "semana" | "despues";

export interface BloqueAgenda {
  grupo: GrupoAgenda;
  items: Vencimiento[];
  /** Lo que falta cobrar del bloque (ARS, sin mora). */
  total: Decimal;
}

const grupoDe = (enDias: number): GrupoAgenda =>
  enDias < 0 ? "vencidas" : enDias === 0 ? "hoy" : enDias === 1 ? "manana" : enDias <= 7 ? "semana" : "despues";

/**
 * Agenda de cobros: todas las cuotas vencidas impagas más las que vencen
 * entre hoy y hoy + `dias`, en bloques (vencidas, hoy, mañana, esta semana,
 * más adelante) con su total. Los bloques vacíos no aparecen.
 */
export function agendaCobros(prestamos: PrestamoParaAgenda[], hoy: Fecha, dias: number): BloqueAgenda[] {
  const orden: GrupoAgenda[] = ["vencidas", "hoy", "manana", "semana", "despues"];
  const items = cuotasImpagas(prestamos, hoy).filter((v) => v.enDias <= dias);
  return orden
    .map((grupo) => {
      const delGrupo = items.filter((v) => grupoDe(v.enDias) === grupo);
      return { grupo, items: delGrupo, total: delGrupo.reduce((s, v) => s.plus(v.cuota.saldo), new Decimal(0)) };
    })
    .filter((b) => b.items.length > 0);
}

const ORDEN_RIESGO: Record<NivelRiesgo, number> = { negro: 0, rojo: 1, naranja: 2, amarillo: 3, verde: 4 };

export interface PrestamoEnAtraso {
  id: string;
  riesgo: NivelRiesgo;
  diasAtraso: number;
  /** Capital + interés de las cuotas vencidas (ARS). */
  vencidoArs: Decimal;
  cuotasVencidas: number;
}

/** Préstamos vigentes con atraso, del más grave al más leve (riesgo, después días). */
export function rankingAtraso(
  prestamos: (PrestamoParaAgenda & { riesgo: NivelRiesgo; diasAtraso: number })[],
): PrestamoEnAtraso[] {
  return prestamos
    .filter((p) => p.estado === "vigente" && p.diasAtraso > 0)
    .map((p) => {
      const vencidas = p.cuotas.filter((c) => c.situacion === "vencida");
      return {
        id: p.id,
        riesgo: p.riesgo,
        diasAtraso: p.diasAtraso,
        vencidoArs: vencidas.reduce((s, c) => s.plus(c.saldo), new Decimal(0)),
        cuotasVencidas: vencidas.length,
      };
    })
    .sort((a, b) => ORDEN_RIESGO[a.riesgo] - ORDEN_RIESGO[b.riesgo] || b.diasAtraso - a.diasAtraso);
}

export interface MovimientoGanancia {
  /** Fecha de la transacción. */
  fecha: Fecha;
  participanteId: string;
  esSociedad: boolean;
  /** Asiento de la cuenta ganancia (+ débito / − crédito). */
  monto: Decimal.Value;
}

/**
 * Ganancia realizada por mes y socio (USDT, positiva), con la parte de la
 * Sociedad abierta por % de cada socio. Las anulaciones restan en su mes.
 */
export function gananciaPorMes(
  movimientos: MovimientoGanancia[],
  meses: string[],
  socios: Parte[],
  decimales: number,
): { mes: string; porSocio: { id: string; monto: Decimal }[]; total: Decimal }[] {
  return meses.map((mes) => {
    const delMes = movimientos.filter((m) => m.fecha.startsWith(mes));
    const porSocio = abrirSociedad(
      delMes.map((m) => ({ participanteId: m.participanteId, esSociedad: m.esSociedad, monto: new Decimal(m.monto).neg() })),
      socios,
      decimales,
    ).filter((x) => socios.some((s) => s.id === x.id));
    return { mes, porSocio, total: porSocio.reduce((s, x) => s.plus(x.monto), new Decimal(0)) };
  });
}
