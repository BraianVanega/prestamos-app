"use client";

import { Save, UserPlus } from "lucide-react";
import { useActionState, useState } from "react";
import type { EstadoFormTercero } from "@/app/(app)/terceros/actions";
import { Alerta, Campo, EntradaNumero, Panel } from "@/components/app/campos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CamposTercero } from "@/lib/terceros";

type Accion = (prev: EstadoFormTercero, form: FormData) => Promise<EstadoFormTercero>;

const ITEMS_ACTIVO = [
  { value: "si", label: "Activo" },
  { value: "no", label: "Inactivo (no se ofrece en préstamos nuevos)" },
];

/** Alta (sin `inicial`) o edición de un tercero. */
export function FormTercero({
  accion,
  inicial,
}: {
  accion: Accion;
  inicial?: { nombre: string; pctDefault: string; notas: string; activo: boolean };
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {});
  const [v, setV] = useState({
    nombre: inicial?.nombre ?? "",
    pctDefault: inicial?.pctDefault ?? "",
    notas: inicial?.notas ?? "",
    activo: inicial?.activo === false ? "no" : "si",
  });
  const [corregidos, setCorregidos] = useState({ de: estado, campos: new Set<CamposTercero>() });
  if (corregidos.de !== estado) setCorregidos({ de: estado, campos: new Set() });
  const err = (c: CamposTercero) => (corregidos.campos.has(c) ? undefined : estado.errores?.[c]);
  const set = (campo: CamposTercero) => (valor: string) => {
    setV((prev) => ({ ...prev, [campo]: valor }));
    setCorregidos((prev) => ({ de: prev.de, campos: new Set(prev.campos).add(campo) }));
  };

  return (
    <form action={enviar} noValidate>
      <fieldset disabled={pendiente}>
        <Panel icono={inicial ? <Save aria-hidden /> : <UserPlus aria-hidden />} titulo={inicial ? "Datos del tercero" : "Nuevo tercero"}>
          {estado.error && <Alerta>{estado.error}</Alerta>}
          <Campo id="nombre" etiqueta="Nombre" error={err("nombre")}>
            <Input id="nombre" name="nombre" value={v.nombre} onChange={(e) => set("nombre")(e.target.value)} maxLength={120} autoComplete="off" />
          </Campo>
          <Campo id="pctDefault" etiqueta="% sugerido (opcional)" error={err("pctDefault")} ayuda="Se propone al sumarlo a un préstamo.">
            <EntradaNumero id="pctDefault" valor={v.pctDefault} onChange={set("pctDefault")} sufijo="%" error={!!err("pctDefault")} />
          </Campo>
          {inicial && (
            <Campo id="activo" etiqueta="Estado" error={err("activo")}>
              <Select name="activo" items={ITEMS_ACTIVO} value={v.activo} onValueChange={(s) => s && set("activo")(s)}>
                <SelectTrigger id="activo" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITEMS_ACTIVO.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          )}
          <Campo id="notas" etiqueta="Notas" error={err("notas")} ayuda="Contacto, billetera, acuerdos.">
            <Textarea id="notas" name="notas" value={v.notas} onChange={(e) => set("notas")(e.target.value)} rows={3} maxLength={500} />
          </Campo>
          <Button type="submit" className="gap-space-sm self-end">
            {inicial ? <Save aria-hidden /> : <UserPlus aria-hidden />}
            {pendiente ? "Guardando…" : inicial ? "Guardar cambios" : "Crear tercero"}
          </Button>
        </Panel>
      </fieldset>
    </form>
  );
}
