import Decimal from "decimal.js";
import type { NivelRiesgo } from "@/engine/estado-prestamo";
import { cn } from "@/lib/utils";

/** Clases del semáforo de DESIGN.md (risk-1…5) por nivel. */
export const COLORES_RIESGO: Record<NivelRiesgo, { badge: string; texto: string; barra: string }> = {
  verde: { badge: "bg-risk-1 text-risk-1-foreground", texto: "text-success", barra: "bg-risk-1" },
  amarillo: { badge: "bg-risk-2 text-risk-2-foreground", texto: "text-warning", barra: "bg-risk-2" },
  naranja: { badge: "bg-risk-3 text-risk-3-foreground", texto: "text-warning", barra: "bg-risk-3" },
  rojo: { badge: "bg-risk-4 text-risk-4-foreground", texto: "text-danger", barra: "bg-risk-4" },
  negro: { badge: "bg-risk-5 text-risk-5-foreground", texto: "text-foreground", barra: "bg-risk-5" },
};

export function BadgeRiesgo({ nivel, children }: { nivel: NivelRiesgo; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-space-md py-space-2xs font-mono text-badge-label tabular-nums",
        COLORES_RIESGO[nivel].badge,
      )}
    >
      {children}
    </span>
  );
}

/** Barra de progreso con el color del nivel de riesgo. `pct` llega acotado a 0–100 (Decimal → string). */
export function BarraProgreso({ pct, nivel }: { pct: Decimal; nivel: NivelRiesgo }) {
  const ancho = Decimal.min(Decimal.max(pct, 0), 100).toDecimalPlaces(2).toString();
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className={cn("h-full rounded-full", COLORES_RIESGO[nivel].barra)} style={{ width: `${ancho}%` }} />
    </div>
  );
}
