import type { Fecha } from "@/engine/fechas";

/** Fecha de hoy en Argentina como `YYYY-MM-DD` (el servidor puede correr en UTC). */
export function hoyArgentina(ahora: Date = new Date()): Fecha {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}
