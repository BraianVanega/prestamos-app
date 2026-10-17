import { salir } from "@/app/login/actions";
import { NavLateral } from "@/components/app/nav-lateral";
import type { Usuario } from "@/lib/auth";

/** Marca, secciones y usuario: lo mismo en la barra fija y en el menú móvil. */
export function ContenidoLateral({ usuario }: { usuario: Pick<Usuario, "nombre" | "email"> }) {
  return (
    <div className="flex h-full flex-col py-margin">
      <div className="flex flex-col gap-space-2xs px-margin pb-margin">
        <span className="text-headline-sm text-foreground">Cierre &amp; Reparto</span>
        <span className="text-label text-muted-foreground">Préstamos en pesos, cuentas en USDT</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <NavLateral />
      </div>

      <div className="mx-space-md flex items-end justify-between gap-space-sm border-t border-border px-space-md pt-space-lg">
        <div className="min-w-0">
          <p className="truncate text-body-sm font-medium text-foreground">{usuario.nombre}</p>
          <p className="truncate text-label text-muted-foreground">{usuario.email}</p>
        </div>
        <form action={salir}>
          <button type="submit" className="text-label text-link hover:underline">
            Salir
          </button>
        </form>
      </div>
    </div>
  );
}
