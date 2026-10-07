import Decimal from "decimal.js";
import type { Asiento } from "./asientos";
import { redondearUsdt } from "./redondeo";

/**
 * Desembolso: sale USDT de la caja y entra a cartera al costo (usdt_prestado).
 * El capital por participante no se mueve: el préstamo sigue siendo de quien
 * puso la plata, según `prestamo_participaciones`.
 */
export function asientosDesembolso(prestamoId: string, usdtPrestado: Decimal.Value): Asiento[] {
  const usdt = redondearUsdt(usdtPrestado);
  if (usdt.lte(0)) throw new Error("El desembolso debe ser mayor a 0");
  return [
    { cuenta: "cartera", moneda: "USDT", monto: usdt, prestamoId },
    { cuenta: "caja_usdt", moneda: "USDT", monto: usdt.neg() },
  ];
}

export interface Participacion {
  participanteId: string;
  pctCapital: Decimal;
  pctGanancia: Decimal;
}

/** Caso A de la spec (fase 1): capital y ganancia 100% de la Sociedad. */
export function participacionSociedad(sociedadId: string): Participacion[] {
  return [{ participanteId: sociedadId, pctCapital: new Decimal(100), pctGanancia: new Decimal(100) }];
}
