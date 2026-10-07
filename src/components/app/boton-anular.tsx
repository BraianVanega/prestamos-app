"use client";

import { Ban } from "lucide-react";
import { useActionState, useState } from "react";
import { anularRegistro } from "@/app/(app)/anulaciones/actions";
import { Alerta, Campo } from "@/components/app/campos";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { EntidadAnulable } from "@/lib/anulaciones";

/**
 * Botón "Anular" con diálogo de confirmación y motivo obligatorio. Lo anulado
 * queda a la vista tachado; la anulación revierte sus asientos.
 */
export function BotonAnular({
  entidad,
  id,
  titulo,
  detalle,
  aviso,
}: {
  entidad: EntidadAnulable;
  id: string;
  /** "el pago", "la conversión"… */
  titulo: string;
  /** Qué se anula, en una línea (monto, fecha, cliente). */
  detalle: string;
  /** Consecuencias a tener en cuenta. */
  aviso?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [estado, enviar, pendiente] = useActionState(anularRegistro, {});
  const [visto, setVisto] = useState(estado);
  if (estado !== visto) {
    setVisto(estado);
    if (estado.ok) setAbierto(false);
  }
  const error = estado.ok ? undefined : estado;

  return (
    <AlertDialog open={abierto} onOpenChange={setAbierto}>
      <AlertDialogTrigger render={<Button variant="ghost" size="xs" className="gap-space-xs text-error hover:text-error" />}>
        <Ban aria-hidden />
        Anular
      </AlertDialogTrigger>
      <AlertDialogContent className="rounded-lg sm:max-w-md">
        <form action={enviar} className="flex flex-col gap-margin" noValidate>
          <AlertDialogHeader>
            <AlertDialogTitle>Anular {titulo}</AlertDialogTitle>
            <AlertDialogDescription render={<div />} className="flex flex-col gap-space-xs">
              <span className="text-body-md text-on-surface">{detalle}</span>
              <span className="text-body-sm text-on-surface-variant">
                No se borra: queda registrada la anulación con su motivo y se revierten sus movimientos.
                {aviso && ` ${aviso}`}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error?.error && <Alerta>{error.error}</Alerta>}
          <input type="hidden" name="entidad" value={entidad} />
          <input type="hidden" name="id" value={id} />
          <Campo id={`motivo-${id}`} etiqueta="Motivo" error={error?.errores?.motivo}>
            <Textarea
              id={`motivo-${id}`}
              name="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={200}
              rows={2}
              required
              disabled={pendiente}
              aria-invalid={!!error?.errores?.motivo}
            />
          </Campo>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendiente}>Volver</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={pendiente}>
              {pendiente ? "Anulando…" : "Confirmar anulación"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
