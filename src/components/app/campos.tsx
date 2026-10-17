import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Piezas comunes de los formularios (DESIGN.md: paneles, campos con error, números es-AR). */

export function Panel({
  icono,
  titulo,
  nota,
  accion,
  children,
}: {
  icono: ReactNode;
  titulo: string;
  nota?: string;
  accion?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-margin rounded-lg border border-border bg-card p-margin-panel">
      <div className="flex items-center gap-space-sm">
        <span className="text-link [&_svg]:size-4">{icono}</span>
        <h2 className="text-label text-foreground">{titulo}</h2>
        {nota && <span className="ml-auto text-body-sm text-muted-foreground">{nota}</span>}
        {accion && <span className="ml-auto">{accion}</span>}
      </div>
      {children}
    </section>
  );
}

export function Campo({
  id,
  etiqueta,
  error,
  ayuda,
  children,
}: {
  id: string;
  etiqueta: string;
  error?: string;
  ayuda?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-space-xs">
      <Label htmlFor={id}>{etiqueta}</Label>
      {children}
      {error ? (
        <p className="text-body-sm text-danger">{error}</p>
      ) : (
        ayuda && <p className="text-body-sm text-muted-foreground">{ayuda}</p>
      )}
    </div>
  );
}

export function EntradaNumero({
  id,
  valor,
  onChange,
  prefijo,
  sufijo,
  error,
  entero,
  sinNombre,
  className,
}: {
  id: string;
  valor: string;
  onChange: (v: string) => void;
  prefijo?: string;
  sufijo?: string;
  error?: boolean;
  entero?: boolean;
  sinNombre?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      {prefijo && (
        <span className="pointer-events-none absolute top-1/2 left-space-md -translate-y-1/2 font-mono text-body-md text-muted-foreground">
          {prefijo}
        </span>
      )}
      <Input
        id={id}
        name={sinNombre ? undefined : id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        inputMode={entero ? "numeric" : "decimal"}
        autoComplete="off"
        aria-invalid={error}
        className={cn("font-mono tabular-nums", prefijo && "pl-6", sufijo && "pr-14")}
      />
      {sufijo && (
        <span className="pointer-events-none absolute top-1/2 right-space-md -translate-y-1/2 text-body-sm text-muted-foreground">
          {sufijo}
        </span>
      )}
    </div>
  );
}

export function Alerta({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg border border-danger/25 bg-danger-soft px-space-md py-space-sm text-body-md text-danger">
      {children}
    </p>
  );
}
