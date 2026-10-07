import { CirclePlus, HandCoins, Search } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function BarraSuperior() {
  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-gutter border-b border-outline-variant bg-surface-container-lowest/85 px-margin backdrop-blur-sm">
      {/* El listado de préstamos lee ?q= para filtrar por cliente, DNI o N°. */}
      <form action="/prestamos" role="search" className="relative max-w-xl flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-space-md size-4 -translate-y-1/2 text-on-surface-variant"
          aria-hidden
        />
        <Input
          name="q"
          type="search"
          placeholder="Buscar por cliente, DNI, préstamo N°…"
          aria-label="Buscar"
          className="h-8 bg-surface-container-low pl-8 text-body-md"
        />
      </form>
      <div className="ml-auto flex items-center gap-gutter-compact">
        <Link href="/prestamos/nuevo" className={cn(buttonVariants({ size: "default" }), "h-8 gap-space-sm")}>
          <CirclePlus aria-hidden />
          Nuevo préstamo
        </Link>
        <Link
          href="/pagos/nuevo"
          className={cn(buttonVariants({ variant: "secondary", size: "default" }), "h-8 gap-space-sm")}
        >
          <HandCoins aria-hidden />
          Registrar pago
        </Link>
      </div>
    </header>
  );
}
