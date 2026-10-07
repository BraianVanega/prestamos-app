import { CirclePlus, HandCoins, Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function BarraSuperior({ menu }: { menu: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-gutter border-b border-outline-variant bg-surface-container-lowest/85 px-margin backdrop-blur-sm max-sm:gap-space-sm">
      {menu}
      {/* El listado de préstamos lee ?q= para filtrar por cliente, DNI o N°. */}
      <form action="/prestamos" role="search" className="relative min-w-0 max-w-xl flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-space-md size-4 -translate-y-1/2 text-on-surface-variant"
          aria-hidden
        />
        <Input
          name="q"
          type="search"
          placeholder="Buscar cliente, DNI, N°…"
          aria-label="Buscar"
          className="h-8 bg-surface-container-low pl-8 text-body-md"
        />
      </form>
      <div className="ml-auto flex items-center gap-gutter-compact">
        <Link
          href="/prestamos/nuevo"
          aria-label="Nuevo préstamo"
          className={cn(buttonVariants({ size: "default" }), "h-8 gap-space-sm max-md:w-8 max-md:px-0")}
        >
          <CirclePlus aria-hidden />
          <span className="max-md:hidden">Nuevo préstamo</span>
        </Link>
        <Link
          href="/pagos/nuevo"
          aria-label="Registrar pago"
          className={cn(buttonVariants({ variant: "secondary", size: "default" }), "h-8 gap-space-sm max-md:w-8 max-md:px-0")}
        >
          <HandCoins aria-hidden />
          <span className="max-md:hidden">Registrar pago</span>
        </Link>
      </div>
    </header>
  );
}
