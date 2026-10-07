import { Badge } from "@/components/ui/badge";
import { ESTADOS_CLIENTE, type EstadoCliente } from "@/lib/clientes";
import { cn } from "@/lib/utils";

const ESTILOS: Record<EstadoCliente, string> = {
  activo: "border-riesgo-verde-borde bg-riesgo-verde-bg text-riesgo-verde-fg",
  bloqueado: "border-riesgo-rojo-borde bg-riesgo-rojo-bg text-riesgo-rojo-fg",
  inactivo: "border-outline-variant bg-surface-container-low text-on-surface-variant",
};

export function BadgeEstadoCliente({ estado }: { estado: EstadoCliente }) {
  return (
    <Badge variant="outline" className={cn("rounded-full font-mono text-badge-label uppercase", ESTILOS[estado])}>
      {ESTADOS_CLIENTE[estado]}
    </Badge>
  );
}
