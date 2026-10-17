import Link from "next/link";
import { cn } from "@/lib/utils";

export interface Pestana {
  etiqueta: string;
  cantidad: number;
  href: string;
  activa: boolean;
}

/** Filtros con conteo (DESIGN.md › Listado): el activo relleno, el resto con borde. */
export function Pestanas({ items, etiqueta }: { items: Pestana[]; etiqueta: string }) {
  return (
    <nav aria-label={etiqueta} className="flex flex-wrap gap-space-sm">
      {items.map((p) => (
        <Link
          key={p.etiqueta}
          href={p.href}
          aria-current={p.activa ? "page" : undefined}
          className={cn(
            "rounded-lg border px-space-md py-space-sm text-body-sm transition-colors",
            p.activa
              ? "border-primary bg-primary text-primary-foreground"
              : "border-input bg-card text-foreground hover:bg-muted",
          )}
        >
          {p.etiqueta} <span className="font-mono tabular-nums">{p.cantidad}</span>
        </Link>
      ))}
    </nav>
  );
}
