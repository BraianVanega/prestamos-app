"use client";

import { CirclePlus, HandCoins } from "lucide-react";
import { useActionState, useState } from "react";
import type { EstadoFormAporte } from "@/app/(app)/socios/actions";
import { Alerta, Campo, EntradaNumero, Panel } from "@/components/app/campos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Fecha } from "@/engine/fechas";
import type { CamposAporte } from "@/lib/aportes";

type Accion = (prev: EstadoFormAporte, form: FormData) => Promise<EstadoFormAporte>;

export function FormAporte({
  accion,
  socios,
  hoy,
}: {
  accion: Accion;
  /** Socios activos con su % de la sociedad (texto ya formateado). */
  socios: { id: string; nombre: string; pct: string }[];
  hoy: Fecha;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {});
  const items = [
    ...socios.map((s) => ({ value: s.id, label: s.nombre })),
    { value: "ambos", label: `Ambos (${socios.map((s) => s.pct).join(" / ")}%)` },
  ];
  const [v, setV] = useState({ socio: items[0]?.value ?? "", usdt: "", fecha: hoy, notas: "" });
  const [corregidos, setCorregidos] = useState({ de: estado, campos: new Set<CamposAporte>() });
  if (corregidos.de !== estado) setCorregidos({ de: estado, campos: new Set() });
  const err = (c: CamposAporte) => (corregidos.campos.has(c) ? undefined : estado.errores?.[c]);
  const set = (campo: CamposAporte) => (valor: string) => {
    setV((prev) => ({ ...prev, [campo]: valor }));
    setCorregidos((prev) => ({ de: prev.de, campos: new Set(prev.campos).add(campo) }));
  };

  return (
    <form action={enviar} noValidate>
      <fieldset disabled={pendiente}>
        <Panel icono={<HandCoins aria-hidden />} titulo="Registrar aporte">
          {estado.error && <Alerta>{estado.error}</Alerta>}
          <Campo id="socio" etiqueta="Socio que aporta" error={err("socio")}>
            <Select name="socio" items={items} value={v.socio} onValueChange={(s) => s && set("socio")(s)}>
              <SelectTrigger id="socio" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <div className="grid grid-cols-1 gap-margin sm:grid-cols-2">
            <Campo id="usdt" etiqueta="Monto (USDT)" error={err("usdt")} ayuda="Entra a la caja USDT.">
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
          <Campo id="notas" etiqueta="Notas" error={err("notas")} ayuda="Origen de los fondos, billetera o referencia.">
            <Input id="notas" name="notas" value={v.notas} onChange={(e) => set("notas")(e.target.value)} maxLength={200} autoComplete="off" />
          </Campo>
          <Button type="submit" className="gap-space-sm self-end">
            <CirclePlus aria-hidden />
            {pendiente ? "Registrando…" : "Registrar aporte"}
          </Button>
        </Panel>
      </fieldset>
    </form>
  );
}
