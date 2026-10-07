import type Decimal from "decimal.js";

export type Cuenta =
  | "caja_usdt"
  | "caja_efectivo_ars"
  | "puente_cambio"
  | "cartera"
  | "capital"
  | "ganancia"
  | "saldo_favor"
  | "apertura";

export type Moneda = "USDT" | "ARS";

/** Línea del libro: monto + débito / − crédito. Cada transacción balancea por moneda. */
export interface Asiento {
  cuenta: Cuenta;
  moneda: Moneda;
  monto: Decimal;
  participanteId?: string;
  prestamoId?: string;
  clienteId?: string;
}
