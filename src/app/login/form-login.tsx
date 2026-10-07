"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ingresar, type EstadoLogin } from "./actions";

export function FormLogin({ errorInicial }: { errorInicial?: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoLogin, FormData>(ingresar, {
    error: errorInicial,
  });

  return (
    <form action={accion} className="flex flex-col gap-space-lg">
      <div className="flex flex-col gap-space-xs">
        <Label htmlFor="email">Mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={estado.email}
          required
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-space-xs">
        <Label htmlFor="password">Contraseña</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {estado.error && (
        <p role="alert" className="rounded-lg border border-riesgo-rojo-borde bg-riesgo-rojo-bg px-space-md py-space-sm text-body-md text-riesgo-rojo-fg">
          {estado.error}
        </p>
      )}
      <Button type="submit" disabled={pendiente}>
        {pendiente ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}
