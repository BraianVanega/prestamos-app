"use client";

import Decimal from "decimal.js";
import { ArrowRightLeft, CircleCheck, Scale, Sparkles } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import type { EstadoFormConversion } from "@/app/(app)/efectivo/actions";
import { Alerta, Campo, EntradaNumero, Panel } from "@/components/app/campos";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { lotesFifo } from "@/engine/conversion";
import { diasEntre, type Fecha } from "@/engine/fechas";
import { redondearUsdt } from "@/engine/redondeo";
import { formatearFecha } from "@/lib/formato";
import { formatearArs, formatearNumero, formatearUsdt, parsearDecimal } from "@/lib/numeros";
import type { CamposConversion } from "@/lib/conversiones";
import { cn } from "@/lib/utils";

/** Pago en efectivo con ARS sin convertir, como viaja al cliente (montos en string). */
export interface LoteForm {
  pagoId: string;
  fecha: Fecha;
  cliente: string;
  destino: string;
  ars: string;
  pendiente: string;
}

type Accion = (prev: EstadoFormConversion, form: FormData) => Promise<EstadoFormConversion>;

const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/;
const cero = new Decimal(0);
const aTexto = (d: Decimal) => (d.isZero() ? "" : formatearNumero(d, d.decimalPlaces()));

export function FormConversion({ accion, lotes, hoy }: { accion: Accion; lotes: LoteForm[]; hoy: Fecha }) {
  const [estado, enviar, pendiente] = useActionState(accion, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [v, setV] = useState({ fecha: hoy, ars: "", tc: "", notas: "" });
  /** null = lotes FIFO automáticos; si no, montos editados a mano por pago. */
  const [manual, setManual] = useState<Record<string, string> | null>(null);

  const [corregidos, setCorregidos] = useState({ de: estado, campos: new Set<CamposConversion>() });
  if (corregidos.de !== estado) setCorregidos({ de: estado, campos: new Set() });
  const corregir = (c: CamposConversion) =>
    setCorregidos((prev) => (prev.campos.has(c) ? prev : { de: prev.de, campos: new Set(prev.campos).add(c) }));
  const err = (c: CamposConversion) => (corregidos.campos.has(c) ? undefined : estado.errores?.[c]);
  const set = (campo: keyof typeof v) => (valor: string) => {
    setV((prev) => ({ ...prev, [campo]: valor }));
    corregir(campo);
    if (campo === "ars") corregir("lotes");
  };

  const fecha = FECHA_OK.test(v.fecha) ? v.fecha : hoy;
  const ars = parsearDecimal(v.ars);
  const aConvertir = ars && ars.gt(0) ? ars : cero;
  const tc = parsearDecimal(v.tc);
  const tcOk = tc && tc.gt(0) ? tc : null;
  const usdtDe = (x: Decimal) => (tcOk ? redondearUsdt(x.div(tcOk)) : null);

  const pendientes = lotes.map((l) => ({ ...l, pendiente: new Decimal(l.pendiente) }));
  const totalPendiente = pendientes.reduce((s, l) => s.plus(l.pendiente), cero);
  const fifo = lotesFifo(aConvertir, pendientes);
  const montos = new Map<string, Decimal | null>(
    pendientes.map((l) => [l.pagoId, manual ? (manual[l.pagoId]?.trim() ? parsearDecimal(manual[l.pagoId]!) : cero) : fifo.get(l.pagoId)!]),
  );
  const invalido = (l: (typeof pendientes)[number]) => {
    const m = montos.get(l.pagoId);
    return m === null || m === undefined || m.lt(0) || m.gt(l.pendiente) || m.decimalPlaces() > 2 || (m.gt(0) && diasEntre(l.fecha, fecha) < 0);
  };
  const asignado = [...montos.values()].reduce<Decimal>((s, m) => s.plus(m ?? 0), cero);
  const diferencia = aConvertir.minus(asignado);
  const hayInvalido = pendientes.some(invalido);
  const usdt = usdtDe(aConvertir);
  const lotesJson = JSON.stringify(
    Object.fromEntries(pendientes.flatMap((l) => {
      const m = montos.get(l.pagoId);
      return m && m.gt(0) ? [[l.pagoId, m.toFixed(2)]] : [];
    })),
  );

  const editar = (pagoId: string, texto: string) => {
    setManual((prev) => ({ ...(prev ?? Object.fromEntries(pendientes.map((l) => [l.pagoId, aTexto(fifo.get(l.pagoId)!)]))), [pagoId]: texto }));
    corregir("lotes");
  };

  const excede = aConvertir.gt(totalPendiente);
  const listo = aConvertir.gt(0) && !!tcOk && !excede && !hayInvalido && diferencia.isZero();
  const pedirConfirmacion = () => (listo ? setConfirmando(true) : formRef.current?.requestSubmit());

  const th = "px-space-md py-space-sm text-label-caps text-on-surface-variant uppercase whitespace-nowrap";
  const td = "px-space-md py-space-sm font-mono text-data-cell tabular-nums whitespace-nowrap";

  return (
    <form ref={formRef} action={enviar} noValidate className="flex flex-col gap-margin">
      <input type="hidden" name="lotes" value={lotesJson} />
      {estado.error && <Alerta>{estado.error}</Alerta>}

      <div className="grid grid-cols-1 items-start gap-margin xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <fieldset disabled={pendiente || lotes.length === 0} className="flex min-w-0 flex-col gap-margin">
          <Panel
            icono={<ArrowRightLeft aria-hidden />}
            titulo="Registrar conversión"
            accion={
              <Button type="button" className="h-9 gap-space-sm px-margin" onClick={pedirConfirmacion} disabled={pendiente || lotes.length === 0}>
                <CircleCheck aria-hidden />
                {pendiente ? "Registrando…" : "Confirmar conversión"}
              </Button>
            }
          >
            <div className="grid grid-cols-1 gap-margin md:grid-cols-3">
              <Campo id="ars" etiqueta="ARS a convertir" error={err("ars") ?? (excede ? "Supera el efectivo sin convertir." : undefined)}>
                <div className="flex gap-space-xs">
                  <EntradaNumero id="ars" valor={v.ars} onChange={set("ars")} prefijo="$" error={!!err("ars") || excede} className="flex-1" />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      set("ars")(aTexto(totalPendiente));
                      setManual(null);
                    }}
                    disabled={totalPendiente.isZero()}
                  >
                    Todo
                  </Button>
                </div>
              </Campo>
              <Campo id="tc" etiqueta="TC de la conversión (ARS / USDT)" error={err("tc")} ayuda="TC neto que liquidó el proveedor.">
                <EntradaNumero id="tc" valor={v.tc} onChange={set("tc")} error={!!err("tc")} />
              </Campo>
              <div className="flex flex-col gap-space-xs">
                <span className="text-body-md font-medium text-on-surface">USDT resultante</span>
                <span className="flex h-8 items-center justify-end rounded-lg bg-primary-fixed px-space-md font-mono text-data-currency-primary text-on-primary-fixed-variant tabular-nums">
                  {usdt && aConvertir.gt(0) ? `${formatearUsdt(usdt)} USDT` : "—"}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-margin md:grid-cols-3">
              <Campo id="fecha" etiqueta="Fecha de la conversión" error={err("fecha")}>
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
              <div className="md:col-span-2">
                <Campo id="notas" etiqueta="Notas" error={err("notas")} ayuda="Proveedor, cuenta o referencia.">
                  <Textarea id="notas" name="notas" value={v.notas} onChange={(e) => set("notas")(e.target.value)} rows={1} />
                </Campo>
              </div>
            </div>
          </Panel>
        </fieldset>

        <aside className="flex min-w-0 flex-col gap-space-md rounded-lg border border-outline-variant bg-surface-container-lowest p-margin-panel xl:sticky xl:top-16">
          <div className="flex items-center gap-space-sm">
            <Scale className="size-4 text-primary" aria-hidden />
            <h2 className="text-label-caps text-on-surface uppercase">Conciliación</h2>
          </div>
          {(
            [
              ["1. A convertir", aConvertir],
              ["2. Asignado a lotes", asignado],
              ["Queda sin convertir", Decimal.max(totalPendiente.minus(aConvertir), 0)],
            ] as const
          ).map(([etiqueta, x]) => (
            <div key={etiqueta} className="flex items-baseline justify-between gap-space-md">
              <span className="text-label-caps text-on-surface-variant uppercase">{etiqueta}</span>
              <span className="flex flex-col items-end font-mono tabular-nums">
                <span className="text-data-currency-primary">${formatearArs(x)}</span>
                {usdtDe(x) && etiqueta !== "Queda sin convertir" && (
                  <span className="text-data-currency-secondary text-on-surface-variant">{formatearUsdt(usdtDe(x)!)} USDT</span>
                )}
              </span>
            </div>
          ))}
          <div className="border-t border-outline-variant pt-space-md">
            {diferencia.isZero() ? (
              <p className="flex items-center gap-space-sm rounded-lg bg-riesgo-verde-bg px-space-md py-space-sm font-mono text-badge-label text-riesgo-verde-fg uppercase">
                <CircleCheck className="size-4" aria-hidden />
                $0,00 de diferencia · cuadrado
              </p>
            ) : (
              <p className="rounded-lg border border-riesgo-rojo-borde bg-riesgo-rojo-bg px-space-md py-space-sm font-mono text-data-cell text-riesgo-rojo-fg tabular-nums">
                {diferencia.gt(0) ? `Faltan asignar $${formatearArs(diferencia)}` : `Asignaste $${formatearArs(diferencia.abs())} de más`}
              </p>
            )}
          </div>
          <p className="text-body-sm text-on-surface-variant">
            Recién al convertir se realiza el cobro en USDT: cada lote recupera primero el costo de sus préstamos y lo que lo supera es ganancia.
          </p>
        </aside>
      </div>

      <section className="flex flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
        <div className="flex flex-wrap items-center gap-margin border-b border-outline-variant px-margin-panel py-space-md">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-headline-sm text-on-surface">Efectivo sin convertir</h2>
            <p className="text-body-md text-on-surface-variant">Lotes sugeridos por antigüedad (el más viejo primero). Podés elegir otros a mano.</p>
          </div>
          <Button type="button" variant="secondary" className="ml-auto gap-space-sm" onClick={() => setManual(null)} disabled={!manual}>
            <Sparkles aria-hidden />
            Aplicar FIFO
          </Button>
        </div>
        {err("lotes") && <p className="px-margin-panel pt-space-sm text-body-sm text-error">{err("lotes")}</p>}
        {lotes.length === 0 ? (
          <p className="px-margin-panel py-margin text-center text-body-md text-on-surface-variant">No hay efectivo pendiente de convertir.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr>
                  <th className={cn(th, "text-left")}>Cobrado</th>
                  <th className={cn(th, "text-right")}>Antigüedad</th>
                  <th className={cn(th, "text-left")}>Cliente</th>
                  <th className={cn(th, "text-left")}>Destino</th>
                  <th className={cn(th, "text-right")}>Pago ARS</th>
                  <th className={cn(th, "text-right")}>Pendiente ARS</th>
                  <th className={cn(th, "text-right")}>A convertir ARS</th>
                  <th className={cn(th, "text-right")}>USDT</th>
                </tr>
              </thead>
              <tbody>
                {pendientes.map((l) => {
                  const dias = diasEntre(l.fecha, hoy);
                  const m = montos.get(l.pagoId) ?? null;
                  const texto = manual ? (manual[l.pagoId] ?? "") : aTexto(fifo.get(l.pagoId)!);
                  return (
                    <tr key={l.pagoId} className="border-b border-outline-variant/60 last:border-b-0">
                      <td className={td}>{formatearFecha(l.fecha)}</td>
                      <td className={cn(td, "text-right", dias > 7 ? "text-error" : "text-on-surface-variant")}>{dias} d</td>
                      <td className="px-space-md py-space-sm text-body-md text-on-surface">{l.cliente}</td>
                      <td className={cn(td, "text-primary")}>{l.destino}</td>
                      <td className={cn(td, "text-right text-on-surface-variant")}>${formatearArs(l.ars)}</td>
                      <td className={cn(td, "text-right font-semibold")}>${formatearArs(l.pendiente)}</td>
                      <td className="px-space-md py-space-xs">
                        <Input
                          value={texto}
                          onChange={(e) => editar(l.pagoId, e.target.value)}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0"
                          disabled={pendiente}
                          aria-label={`ARS a convertir del pago del ${formatearFecha(l.fecha)} de ${l.cliente}`}
                          aria-invalid={invalido(l)}
                          className="ml-auto w-36 text-right font-mono tabular-nums"
                        />
                      </td>
                      <td className={cn(td, "text-right text-primary")}>{m && m.gt(0) && usdtDe(m) ? formatearUsdt(usdtDe(m)!) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-outline-variant bg-surface-container-low">
                <tr>
                  <td colSpan={5} className="px-space-md py-space-sm text-body-md font-medium text-on-surface">
                    Total sin convertir
                  </td>
                  <td className={cn(td, "text-right font-semibold")}>${formatearArs(totalPendiente)}</td>
                  <td className={cn(td, "text-right font-semibold")}>${formatearArs(asignado)}</td>
                  <td className={cn(td, "text-right")}>{usdt && aConvertir.gt(0) ? formatearUsdt(usdt) : "—"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent className="rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmá la conversión</AlertDialogTitle>
            <AlertDialogDescription render={<div />}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-margin gap-y-space-xs text-body-md">
                <dt className="text-on-surface-variant">Convertís</dt>
                <dd className="font-mono text-on-surface tabular-nums">
                  ${formatearArs(aConvertir)} a TC {v.tc} = {usdt ? formatearUsdt(usdt) : "—"} USDT
                </dd>
                <dt className="text-on-surface-variant">Fecha</dt>
                <dd className="font-mono text-on-surface tabular-nums">{formatearFecha(fecha)}</dd>
                <dt className="text-on-surface-variant">Lotes</dt>
                <dd className="font-mono text-on-surface tabular-nums">{[...montos.values()].filter((m) => m?.gt(0)).length} pago(s) en efectivo</dd>
              </dl>
              <p className="mt-space-md text-body-sm text-on-surface-variant">La conversión no se edita: un error se corrige anulándola.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmando(false);
                formRef.current?.requestSubmit();
              }}
            >
              Registrar conversión
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
