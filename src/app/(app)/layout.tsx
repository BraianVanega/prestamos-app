import { BarraInferior } from "@/components/app/barra-inferior";
import { BarraSuperior } from "@/components/app/barra-superior";
import { ContenidoLateral } from "@/components/app/contenido-lateral";
import { MenuMovil } from "@/components/app/menu-movil";
import { usuarioActual } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const usuario = await usuarioActual();
  const lateral = <ContenidoLateral usuario={usuario} />;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-58 shrink-0 border-r border-border bg-card lg:block">
        {lateral}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <BarraSuperior menu={<MenuMovil>{lateral}</MenuMovil>} />
        <main className="min-w-0 flex-1 p-margin pb-[calc(6rem+env(safe-area-inset-bottom))] lg:p-page">{children}</main>
      </div>

      <BarraInferior />
    </div>
  );
}
