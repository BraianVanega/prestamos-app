import Decimal from "decimal.js";
import type { Asiento } from "./asientos";
import type { Fecha } from "./fechas";
import { moraACargar, type MoraACargar } from "./mora";
import { DECIMALES, redondearUsdt } from "./redondeo";
import { repartir } from "./reparto";

/* ───────────── Deuda del cliente a una fecha ───────────── */

export interface CuotaParaCobro {
  id: string;
  numero: number;
  vencimiento: Fecha;
  arsCapital: Decimal.Value;
  arsInteres: Decimal.Value;
  /** Imputado por pagos no anulados. */
  pagadoCapital: Decimal.Value;
  pagadoInteres: Decimal.Value;
  pagadoCargos: Decimal.Value;
  /** Imputaciones de capital vigentes, con fecha (para decidir la mora). */
  pagosCapital: { fecha: Fecha; ars: Decimal.Value }[];
  /** Neto de cargos no anulados de la cuota (mora +, descuento −, ajuste ±). */
  cargos: Decimal.Value;
  /** Ya tiene cargo de mora (aunque esté anulado). */
  tieneMora: boolean;
}

export interface PrestamoParaCobro {
  id: string;
  numero: number;
  nCuotas: number;
  moraPct: Decimal.Value;
  diasGracia: number;
  cuotas: CuotaParaCobro[];
  /** Cargos sin cuota: neto vigente, lo imputado y la fecha del más viejo. */
  cargosSinCuota: { fecha: Fecha; neto: Decimal.Value; pagado: Decimal.Value } | null;
}

/** Una fila de la cascada: una cuota (o los cargos sueltos) de un préstamo. */
export interface Deuda {
  clave: string;
  prestamoId: string;
  prestamoNumero: number;
  nCuotas: number;
  cuotaId: string | null;
  cuotaNumero: number | null;
  vencimiento: Fecha;
  mora: Decimal;
  interes: Decimal;
  capital: Decimal;
  total: Decimal;
}

export type MoraNueva = MoraACargar & { prestamoId: string; cuotaNumero: number; moraPct: Decimal };

const pos = (d: Decimal) => Decimal.max(d, 0);

/**
 * Lo que el cliente debe a la fecha del pago, cuota por cuota y en orden FIFO
 * (vencimiento más viejo primero, entre todos sus préstamos). Incluye la mora
 * que nace a esa fecha y todavía no está cargada (`moraNueva`, a registrar con el pago).
 */
export function deudasAFecha(prestamos: PrestamoParaCobro[], fecha: Fecha): { deudas: Deuda[]; moraNueva: MoraNueva[] } {
  const deudas: Deuda[] = [];
  const moraNueva: MoraNueva[] = [];

  for (const p of prestamos) {
    const nuevas = moraACargar({
      fecha,
      moraPct: p.moraPct,
      diasGracia: p.diasGracia,
      cuotas: p.cuotas.map((c) => ({
        cuotaId: c.id,
        vencimiento: c.vencimiento,
        arsCapital: c.arsCapital,
        pagosCapital: c.pagosCapital,
        tieneMora: c.tieneMora,
      })),
    });
    const numero = new Map(p.cuotas.map((c) => [c.id, c.numero]));
    for (const m of nuevas) moraNueva.push({ ...m, prestamoId: p.id, cuotaNumero: numero.get(m.cuotaId)!, moraPct: new Decimal(p.moraPct) });
    const moraPorCuota = new Map(nuevas.map((m) => [m.cuotaId, m.ars]));

    for (const c of p.cuotas) {
      const mora = pos(new Decimal(c.cargos).plus(moraPorCuota.get(c.id) ?? 0).minus(c.pagadoCargos));
      const interes = pos(new Decimal(c.arsInteres).minus(c.pagadoInteres));
      const capital = pos(new Decimal(c.arsCapital).minus(c.pagadoCapital));
      const total = mora.plus(interes).plus(capital);
      if (total.isZero()) continue;
      deudas.push({
        clave: `${p.id}:${c.id}`,
        prestamoId: p.id,
        prestamoNumero: p.numero,
        nCuotas: p.nCuotas,
        cuotaId: c.id,
        cuotaNumero: c.numero,
        vencimiento: c.vencimiento,
        mora,
        interes,
        capital,
        total,
      });
    }

    if (p.cargosSinCuota) {
      const mora = pos(new Decimal(p.cargosSinCuota.neto).minus(p.cargosSinCuota.pagado));
      if (!mora.isZero()) {
        deudas.push({
          clave: `${p.id}:cargos`,
          prestamoId: p.id,
          prestamoNumero: p.numero,
          nCuotas: p.nCuotas,
          cuotaId: null,
          cuotaNumero: null,
          vencimiento: p.cargosSinCuota.fecha,
          mora,
          interes: new Decimal(0),
          capital: new Decimal(0),
          total: mora,
        });
      }
    }
  }

  deudas.sort(
    (a, b) =>
      a.vencimiento.localeCompare(b.vencimiento) ||
      a.prestamoNumero - b.prestamoNumero ||
      (a.cuotaNumero ?? 0) - (b.cuotaNumero ?? 0),
  );
  return { deudas, moraNueva };
}

/* ───────────── Imputación ───────────── */

/** Cascada FIFO: llena cada deuda en orden hasta agotar el monto. */
export function distribuirFifo(ars: Decimal.Value, deudas: Deuda[]): Map<string, Decimal> {
  let resto = Decimal.max(new Decimal(ars), 0);
  const montos = new Map<string, Decimal>();
  for (const d of deudas) {
    const m = Decimal.min(resto, d.total);
    montos.set(d.clave, m);
    resto = resto.minus(m);
  }
  return montos;
}

export type Concepto = "capital" | "interes" | "mora" | "saldo_favor";

export interface LineaImputacion {
  prestamoId: string | null;
  cuotaId: string | null;
  concepto: Concepto;
  ars: Decimal;
}

export interface Imputacion {
  lineas: LineaImputacion[];
  /** ARS por préstamo (sin el saldo a favor), en orden de aparición. */
  porPrestamo: { prestamoId: string; ars: Decimal }[];
  saldoFavor: Decimal;
  /** Préstamos que quedan sin deuda con este pago. */
  cancelados: string[];
}

export class ErrorImputacion extends Error {}

/**
 * Imputa el pago según los montos elegidos por deuda: dentro de cada una,
 * mora → interés → capital. Lo que sobra queda como saldo a favor del cliente.
 */
export function imputarPago(arsPago: Decimal.Value, deudas: Deuda[], montos: Map<string, Decimal.Value>): Imputacion {
  const total = new Decimal(arsPago);
  if (total.lte(0)) throw new ErrorImputacion("El pago tiene que ser mayor a 0.");
  const porClave = new Map(deudas.map((d) => [d.clave, d]));
  for (const clave of montos.keys()) {
    if (!porClave.has(clave)) throw new ErrorImputacion("La deuda del cliente cambió: volvé a cargar la pantalla.");
  }

  const lineas: LineaImputacion[] = [];
  const porPrestamo = new Map<string, Decimal>();
  let imputado = new Decimal(0);

  for (const d of deudas) {
    const monto = new Decimal(montos.get(d.clave) ?? 0);
    if (monto.isZero()) continue;
    if (monto.lt(0)) throw new ErrorImputacion("Un monto a imputar es negativo.");
    if (monto.decimalPlaces() > DECIMALES.ars) throw new ErrorImputacion("Los montos van con 2 decimales como máximo.");
    if (monto.gt(d.total)) throw new ErrorImputacion("Un monto a imputar supera lo que se debe en esa cuota.");

    let resto = monto;
    for (const [concepto, pendiente] of [["mora", d.mora], ["interes", d.interes], ["capital", d.capital]] as const) {
      const parte = Decimal.min(resto, pendiente);
      if (parte.gt(0)) lineas.push({ prestamoId: d.prestamoId, cuotaId: d.cuotaId, concepto, ars: parte });
      resto = resto.minus(parte);
    }
    porPrestamo.set(d.prestamoId, (porPrestamo.get(d.prestamoId) ?? new Decimal(0)).plus(monto));
    imputado = imputado.plus(monto);
  }

  if (imputado.gt(total)) throw new ErrorImputacion("Lo imputado supera el monto del pago.");
  const saldoFavor = total.minus(imputado);
  if (saldoFavor.gt(0)) lineas.push({ prestamoId: null, cuotaId: null, concepto: "saldo_favor", ars: saldoFavor });

  const deudaPorPrestamo = new Map<string, Decimal>();
  for (const d of deudas) deudaPorPrestamo.set(d.prestamoId, (deudaPorPrestamo.get(d.prestamoId) ?? new Decimal(0)).plus(d.total));
  const cancelados = [...porPrestamo].filter(([id, ars]) => ars.eq(deudaPorPrestamo.get(id)!)).map(([id]) => id);

  return {
    lineas,
    porPrestamo: [...porPrestamo].map(([prestamoId, ars]) => ({ prestamoId, ars })),
    saldoFavor,
    cancelados,
  };
}

/* ───────────── Asientos ───────────── */

export interface ParticipacionGanancia {
  participanteId: string;
  pctGanancia: Decimal.Value;
}

export interface RecuperoPrestamo {
  prestamoId: string;
  usdt: Decimal;
  /** Parte que baja la cartera (recupera el costo). */
  recupero: Decimal;
  /** Parte que supera el costo: ganancia reconocida. */
  ganancia: Decimal;
}

/**
 * Entrada de USDT a la caja por ARS imputados a préstamos (cobro por
 * transferencia, o conversión de efectivo). Reconocimiento por recuperación de
 * costo: cada préstamo baja su cartera hasta 0 y recién lo que sobra es ganancia,
 * repartida según `pct_ganancia`. El saldo a favor queda como deuda con el cliente.
 * Los USDT se reparten en proporción a los ARS; el redondeo va a la última parte.
 */
export function asientosIngresoUsdt(params: {
  tc: Decimal.Value;
  porPrestamo: { prestamoId: string; ars: Decimal.Value }[];
  saldoFavorArs: Decimal.Value;
  clienteId: string;
  /** Saldo de cartera (USDT) de cada préstamo antes de este ingreso. */
  cartera: Map<string, Decimal.Value>;
  participaciones: Map<string, ParticipacionGanancia[]>;
}): { asientos: Asiento[]; usdtTotal: Decimal; prestamos: RecuperoPrestamo[]; saldoFavorUsdt: Decimal } {
  const tc = new Decimal(params.tc);
  if (tc.lte(0)) throw new Error("El TC tiene que ser mayor a 0");

  const partes = [
    ...params.porPrestamo.map((p) => ({ prestamoId: p.prestamoId as string | null, ars: new Decimal(p.ars) })),
    { prestamoId: null, ars: new Decimal(params.saldoFavorArs) },
  ].filter((p) => p.ars.gt(0));
  if (partes.length === 0) throw new Error("No hay nada que ingresar");

  const arsTotal = partes.reduce((s, p) => s.plus(p.ars), new Decimal(0));
  const usdtTotal = redondearUsdt(arsTotal.div(tc));
  let asignado = new Decimal(0);
  const usdtPartes = partes.map((p, i) => {
    const usdt = i === partes.length - 1 ? usdtTotal.minus(asignado) : redondearUsdt(p.ars.div(tc));
    asignado = asignado.plus(usdt);
    return { ...p, usdt };
  });

  const asientos: Asiento[] = [{ cuenta: "caja_usdt", moneda: "USDT", monto: usdtTotal }];
  const prestamos: RecuperoPrestamo[] = [];
  let saldoFavorUsdt = new Decimal(0);

  for (const p of usdtPartes) {
    if (p.prestamoId === null) {
      saldoFavorUsdt = p.usdt;
      if (p.usdt.gt(0)) asientos.push({ cuenta: "saldo_favor", moneda: "USDT", monto: p.usdt.neg(), clienteId: params.clienteId });
      continue;
    }
    const cartera = pos(new Decimal(params.cartera.get(p.prestamoId) ?? 0));
    const recupero = Decimal.min(p.usdt, cartera);
    const ganancia = p.usdt.minus(recupero);
    if (recupero.gt(0)) asientos.push({ cuenta: "cartera", moneda: "USDT", monto: recupero.neg(), prestamoId: p.prestamoId });
    if (ganancia.gt(0)) {
      const parts = params.participaciones.get(p.prestamoId);
      if (!parts?.length) throw new Error(`El préstamo ${p.prestamoId} no tiene participaciones`);
      const reparto = repartir(
        ganancia,
        parts.map((x) => ({ id: x.participanteId, pct: x.pctGanancia })),
        DECIMALES.usdt,
      );
      for (const r of reparto) {
        if (!r.monto.isZero()) {
          asientos.push({ cuenta: "ganancia", moneda: "USDT", monto: r.monto.neg(), participanteId: r.id, prestamoId: p.prestamoId });
        }
      }
    }
    prestamos.push({ prestamoId: p.prestamoId, usdt: p.usdt, recupero, ganancia });
  }

  return { asientos, usdtTotal, prestamos, saldoFavorUsdt };
}

/**
 * Cobro en efectivo: los billetes entran a la caja de efectivo en ARS y quedan
 * sin realizar (contrapartida en el puente de cambio). La cartera y la ganancia
 * se mueven recién al convertir a USDT.
 */
export function asientosCobroEfectivo(ars: Decimal.Value): Asiento[] {
  const monto = new Decimal(ars);
  if (monto.lte(0)) throw new Error("El pago tiene que ser mayor a 0");
  return [
    { cuenta: "caja_efectivo_ars", moneda: "ARS", monto },
    { cuenta: "puente_cambio", moneda: "ARS", monto: monto.neg() },
  ];
}
