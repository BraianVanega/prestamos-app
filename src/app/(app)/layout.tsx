import { BarraSuperior } from "@/components/app/barra-superior";
import { ContenidoLateral } from "@/components/app/contenido-lateral";
import { MenuMovil } from "@/components/app/menu-movil";
import { usuarioActual } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const usuario = await usuarioActual();
  const lateral = <ContenidoLateral usuario={usuario} />;

  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-outline-variant bg-surface-container-lowest lg:block">
        {lateral}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <BarraSuperior menu={<MenuMovil>{lateral}</MenuMovil>} />
        <main className="min-w-0 flex-1 p-margin">{children}</main>
      </div>
    </div>
  );
}
