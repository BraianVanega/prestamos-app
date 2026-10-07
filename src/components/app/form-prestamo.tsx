"use client";

import type Decimal from "decimal.js";
import { ArrowLeft, CalendarRange, CircleDollarSign, Lock, SlidersHorizontal, UserPlus, UserRound } from "lucide-react";
import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
import type { EstadoFormPrestamo } from "@/app/(app)/prestamos/actions";
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
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Alerta, Campo, EntradaNumero, Panel } from "@/components/app/campos";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { calcularPlan, proyectarUsdt, tasaTotalSugerida } from "@/engine/cronograma";
import type { Fecha, Frecuencia } from "@/engine/fechas";
import { formatearFecha } from "@/lib/formato";
import { formatearArs, formatearPct, formatearTc, formatearUsdt, parsearDecimal } from "@/lib/numeros";
import { FRECUENCIAS, type CamposPrestamo } from "@/lib/prestamos";
import { cn } from "@/lib/utils";

export interface OpcionCliente {
  value: string;
  label: string;
  documento: string;
}

type Accion = (prev: EstadoFormPrestamo, form: FormData) => Promise<EstadoFormPrestamo>;

const ITEMS_FRECUENCIA = (Object.keys(FRECUENCIAS) as Frecuencia[]).map((f) => ({
  value: f,
  label: FRECUENCIAS[f].etiqueta,
}));

const sinAcentos = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function filtrarCliente(item: OpcionCliente, query: string) {
  const q = query.trim();
  if (!q) return true;
  const digitos = q.replace(/\D/g, "");
  if (digitos && item.documento.replace(/\D/g, "").includes(digitos)) return true;
  return sinAcentos(item.label).includes(sinAcentos(q));
}

/** Decimal → texto editable es-AR sin ceros de más ("9,3333", "36"). */
const aTexto = (d: Decimal) => d.toFixed().replace(".", ",");

const entero = (s: string) => (/^\d+$/.test(s.trim()) ? Number.parseInt(s, 10) : null);

export function FormPrestamo({
  accion,
  clientes,
  clienteInicial,
  hoy,
  moraSugerida,
  graciaSugerida,
}: {
  accion: Accion;
  clientes: OpcionCliente[];
  clienteInicial: OpcionCliente | null;
  hoy: Fecha;
  moraSugerida: string;
  graciaSugerida: number;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmando, setConfirmando] = useState(false);

  const [cliente, setCliente] = useState<OpcionCliente | null>(clienteInicial);
  const [v, setV] = useState({
    fechaDesembolso: hoy,
    arsCapital: "",
    tcEntrada: "",
    tasaMensualPct: "",
    frecuencia: "quincena" as Frecuencia,
    nCuotas: "",
    tasaTotalPct: "",
    moraPct: moraSugerida,
    diasGracia: String(graciaSugerida),
    notas: "",
  });
  const [tasaTotalEditada, setTasaTotalEditada] = useState(false);

  // Los errores del servidor se ocultan campo por campo a medida que se corrigen.
  const [corregidos, setCorregidos] = useState({ de: estado, campos: new Set<CamposPrestamo>() });
  if (corregidos.de !== estado) setCorregidos({ de: estado, campos: new Set() });
  const corregir = (c: CamposPrestamo) =>
    setCorregidos((prev) => (prev.campos.has(c) ? prev : { de: prev.de, campos: new Set(prev.campos).add(c) }));
  const err = (c: CamposPrestamo) => (corregidos.campos.has(c) ? undefined : estado.errores?.[c]);

  const set = (campo: keyof typeof v) => (valor: string) => {
    setV((prev) => ({ ...prev, [campo]: valor }));
    corregir(campo);
    // La tasa total sugerida sale de estos tres: si cambian, su error ya no aplica.
    if (campo === "tasaMensualPct" || campo === "nCuotas" || campo === "frecuencia") corregir("tasaTotalPct");
  };

  const sugerida = useMemo(() => {
    const mensual = parsearDecimal(v.tasaMensualPct);
    const n = entero(v.nCuotas);
    return mensual && mensual.gte(0) && n && n > 0 ? tasaTotalSugerida(mensual, v.frecuencia, n) : null;
  }, [v.tasaMensualPct, v.nCuotas, v.frecuencia]);
  const tasaTotalTexto = tasaTotalEditada ? v.tasaTotalPct : sugerida ? aTexto(sugerida) : "";
  const tasaTotal = parsearDecimal(tasaTotalTexto);

  const calculo = useMemo(() => {
    const capital = parsearDecimal(v.arsCapital);
    const tc = parsearDecimal(v.tcEntrada);
    const mensual = parsearDecimal(v.tasaMensualPct);
    const total = parsearDecimal(tasaTotalTexto);
    const n = entero(v.nCuotas);
    if (!capital || !tc || !mensual || !total || !n || capital.lte(0) || tc.lte(0)) return null;
    try {
      const plan = calcularPlan({
        arsCapital: capital,
        tcEntrada: tc,
        tasaTotalPct: total,
        fechaDesembolso: v.fechaDesembolso,
        frecuencia: v.frecuencia,
        nCuotas: n,
      });
      return { plan, proy: proyectarUsdt(plan, tc, mensual), capital, tc };
    } catch {
      return null;
    }
  }, [v.arsCapital, v.tcEntrada, v.tasaMensualPct, tasaTotalTexto, v.nCuotas, v.fechaDesembolso, v.frecuencia]);

  const pedirConfirmacion = () => {
    if (calculo && cliente) setConfirmando(true);
    else formRef.current?.requestSubmit();
  };

  return (
    <form ref={formRef} action={enviar} noValidate className="flex flex-col gap-margin">
      <input type="hidden" name="clienteId" value={cliente?.value ?? ""} />
      <input type="hidden" name="tasaTotalPct" value={tasaTotalTexto} />

      <div className="flex flex-wrap items-center gap-margin">
        <Link
          href="/prestamos"
          aria-label="Volver a préstamos"
          className="flex size-9 items-center justify-center rounded-lg bg-surface-container-low text-on-surface hover:bg-surface-container"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <div className="flex flex-col">
          <span className="text-label-caps text-primary uppercase">Originación de crédito</span>
          <h1 className="text-headline-xl text-on-surface">Nuevo préstamo</h1>
        </div>
        <Button type="button" className="ml-auto h-9 gap-space-sm px-margin" onClick={pedirConfirmacion} disabled={pendiente}>
          <CircleDollarSign aria-hidden />
          {pendiente ? "Desembolsando…" : "Generar y desembolsar"}
        </Button>
      </div>

      {estado.error && <Alerta>{estado.error}</Alerta>}

      <div className="grid grid-cols-1 items-start gap-margin xl:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
        <fieldset disabled={pendiente} className="flex min-w-0 flex-col gap-margin">
          <Panel
            icono={<UserRound aria-hidden />}
            titulo="Prestatario"
            accion={
              <Link href="/clientes/nuevo" className="flex items-center gap-space-xs text-label-caps text-primary uppercase hover:underline">
                <UserPlus className="size-3.5" aria-hidden />
                Nuevo cliente
              </Link>
            }
          >
            <Campo id="cliente" etiqueta="Cliente" error={err("clienteId")}>
              <Combobox
                items={clientes}
                value={cliente}
                onValueChange={(c: OpcionCliente | null) => {
                  setCliente(c);
                  corregir("clienteId");
                }}
                filter={filtrarCliente}
                isItemEqualToValue={(a: OpcionCliente, b: OpcionCliente) => a.value === b.value}
              >
                <ComboboxInput
                  id="cliente"
                  placeholder="Buscá por nombre o DNI/CUIT…"
                  className="w-full"
                  aria-invalid={!!err("clienteId")}
                />
                <ComboboxContent>
                  <ComboboxEmpty>No hay clientes activos que coincidan.</ComboboxEmpty>
                  <ComboboxList>
                    {(item: OpcionCliente) => (
                      <ComboboxItem key={item.value} value={item}>
                        <span className="flex-1 truncate">{item.label}</span>
                        <span className="font-mono text-data-cell text-on-surface-variant tabular-nums">{item.documento}</span>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </Campo>
          </Panel>

          <Panel icono={<CircleDollarSign aria-hidden />} titulo="Monto desembolsado y valuación" nota="TC fijado al desembolso">
            <div className="grid grid-cols-1 gap-margin md:grid-cols-3">
              <Campo id="arsCapital" etiqueta="Capital desembolso (ARS)" error={err("arsCapital")}>
                <EntradaNumero id="arsCapital" valor={v.arsCapital} onChange={set("arsCapital")} prefijo="$" error={!!err("arsCapital")} />
              </Campo>
              <Campo id="tcEntrada" etiqueta="TC entrada (ARS / USDT)" error={err("tcEntrada")} ayuda="TC neto del proveedor.">
                <EntradaNumero id="tcEntrada" valor={v.tcEntrada} onChange={set("tcEntrada")} error={!!err("tcEntrada")} />
              </Campo>
              <Campo id="fechaDesembolso" etiqueta="Fecha de desembolso" error={err("fechaDesembolso")}>
                <Input
                  id="fechaDesembolso"
                  name="fechaDesembolso"
                  type="date"
                  value={v.fechaDesembolso}
                  onChange={(e) => set("fechaDesembolso")(e.target.value)}
                  className="font-mono tabular-nums"
                  aria-invalid={!!err("fechaDesembolso")}
                />
              </Campo>
            </div>

            <div className="flex flex-col gap-space-xs rounded-lg bg-primary p-margin-panel text-on-primary">
              <span className="flex items-center gap-space-sm text-label-caps uppercase">
                <Lock className="size-3.5" aria-hidden />
                USDT prestado (base de medición congelada)
              </span>
              <span className="flex flex-wrap items-baseline gap-x-space-md">
                <span className="font-mono text-headline-xl tabular-nums">
                  {calculo ? formatearUsdt(calculo.plan.usdtPrestado) : "—"} USDT
                </span>
                {calculo && (
                  <span className="font-mono text-data-cell tabular-nums opacity-80">
                    ≈ ${formatearArs(calculo.capital)} / ${formatearTc(calculo.tc)}
                  </span>
                )}
              </span>
              <span className="text-body-sm opacity-80">
                Es el costo en USDT a recuperar: la ganancia se reconoce recién cuando lo cobrado lo supera.
              </span>
            </div>
          </Panel>

          <Panel icono={<SlidersHorizontal aria-hidden />} titulo="Parámetros financieros y plazos">
            <div className="grid grid-cols-1 gap-margin md:grid-cols-3">
              <Campo id="tasaMensualPct" etiqueta="Tasa mensual (%)" error={err("tasaMensualPct")}>
                <EntradaNumero id="tasaMensualPct" valor={v.tasaMensualPct} onChange={set("tasaMensualPct")} sufijo="%" error={!!err("tasaMensualPct")} />
              </Campo>
              <Campo id="frecuencia" etiqueta="Frecuencia de pago" error={err("frecuencia")}>
                <Select name="frecuencia" items={ITEMS_FRECUENCIA} value={v.frecuencia} onValueChange={(f) => f && set("frecuencia")(f)}>
                  <SelectTrigger id="frecuencia" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ITEMS_FRECUENCIA.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo id="nCuotas" etiqueta="Cantidad de cuotas" error={err("nCuotas")}>
                <EntradaNumero id="nCuotas" valor={v.nCuotas} onChange={set("nCuotas")} sufijo="cuotas" error={!!err("nCuotas")} entero />
              </Campo>
            </div>

            <div className="flex flex-wrap items-center gap-margin rounded-lg bg-surface-container-low p-space-md">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-label-caps text-on-surface-variant uppercase">Tasa total sugerida</span>
                <span className="text-body-md text-on-surface">
                  {sugerida ? (
                    <>
                      <span className="font-mono tabular-nums">{formatearPct(sugerida)}%</span> = mensual × meses del plazo
                    </>
                  ) : (
                    "Completá tasa mensual, frecuencia y cuotas."
                  )}
                </span>
                {tasaTotalEditada && sugerida && (
                  <button type="button" onClick={() => setTasaTotalEditada(false)} className="self-start text-body-sm text-primary hover:underline">
                    Usar la sugerida
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-space-xs">
                <Label htmlFor="tasaTotal">Tasa total pactada</Label>
                <EntradaNumero
                  id="tasaTotal"
                  sinNombre
                  valor={tasaTotalTexto}
                  onChange={(t) => {
                    setTasaTotalEditada(true);
                    set("tasaTotalPct")(t);
                  }}
                  sufijo="%"
                  error={!!err("tasaTotalPct")}
                  className="w-36"
                />
                {err("tasaTotalPct") && <p className="text-body-sm text-error">{err("tasaTotalPct")}</p>}
              </div>
            </div>
          </Panel>

          <Panel icono={<CalendarRange aria-hidden />} titulo="Mora y notas">
            <div className="grid grid-cols-1 gap-margin md:grid-cols-3">
              <Campo id="moraPct" etiqueta="Mora (%)" error={err("moraPct")} ayuda="Recargo único sobre el capital impago.">
                <EntradaNumero id="moraPct" valor={v.moraPct} onChange={set("moraPct")} sufijo="%" error={!!err("moraPct")} />
              </Campo>
              <Campo id="diasGracia" etiqueta="Días de gracia" error={err("diasGracia")} ayuda="Pasados estos días se carga la mora.">
                <EntradaNumero id="diasGracia" valor={v.diasGracia} onChange={set("diasGracia")} sufijo="días" error={!!err("diasGracia")} entero />
              </Campo>
            </div>
            <Campo id="notas" etiqueta="Notas internas" error={err("notas")}>
              <Textarea id="notas" name="notas" value={v.notas} onChange={(e) => set("notas")(e.target.value)} rows={2} />
            </Campo>
          </Panel>
        </fieldset>

        <aside className="flex min-w-0 flex-col gap-margin xl:sticky xl:top-16">
          <Simulacion calculo={calculo} tasaTotal={tasaTotal} />
          <Cronograma calculo={calculo} frecuencia={v.frecuencia} />
        </aside>
      </div>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent className="rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmá el desembolso</AlertDialogTitle>
            <AlertDialogDescription render={<div />}>
              {calculo && cliente && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-margin gap-y-space-xs text-body-md">
                  <dt className="text-on-surface-variant">Cliente</dt>
                  <dd className="text-on-surface">{cliente.label}</dd>
                  <dt className="text-on-surface-variant">Capital</dt>
                  <dd className="font-mono text-on-surface tabular-nums">${formatearArs(calculo.plan.arsTotal.minus(calculo.plan.arsInteresPactado))}</dd>
                  <dt className="text-on-surface-variant">Sale de caja</dt>
                  <dd className="font-mono text-on-surface tabular-nums">{formatearUsdt(calculo.plan.usdtPrestado)} USDT</dd>
                  <dt className="text-on-surface-variant">Cuotas</dt>
                  <dd className="font-mono text-on-surface tabular-nums">
                    {calculo.plan.cuotas.length} {FRECUENCIAS[v.frecuencia].plural} · vence {formatearFecha(calculo.plan.vencimientoFinal)}
                  </dd>
                  <dt className="text-on-surface-variant">Total a cobrar</dt>
                  <dd className="font-mono text-on-surface tabular-nums">${formatearArs(calculo.plan.arsTotal)}</dd>
                </dl>
              )}
              <p className="mt-space-md text-body-sm text-on-surface-variant">
                Una vez creado, el préstamo no se edita: un error se corrige anulándolo.
              </p>
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
              Desembolsar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

type Calculo = {
  plan: ReturnType<typeof calcularPlan>;
  proy: ReturnType<typeof proyectarUsdt>;
  capital: Decimal;
  tc: Decimal;
} | null;

function Simulacion({ calculo, tasaTotal }: { calculo: Calculo; tasaTotal: Decimal | null }) {
  return (
    <section className="flex flex-col gap-space-md rounded-lg border border-outline-variant bg-surface-container-lowest p-margin-panel">
      <h2 className="text-label-caps text-on-surface-variant uppercase">Simulación</h2>
      <div className="grid grid-cols-3 gap-gutter-compact">
        <Kpi etiqueta="Total a cobrar" usdt={calculo?.proy.totalUsdt} ars={calculo?.plan.arsTotal} />
        <Kpi etiqueta="Ganancia proyectada" usdt={calculo?.proy.gananciaUsdt} ars={calculo?.plan.arsInteresPactado} destacado />
        <div className="flex flex-col gap-space-xs rounded-lg bg-surface-container-low p-space-md">
          <span className="text-label-caps text-on-surface-variant uppercase">Rendimiento</span>
          <span className="font-mono text-data-currency-primary text-on-surface tabular-nums">
            {tasaTotal && calculo ? `${formatearPct(tasaTotal)}%` : "—"}
          </span>
          <span className="font-mono text-data-currency-secondary text-on-surface-variant tabular-nums">
            {calculo ? `TNA ${formatearPct(calculo.proy.tnaPct)}%` : " "}
          </span>
        </div>
      </div>
      <p className="text-body-sm text-on-surface-variant">
        Proyección al TC de entrada. La ganancia real depende del TC de cada cobro.
      </p>
    </section>
  );
}

function Kpi({ etiqueta, usdt, ars, destacado }: { etiqueta: string; usdt?: Decimal; ars?: Decimal; destacado?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-space-xs rounded-lg p-space-md", destacado ? "bg-riesgo-verde-bg" : "bg-surface-container-low")}>
      <span className={cn("text-label-caps uppercase", destacado ? "text-riesgo-verde-fg" : "text-on-surface-variant")}>{etiqueta}</span>
      <span className={cn("truncate font-mono text-data-currency-primary tabular-nums", destacado ? "text-tertiary" : "text-on-surface")}>
        {usdt ? `${destacado ? "+" : ""}${formatearUsdt(usdt)}` : "—"}
        {usdt && <span className="ml-space-xs text-data-currency-secondary">USDT</span>}
      </span>
      <span className="truncate font-mono text-data-currency-secondary text-on-surface-variant tabular-nums">
        {ars ? `≈ $${formatearArs(ars)}` : " "}
      </span>
    </div>
  );
}

function Cronograma({ calculo, frecuencia }: { calculo: Calculo; frecuencia: Frecuencia }) {
  const th = "px-space-xs py-space-sm text-right text-label-caps text-on-surface-variant uppercase";
  const td = "px-space-xs py-space-xs text-right font-mono text-data-cell tabular-nums";
  return (
    <section className="flex flex-col gap-space-md rounded-lg border border-outline-variant bg-surface-container-lowest p-margin-panel">
      <div className="flex items-baseline justify-between gap-margin">
        <h2 className="text-headline-sm text-on-surface">Cronograma de cuotas</h2>
        {calculo && (
          <span className="font-mono text-data-cell text-on-surface-variant tabular-nums">
            {calculo.plan.cuotas.length} {FRECUENCIAS[frecuencia].plural}
          </span>
        )}
      </div>
      {!calculo ? (
        <p className="text-body-md text-on-surface-variant">Completá capital, TC, tasa y cuotas para ver el cronograma.</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-surface-container-low">
              <tr>
                <th className={cn(th, "text-left")}>N°</th>
                <th className={cn(th, "text-left")}>Vence</th>
                <th className={th}>Capital</th>
                <th className={th}>Interés</th>
                <th className={th}>Total ARS</th>
                <th className={th}>≈ USDT</th>
              </tr>
            </thead>
            <tbody>
              {calculo.plan.cuotas.map((c, i) => (
                <tr key={c.numero} className="border-b border-outline-variant/50 even:bg-surface-container-low/40">
                  <td className={cn(td, "text-left text-primary")}>#{String(c.numero).padStart(2, "0")}</td>
                  <td className={cn(td, "text-left")}>{formatearFecha(c.vencimiento)}</td>
                  <td className={td}>{formatearArs(c.arsCapital)}</td>
                  <td className={cn(td, "text-tertiary")}>{formatearArs(c.arsInteres)}</td>
                  <td className={td}>{formatearArs(calculo.proy.cuotas[i]!.totalArs)}</td>
                  <td className={cn(td, "font-semibold")}>{formatearUsdt(calculo.proy.cuotas[i]!.totalUsdt)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-container-low">
              <tr>
                <td colSpan={2} className="px-space-sm py-space-sm text-label-caps text-on-surface-variant uppercase">
                  Total
                </td>
                <td className={cn(td, "font-semibold")}>{formatearArs(calculo.plan.arsTotal.minus(calculo.plan.arsInteresPactado))}</td>
                <td className={cn(td, "font-semibold text-tertiary")}>{formatearArs(calculo.plan.arsInteresPactado)}</td>
                <td className={cn(td, "font-semibold")}>{formatearArs(calculo.plan.arsTotal)}</td>
                <td className={cn(td, "font-semibold text-primary")}>{formatearUsdt(calculo.proy.totalUsdt)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
