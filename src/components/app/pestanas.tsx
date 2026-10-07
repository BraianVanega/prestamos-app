import Link from "next/link";
import { cn } from "@/lib/utils";

export interface Pestana {
  etiqueta: string;
  cantidad: number;
  href: string;
  activa: boolean;
}

/** Pestañas de filtro tipo "pill" con conteo, como en design/listado.png. */
export function Pestanas({ items, etiqueta }: { items: Pestana[]; etiqueta: string }) {
  return (
    <nav aria-label={etiqueta} className="flex flex-wrap gap-space-xs">
      {items.map((p) => (
        <Link
          key={p.etiqueta}
          href={p.href}
          aria-current={p.activa ? "page" : undefined}
          className={cn(
            "rounded-full px-space-md py-space-xs text-body-md font-medium transition-colors",
            p.activa ? "bg-primary-container text-on-primary" : "bg-surface-container-low text-on-surface hover:bg-surface-container",
          )}
        >
          {p.etiqueta} <span className="font-mono tabular-nums">({p.cantidad})</span>
        </Link>
      ))}
    </nav>
  );
}
