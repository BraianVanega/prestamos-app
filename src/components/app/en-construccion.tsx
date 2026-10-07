import { Construction } from "lucide-react";

/** Marcador para secciones de fase 1 que todavía no están construidas. */
export function EnConstruccion({ titulo }: { titulo: string }) {
  return (
    <section className="flex flex-col gap-space-lg">
      <h1 className="text-headline-xl text-on-surface">{titulo}</h1>
      <div className="flex items-center gap-space-md rounded-lg border border-outline-variant bg-surface-container-lowest p-margin-panel text-body-lg text-on-surface-variant">
        <Construction className="size-5 shrink-0" aria-hidden />
        Esta sección está en construcción.
      </div>
    </section>
  );
}
