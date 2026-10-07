import Decimal from "decimal.js";
import type { NivelRiesgo } from "@/engine/estado-prestamo";
import { cn } from "@/lib/utils";

/** Clases de DESIGN.md (Risk Badges) por nivel. */
export const COLORES_RIESGO: Record<NivelRiesgo, { badge: string; texto: string; barra: string }> = {
  verde: {
    badge: "border-riesgo-verde-borde bg-riesgo-verde-bg text-riesgo-verde-fg",
    texto: "text-tertiary",
    barra: "bg-tertiary",
  },
  amarillo: {
    badge: "border-riesgo-amarillo-borde bg-riesgo-amarillo-bg text-riesgo-amarillo-fg",
    texto: "text-riesgo-amarillo-fg",
    barra: "bg-riesgo-amarillo-fg",
  },
  naranja: {
    badge: "border-riesgo-naranja-borde bg-riesgo-naranja-bg text-riesgo-naranja-fg",
    texto: "text-riesgo-naranja-fg",
    barra: "bg-riesgo-naranja-fg",
  },
  rojo: {
    badge: "border-riesgo-rojo-borde bg-riesgo-rojo-bg text-riesgo-rojo-fg",
    texto: "text-riesgo-rojo-fg",
    barra: "bg-riesgo-rojo-fg",
  },
  negro: {
    badge: "border-riesgo-negro-borde bg-riesgo-negro-bg text-riesgo-negro-fg ring-1 ring-inset ring-riesgo-negro-anillo",
    texto: "text-on-surface",
    barra: "bg-riesgo-negro-bg",
  },
};

export function BadgeRiesgo({ nivel, children }: { nivel: NivelRiesgo; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-space-sm py-space-2xs font-mono text-badge-label uppercase",
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
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container" aria-hidden>
      <div className={cn("h-full rounded-full", COLORES_RIESGO[nivel].barra)} style={{ width: `${ancho}%` }} />
    </div>
  );
}
