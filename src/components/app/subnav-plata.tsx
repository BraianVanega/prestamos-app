"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const PESTANAS = [
  { href: "/socios", etiqueta: "Caja y socios" },
  { href: "/efectivo", etiqueta: "Efectivo" },
  { href: "/terceros", etiqueta: "Terceros" },
] as const;

/** Pestañas de la sección Plata: caja y socios, efectivo y terceros. */
export function SubnavPlata() {
  const pathname = usePathname();

  return (
    <nav aria-label="Plata" className="flex gap-space-xs self-start rounded-lg bg-muted p-space-xs">
      {PESTANAS.map(({ href, etiqueta }) => {
        const activa = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={activa ? "page" : undefined}
            className={cn(
              "rounded-lg px-space-md py-space-xs text-body-md transition-colors",
              activa ? "bg-card font-medium text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}
