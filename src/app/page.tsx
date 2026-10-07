import { Button } from "@/components/ui/button";
import { usuarioActual } from "@/lib/auth";
import { salir } from "./login/actions";

export default async function Home() {
  const usuario = await usuarioActual();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-space-lg p-margin">
      <h1 className="text-headline-xl">Cierre &amp; Reparto</h1>
      <p className="text-body-lg text-on-surface-variant">Hola, {usuario.nombre}.</p>
      <form action={salir}>
        <Button type="submit" variant="outline">
          Salir
        </Button>
      </form>
    </main>
  );
}
