import { LogOut } from "lucide-react";
import { BarraSuperior } from "@/components/app/barra-superior";
import { NavLateral } from "@/components/app/nav-lateral";
import { Button } from "@/components/ui/button";
import { usuarioActual } from "@/lib/auth";
import { salir } from "../login/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const usuario = await usuarioActual();

  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-outline-variant bg-surface-container-lowest">
        <div className="flex h-12 flex-col justify-center border-b border-outline-variant px-margin">
          <span className="text-headline-sm text-on-surface">Cierre &amp; Reparto</span>
          <span className="text-label-caps text-on-surface-variant uppercase">Admin financiero (ARS / USDT)</span>
        </div>

        <div className="flex-1 overflow-y-auto py-gutter">
          <NavLateral />
        </div>

        <div className="flex items-center gap-space-sm border-t border-outline-variant px-margin py-gutter">
          <span className="size-2 shrink-0 rounded-full bg-tertiary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-md text-on-surface">{usuario.nombre}</p>
            <p className="truncate text-body-sm text-on-surface-variant">{usuario.email}</p>
          </div>
          <form action={salir}>
            <Button type="submit" variant="ghost" size="icon-sm" aria-label="Salir" title="Salir">
              <LogOut aria-hidden />
            </Button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <BarraSuperior />
        <main className="flex-1 p-margin">{children}</main>
      </div>
    </div>
  );
}
