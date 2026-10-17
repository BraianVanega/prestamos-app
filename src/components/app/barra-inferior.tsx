"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ACCIONES_NUEVO, SECCIONES, SECCIONES_MOVIL, seccionActiva } from "@/components/app/secciones";
import { buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const MOVIL = SECCIONES.filter((s) => SECCIONES_MOVIL.includes(s.clave));

/** Barra inferior del celular: 4 secciones y "+" central (registrar cobro y altas). */
export function BarraInferior() {
  const pathname = usePathname();
  const activa = seccionActiva(pathname);
  const [abierto, setAbierto] = useState(false);
  const [ruta, setRuta] = useState(pathname);
  if (ruta !== pathname) {
    setRuta(pathname);
    setAbierto(false);
  }

  const item = (s: (typeof MOVIL)[number]) => {
    const on = s.clave === activa;
    return (
      <Link
        key={s.clave}
        href={s.href}
        aria-current={on ? "page" : undefined}
        className={cn(
          "flex flex-col items-center gap-space-sm pt-space-sm text-label",
          on ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        <span className={cn("h-0.75 w-5.5 rounded-full", on ? "bg-primary" : "bg-transparent")} aria-hidden />
        {s.etiqueta}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-20 grid h-[calc(4.5rem+env(safe-area-inset-bottom))] grid-cols-5 items-start border-t border-border bg-card px-space-xs pt-space-xs pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {MOVIL.slice(0, 2).map(item)}
      <div className="flex justify-center">
        <Sheet open={abierto} onOpenChange={setAbierto}>
          <SheetTrigger
            aria-label="Registrar o crear"
            className="-mt-4 flex size-13 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
          >
            <Plus className="size-6" aria-hidden />
          </SheetTrigger>
          <SheetContent side="bottom" className="gap-space-sm rounded-t-2xl bg-card px-margin pt-space-xl pb-[calc(var(--spacing-margin)+env(safe-area-inset-bottom))]">
            <SheetTitle className="text-headline-sm">¿Qué querés registrar?</SheetTitle>
            <Link href="/pagos/nuevo" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
              Registrar cobro
            </Link>
            {ACCIONES_NUEVO.map((a) => (
              <Link key={a.etiqueta} href={a.href} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full")}>
                {a.etiqueta}
              </Link>
            ))}
          </SheetContent>
        </Sheet>
      </div>
      {MOVIL.slice(2).map(item)}
    </nav>
  );
}
