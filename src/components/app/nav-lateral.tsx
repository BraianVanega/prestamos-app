"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECCIONES, seccionActiva } from "@/components/app/secciones";
import { cn } from "@/lib/utils";

export function NavLateral() {
  const activa = seccionActiva(usePathname());

  return (
    <nav aria-label="Secciones" className="flex flex-col gap-space-xs px-space-md">
      {SECCIONES.map(({ clave, href, etiqueta }) => (
        <Link
          key={clave}
          href={href}
          aria-current={clave === activa ? "page" : undefined}
          className={cn(
            "flex h-10 items-center rounded-lg px-space-md text-body-md transition-colors",
            clave === activa
              ? "bg-muted font-semibold text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {etiqueta}
        </Link>
      ))}
    </nav>
  );
}
