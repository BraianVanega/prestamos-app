"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** Barra lateral como panel deslizable en pantallas chicas; se cierra al navegar. */
export function MenuMovil({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);
  const [ruta, setRuta] = useState(pathname);
  if (ruta !== pathname) {
    setRuta(pathname);
    setAbierto(false);
  }

  return (
    <Sheet open={abierto} onOpenChange={setAbierto}>
      <SheetTrigger render={<Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Abrir menú" />}>
        <Menu aria-hidden />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 bg-surface-container-lowest p-0">
        <SheetTitle className="sr-only">Menú</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
