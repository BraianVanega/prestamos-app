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
  /** 0 = hoy, 1 = mañana… */
  enDias: number;
}

/** Cuotas impagas de préstamos vigentes que vencen entre hoy y hoy + `dias`, la más próxima primero. */
export function vencimientosProximos(prestamos: PrestamoParaAgenda[], hoy: Fecha, dias: number): Vencimiento[] {
  return prestamos
    .filter((p) => p.estado === "vigente")
    .flatMap((p) =>
      p.cuotas
        .filter((c) => !c.pagada)
        .map((c) => ({ prestamoId: p.id, cuota: c, enDias: diasEntre(hoy, c.vencimiento) }))
        .filter((v) => v.enDias >= 0 && v.enDias <= dias),
    )
    .sort((a, b) => a.enDias - b.enDias || a.cuota.numero - b.cuota.numero);
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
