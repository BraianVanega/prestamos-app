import { ChevronDown, Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ACCIONES_NUEVO } from "@/components/app/secciones";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Escritorio: buscador, menú "Nuevo" y "Registrar cobro" siempre visibles.
 * Celular: marca, buscador y menú; las acciones van al "+" de la barra inferior.
 */
export function BarraSuperior({ menu }: { menu: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-space-md border-b border-border bg-card/90 px-margin backdrop-blur-sm lg:h-16 lg:px-page">
      {menu}
      <span className="text-headline-sm text-foreground lg:hidden max-sm:hidden">Cierre &amp; Reparto</span>
      {/* El listado de préstamos lee ?q= para filtrar por cliente, DNI o N°. */}
      <form action="/prestamos" role="search" className="relative min-w-0 flex-1 lg:max-w-sm">
        <Search
          className="pointer-events-none absolute top-1/2 left-space-md size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input name="q" type="search" placeholder="Buscá cliente, DNI o N° de préstamo" aria-label="Buscar" className="pl-9" />
      </form>
      <div className="ml-auto hidden items-center gap-space-sm lg:flex">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>
            Nuevo
            <ChevronDown data-icon="inline-end" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {ACCIONES_NUEVO.map((a) => (
              <DropdownMenuItem key={a.href + a.etiqueta} render={<Link href={a.href} />} className="h-9 px-space-md">
                {a.etiqueta}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Link href="/pagos/nuevo" className={cn(buttonVariants())}>
          Registrar cobro
        </Link>
      </div>
    </header>
  );
}
