"use client";

import { Send } from "lucide-react";
import { useActionState, useState } from "react";
import type { EstadoFormPagoTercero } from "@/app/(app)/terceros/actions";
import { Alerta, Campo, EntradaNumero, Panel } from "@/components/app/campos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Fecha } from "@/engine/fechas";
import type { CamposPagoTercero } from "@/lib/terceros";

type Accion = (prev: EstadoFormPagoTercero, form: FormData) => Promise<EstadoFormPagoTercero>;

/** Pagar al tercero: sale de la caja USDT; primero capital recuperado y después ganancia. */
export function FormPagoTercero({
  accion,
  hoy,
  disponible,
}: {
  accion: Accion;
  hoy: Fecha;
  /** Lo que se le debe hoy, en texto es-AR (para la ayuda y el botón "Todo"). */
  disponible: { texto: string; editable: string };
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {});
  const [v, setV] = useState({ usdt: "", fecha: hoy, notas: "" });
  const [corregidos, setCorregidos] = useState({ de: estado, campos: new Set<CamposPagoTercero>() });
  if (corregidos.de !== estado) setCorregidos({ de: estado, campos: new Set() });
  const err = (c: CamposPagoTercero) => (corregidos.campos.has(c) ? undefined : estado.errores?.[c]);
  const set = (campo: CamposPagoTercero) => (valor: string) => {
    setV((prev) => ({ ...prev, [campo]: valor }));
    setCorregidos((prev) => ({ de: prev.de, campos: new Set(prev.campos).add(campo) }));
  };

  return (
    <form action={enviar} noValidate>
      <fieldset disabled={pendiente}>
        <Panel
          icono={<Send aria-hidden />}
          titulo="Pagar al tercero"
          accion={
            <Button type="button" variant="ghost" size="sm" onClick={() => set("usdt")(disponible.editable)}>
              Todo
            </Button>
          }
        >
          {estado.error && <Alerta>{estado.error}</Alerta>}
          <div className="grid grid-cols-1 gap-margin sm:grid-cols-2">
            <Campo id="usdt" etiqueta="Monto (USDT)" error={err("usdt")} ayuda={`Se le debe ${disponible.texto} USDT. Sale de la caja.`}>
              <EntradaNumero id="usdt" valor={v.usdt} onChange={set("usdt")} sufijo="USDT" error={!!err("usdt")} />
            </Campo>
            <Campo id="fecha" etiqueta="Fecha" error={err("fecha")}>
              <Input
                id="fecha"
                name="fecha"
                type="date"
                max={hoy}
                value={v.fecha}
                onChange={(e) => set("fecha")(e.target.value)}
                className="font-mono tabular-nums"
                aria-invalid={!!err("fecha")}
              />
            </Campo>
          </div>
          <Campo id="notas" etiqueta="Notas" error={err("notas")} ayuda="Billetera, red o referencia.">
            <Input id="notas" name="notas" value={v.notas} onChange={(e) => set("notas")(e.target.value)} maxLength={200} autoComplete="off" />
          </Campo>
          <Button type="submit" className="gap-space-sm self-end">
            <Send aria-hidden />
            {pendiente ? "Registrando…" : "Registrar pago"}
          </Button>
        </Panel>
      </fieldset>
    </form>
  );
}
