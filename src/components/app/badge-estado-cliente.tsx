import { Badge } from "@/components/ui/badge";
import { ESTADOS_CLIENTE, type EstadoCliente } from "@/lib/clientes";
import { cn } from "@/lib/utils";

const ESTILOS: Record<EstadoCliente, string> = {
  activo: "border-success/25 bg-success-soft text-success",
  bloqueado: "border-danger/25 bg-danger-soft text-danger",
  inactivo: "border-border bg-muted text-muted-foreground",
};

export function BadgeEstadoCliente({ estado }: { estado: EstadoCliente }) {
  return (
    <Badge variant="outline" className={cn("rounded-full font-mono text-badge-label", ESTILOS[estado])}>
      {ESTADOS_CLIENTE[estado]}
    </Badge>
  );
}
