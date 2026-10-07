"use client";

import { Ban, Banknote, Contact, Landmark, LayoutDashboard, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SECCIONES = [
  { href: "/", etiqueta: "Overview", icono: LayoutDashboard },
  { href: "/prestamos", etiqueta: "Préstamos", icono: Landmark },
  { href: "/clientes", etiqueta: "Clientes", icono: Contact },
  { href: "/pagos", etiqueta: "Pagos", icono: Banknote },
  { href: "/efectivo", etiqueta: "Efectivo", icono: Wallet },
  { href: "/socios", etiqueta: "Socios", icono: Users },
  { href: "/anulaciones", etiqueta: "Anulaciones", icono: Ban },
] as const;

const estaActiva = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

export function NavLateral() {
  const pathname = usePathname();

  return (
    <nav aria-label="Secciones" className="flex flex-col gap-space-2xs px-gutter-compact">
      {SECCIONES.map(({ href, etiqueta, icono: Icono }) => {
        const activa = estaActiva(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={activa ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-space-md rounded-lg px-space-md text-body-lg transition-colors",
              activa
                ? "bg-primary-container font-semibold text-on-primary"
                : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
            )}
          >
            <Icono className="size-4 shrink-0" aria-hidden />
            {etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}
