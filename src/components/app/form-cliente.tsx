"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import type { EstadoFormCliente } from "@/app/(app)/clientes/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ESTADOS_CLIENTE, type CamposCliente } from "@/lib/clientes";
import { cn } from "@/lib/utils";

type Accion = (prev: EstadoFormCliente, form: FormData) => Promise<EstadoFormCliente>;

const ITEMS_ESTADO = Object.entries(ESTADOS_CLIENTE).map(([value, label]) => ({ value, label }));

export function FormCliente({
  accion,
  iniciales,
  textoGuardar,
  cancelarHref,
  enfocarNombre = false,
}: {
  accion: Accion;
  iniciales: Partial<Record<CamposCliente, string>>;
  textoGuardar: string;
  cancelarHref: string;
  enfocarNombre?: boolean;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {});
  const valor = (c: CamposCliente) => estado.valores?.[c] ?? iniciales[c] ?? "";
  const error = (c: CamposCliente) => estado.errores?.[c];

  // `key` fuerza a remontar los campos no controlados cuando vuelven valores del servidor.
  const clave = JSON.stringify(estado.valores ?? {});

  return (
    <form action={enviar} key={clave} className="flex flex-col gap-margin-panel" noValidate>
      <fieldset className="grid grid-cols-1 gap-margin md:grid-cols-2" disabled={pendiente}>
        <Campo id="nombre" etiqueta="Nombre o razón social" error={error("nombre")} className="md:col-span-2">
          <Input id="nombre" name="nombre" defaultValue={valor("nombre")} aria-invalid={!!error("nombre")} required autoFocus={enfocarNombre} />
        </Campo>
        <Campo id="documento" etiqueta="DNI / CUIT" error={error("documento")} ayuda="Con o sin puntos y guiones.">
          <Input
            id="documento"
            name="documento"
            defaultValue={valor("documento")}
            aria-invalid={!!error("documento")}
            className="font-mono tabular-nums"
            inputMode="numeric"
          />
        </Campo>
        <Campo id="estado" etiqueta="Estado" error={error("estado")}>
          <Select name="estado" items={ITEMS_ESTADO} defaultValue={valor("estado") || "activo"}>
            <SelectTrigger id="estado" className="w-full" aria-invalid={!!error("estado")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ITEMS_ESTADO.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo id="telefono" etiqueta="Teléfono" error={error("telefono")}>
          <Input id="telefono" name="telefono" type="tel" defaultValue={valor("telefono")} className="font-mono tabular-nums" />
        </Campo>
        <Campo id="email" etiqueta="Mail" error={error("email")}>
          <Input id="email" name="email" type="email" defaultValue={valor("email")} aria-invalid={!!error("email")} />
        </Campo>
        <Campo id="direccion" etiqueta="Dirección" error={error("direccion")}>
          <Input id="direccion" name="direccion" defaultValue={valor("direccion")} />
        </Campo>
        <Campo id="actividad" etiqueta="Actividad" error={error("actividad")}>
          <Input id="actividad" name="actividad" defaultValue={valor("actividad")} />
        </Campo>
        <Campo id="referencias" etiqueta="Referencias" error={error("referencias")} className="md:col-span-2">
          <Textarea id="referencias" name="referencias" defaultValue={valor("referencias")} rows={2} />
        </Campo>
        <Campo id="notas" etiqueta="Notas" error={error("notas")} className="md:col-span-2">
          <Textarea id="notas" name="notas" defaultValue={valor("notas")} rows={3} />
        </Campo>
      </fieldset>

      {estado.error && (
        <p role="alert" className="rounded-lg border border-riesgo-rojo-borde bg-riesgo-rojo-bg px-space-md py-space-sm text-body-md text-riesgo-rojo-fg">
          {estado.error}
        </p>
      )}

      <div className="flex justify-end gap-gutter-compact">
        <Link href={cancelarHref} className={buttonVariants({ variant: "outline" })}>
          Cancelar
        </Link>
        <Button type="submit" disabled={pendiente}>
          {pendiente ? "Guardando…" : textoGuardar}
        </Button>
      </div>
    </form>
  );
}

function Campo({
  id,
  etiqueta,
  error,
  ayuda,
  className,
  children,
}: {
  id: string;
  etiqueta: string;
  error?: string;
  ayuda?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-space-xs", className)}>
      <Label htmlFor={id}>{etiqueta}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-body-sm text-error">
          {error}
        </p>
      ) : (
        ayuda && <p className="text-body-sm text-on-surface-variant">{ayuda}</p>
      )}
    </div>
  );
}
