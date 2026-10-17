"use client";

import type Decimal from "decimal.js";
import { ArrowLeft, CalendarRange, CircleDollarSign, Handshake, Lock, PencilLine, Plus, SlidersHorizontal, Trash2, UserPlus, UserRound } from "lucide-react";
import Link from "next/link";
import { Fragment, useActionState, useMemo, useRef, useState } from "react";
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
import { calcularPlan, proyectarUsdt, tasaMensualEquivalente } from "@/engine/cronograma";
import { participacionesPrestamo } from "@/engine/desembolso";
import { DECIMALES } from "@/engine/redondeo";
import { repartir } from "@/engine/reparto";
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

/** Tercero que se puede sumar al préstamo. */
export interface OpcionTercero {
  value: string;
  label: string;
  /** % sugerido, texto editable es-AR ("" si no tiene). */
  pctDefault: string;
}

/** Fila de un tercero en la estructura de capital (texto editable). */
export interface FilaTercero {
  participanteId: string;
  pct: string;
}

/** Valores del formulario como texto editable (es-AR). */
export interface ValoresPrestamo {
  fechaDesembolso: Fecha;
  arsCapital: string;
  tcEntrada: string;
  frecuencia: Frecuencia;
  nCuotas: string;
  tasaTotalPct: string;
  moraPct: string;
  diasGracia: string;
  notas: string;
}

/** Edición de un préstamo: se anula y se da de alta con estos datos (los cobros se vuelven a imputar). */
export interface Correccion {
  /** "#PR-0012" */
  numero: string;
  /** Ficha del préstamo original. */
  volver: string;
  /** Lo cobrado hasta ahora sobre el préstamo (pagos vigentes); null si no tiene cobros. */
  cobros: { pagos: number; ars: string; primero: Fecha } | null;
}

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

const entero = (s: string) => (/^\d+$/.test(s.trim()) ? Number.parseInt(s, 10) : null);

export function FormPrestamo({
  accion,
  clientes,
  clienteInicial,
  hoy,
  moraSugerida,
  graciaSugerida,
  inicial,
  correccion,
  terceros,
  tercerosIniciales,
  socios,
}: {
  accion: Accion;
  clientes: OpcionCliente[];
  clienteInicial: OpcionCliente | null;
  hoy: Fecha;
  moraSugerida: string;
  graciaSugerida: number;
  inicial?: ValoresPrestamo;
  correccion?: Correccion;
  terceros: OpcionTercero[];
  tercerosIniciales?: FilaTercero[];
  /** Socios con su % de la Sociedad (texto editable), para mostrar cómo se abre la parte de la Sociedad. */
  socios: { nombre: string; pct: string }[];
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmando, setConfirmando] = useState(false);

  const [cliente, setCliente] = useState<OpcionCliente | null>(clienteInicial);
  const [v, setV] = useState<ValoresPrestamo>(
    () =>
      inicial ?? {
        fechaDesembolso: hoy,
        arsCapital: "",
        tcEntrada: "",
        frecuencia: "quincena",
        nCuotas: "",
        tasaTotalPct: "",
        moraPct: moraSugerida,
        diasGracia: String(graciaSugerida),
        notas: "",
      },
  );
  const [motivo, setMotivo] = useState("");
  const [filas, setFilas] = useState<FilaTercero[]>(tercerosIniciales ?? []);

  // Los errores del servidor se ocultan campo por campo a medida que se corrigen.
  const [corregidos, setCorregidos] = useState({ de: estado, campos: new Set<CamposPrestamo | "motivo" | "terceros">() });
  if (corregidos.de !== estado) setCorregidos({ de: estado, campos: new Set() });
  const corregir = (c: CamposPrestamo | "motivo" | "terceros") =>
    setCorregidos((prev) => (prev.campos.has(c) ? prev : { de: prev.de, campos: new Set(prev.campos).add(c) }));
  const err = (c: CamposPrestamo | "motivo" | "terceros") => (corregidos.campos.has(c) ? undefined : estado.errores?.[c]);
  const cambiarFilas = (f: (prev: FilaTercero[]) => FilaTercero[]) => {
    setFilas(f);
    corregir("terceros");
  };

  const set = (campo: keyof typeof v) => (valor: string) => {
    setV((prev) => ({ ...prev, [campo]: valor }));
    corregir(campo);
    // La mensual equivalente sale de estos tres: si cambia el plazo, el error de la tasa ya no aplica.
    if (campo === "nCuotas" || campo === "frecuencia") corregir("tasaTotalPct");
  };

  const tasaTotal = parsearDecimal(v.tasaTotalPct);
  const mensualEquivalente = useMemo(() => {
    const total = parsearDecimal(v.tasaTotalPct);
    const n = entero(v.nCuotas);
    return total && total.gte(0) && n && n > 0 ? tasaMensualEquivalente(total, v.frecuencia, n) : null;
  }, [v.tasaTotalPct, v.nCuotas, v.frecuencia]);

  const calculo = useMemo(() => {
    const capital = parsearDecimal(v.arsCapital);
    const tc = parsearDecimal(v.tcEntrada);
    const total = parsearDecimal(v.tasaTotalPct);
    const n = entero(v.nCuotas);
    if (!capital || !tc || !total || !n || n <= 0 || capital.lte(0) || tc.lte(0)) return null;
    try {
      const plan = calcularPlan({
        arsCapital: capital,
        tcEntrada: tc,
        tasaTotalPct: total,
        fechaDesembolso: v.fechaDesembolso,
        frecuencia: v.frecuencia,
        nCuotas: n,
      });
      return { plan, proy: proyectarUsdt(plan, tc, tasaMensualEquivalente(total, v.frecuencia, n)), capital, tc };
    } catch {
      return null;
    }
  }, [v.arsCapital, v.tcEntrada, v.tasaTotalPct, v.nCuotas, v.fechaDesembolso, v.frecuencia]);

  // Reparto del préstamo: Sociedad (abierta por socio) y cada tercero, con el USDT que pone cada uno.
  const estructura = useMemo(() => {
    try {
      const partes = participacionesPrestamo(
        "sociedad",
        filas.map((f) => {
          const pct = parsearDecimal(f.pct);
          if (!f.participanteId || !pct) throw new Error("incompleta");
          return { participanteId: f.participanteId, pct };
        }),
      );
      const usdt = calculo
        ? repartir(calculo.plan.usdtPrestado, [...partes.filter((p) => p.participanteId !== "sociedad"), ...partes.filter((p) => p.participanteId === "sociedad")].map((p) => ({ id: p.participanteId, pct: p.pctCapital })), DECIMALES.usdt)
        : null;
      return partes.map((p) => ({ ...p, usdt: usdt?.find((u) => u.id === p.participanteId)?.monto ?? null }));
    } catch {
      return null;
    }
  }, [filas, calculo]);
  const parteSociedad = estructura?.find((p) => p.participanteId === "sociedad");
  const nombreTercero = (id: string) => terceros.find((t) => t.value === id)?.label ?? "Tercero";

  const pedirConfirmacion = () => {
    if (calculo && cliente && (!correccion || motivo.trim().length >= 3)) setConfirmando(true);
    else formRef.current?.requestSubmit();
  };

  return (
    <form ref={formRef} action={enviar} noValidate className="flex flex-col gap-margin">
      <input type="hidden" name="clienteId" value={cliente?.value ?? ""} />
      {filas.map((f, i) => (
        <span key={i} hidden>
          <input type="hidden" name="terceroId" value={f.participanteId} />
          <input type="hidden" name="terceroPct" value={f.pct} />
        </span>
      ))}

      <div className="flex flex-wrap items-center gap-margin">
        <Link
          href={correccion?.volver ?? "/prestamos"}
          aria-label={correccion ? `Volver a ${correccion.numero}` : "Volver a préstamos"}
          className="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground hover:bg-accent"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <div className="flex flex-col">
          <span className="text-label text-link">{correccion ? "Edición de préstamo" : "Originación de crédito"}</span>
          <h1 className="text-headline-xl text-foreground">
            {correccion ? (
              <>
                Editar <span className="font-mono tabular-nums">{correccion.numero}</span>
              </>
            ) : (
              "Nuevo préstamo"
            )}
          </h1>
        </div>
        <Button type="button" className="ml-auto h-9 gap-space-sm px-margin" onClick={pedirConfirmacion} disabled={pendiente}>
          {correccion ? <PencilLine aria-hidden /> : <CircleDollarSign aria-hidden />}
          {correccion ? (pendiente ? "Guardando…" : "Guardar cambios") : pendiente ? "Desembolsando…" : "Generar y desembolsar"}
        </Button>
      </div>

      {estado.error && <Alerta>{estado.error}</Alerta>}

      <div className="grid grid-cols-1 items-start gap-margin xl:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
        <fieldset disabled={pendiente} className="flex min-w-0 flex-col gap-margin">
          {correccion && (
            <Panel icono={<PencilLine aria-hidden />} titulo="Motivo del cambio">
              <p className="text-body-md text-muted-foreground">
                Se anula <span className="font-mono tabular-nums">{correccion.numero}</span> (se revierte su desembolso) y se da de alta
                un préstamo nuevo con estos datos. El original queda en el historial como anulado.
              </p>
              {correccion.cobros && (
                <div className="flex flex-col gap-space-xs rounded-lg bg-muted p-space-md text-body-md text-foreground">
                  <p>
                    Ya tiene{" "}
                    <span className="font-mono tabular-nums">
                      {correccion.cobros.pagos} {correccion.cobros.pagos === 1 ? "cobro" : "cobros"}
                    </span>{" "}
                    por <span className="font-mono tabular-nums">${formatearArs(correccion.cobros.ars)}</span>. Lo cobrado no cambia: cada cobro
                    se vuelve a imputar con las condiciones nuevas (misma fecha, monto y TC).
                  </p>
                  <ul className="list-disc pl-space-lg text-body-sm text-muted-foreground">
                    <li>Si ahora debe menos de lo que pagó, la diferencia queda como saldo a favor del cliente.</li>
                    <li>La mora se recalcula con el cronograma nuevo; los descuentos pasan a la cuota del mismo número.</li>
                    <li>
                      El cliente no se puede cambiar y el desembolso no puede ser posterior al{" "}
                      <span className="font-mono tabular-nums">{formatearFecha(correccion.cobros.primero)}</span> (primer cobro).
                    </li>
                  </ul>
                </div>
              )}
              <Campo id="motivo" etiqueta="Qué se cambia y por qué" error={err("motivo")}>
                <Textarea
                  id="motivo"
                  name="motivo"
                  value={motivo}
                  onChange={(e) => {
                    setMotivo(e.target.value);
                    corregir("motivo");
                  }}
                  rows={2}
                  maxLength={200}
                  placeholder="Ej.: TC de entrada mal cargado"
                  aria-invalid={!!err("motivo")}
                />
              </Campo>
            </Panel>
          )}
          <Panel
            icono={<UserRound aria-hidden />}
            titulo="Prestatario"
            accion={
              <Link href="/clientes/nuevo" className="flex items-center gap-space-xs text-label text-link hover:underline">
                <UserPlus className="size-3.5" aria-hidden />
                Nuevo cliente
              </Link>
            }
          >
            <Campo id="cliente" etiqueta="Cliente" error={err("clienteId")}>
              <Combobox
                disabled={!!correccion?.cobros}
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
                        <span className="font-mono text-data-cell text-muted-foreground tabular-nums">{item.documento}</span>
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

            <div className="flex flex-col gap-space-xs rounded-lg bg-primary p-margin-panel text-primary-foreground">
              <span className="flex items-center gap-space-sm text-label">
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

          <EstructuraCapital
            filas={filas}
            cambiar={cambiarFilas}
            terceros={terceros}
            socios={socios}
            estructura={estructura}
            nombreTercero={nombreTercero}
            error={err("terceros")}
          />

          <Panel icono={<SlidersHorizontal aria-hidden />} titulo="Parámetros financieros y plazos">
            <div className="grid grid-cols-1 gap-margin md:grid-cols-3">
              <Campo id="tasaTotalPct" etiqueta="Tasa del préstamo (%)" error={err("tasaTotalPct")}>
                <EntradaNumero id="tasaTotalPct" valor={v.tasaTotalPct} onChange={set("tasaTotalPct")} sufijo="%" error={!!err("tasaTotalPct")} />
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

            <div className="flex flex-col rounded-lg bg-muted p-space-md">
              <span className="text-label text-muted-foreground">Tasa del préstamo completo</span>
              <span className="text-body-md text-foreground">
                {tasaTotal && mensualEquivalente ? (
                  <>
                    Se cobra el <span className="font-mono tabular-nums">{formatearPct(tasaTotal)}%</span> del capital en todo el plazo
                    (equivale a <span className="font-mono tabular-nums">{formatearPct(mensualEquivalente)}%</span> mensual).
                  </>
                ) : (
                  "Completá tasa, frecuencia y cuotas."
                )}
              </span>
            </div>
          </Panel>

          <Panel icono={<CalendarRange aria-hidden />} titulo="Mora y notas">
            <div className="grid grid-cols-1 gap-margin md:grid-cols-3">
              <Campo id="moraPct" etiqueta="Mora (%)" error={err("moraPct")} ayuda="Opcional. Recargo único sobre el capital impago; en 0 no se cobra.">
                <EntradaNumero id="moraPct" valor={v.moraPct} onChange={set("moraPct")} sufijo="%" error={!!err("moraPct")} />
              </Campo>
              <Campo id="diasGracia" etiqueta="Días de gracia" error={err("diasGracia")} ayuda="Opcional. Pasados estos días se carga la mora.">
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
            <AlertDialogTitle>{correccion ? `Confirmá los cambios en ${correccion.numero}` : "Confirmá el desembolso"}</AlertDialogTitle>
            <AlertDialogDescription render={<div />}>
              {calculo && cliente && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-margin gap-y-space-xs text-body-md">
                  <dt className="text-muted-foreground">Cliente</dt>
                  <dd className="text-foreground">{cliente.label}</dd>
                  <dt className="text-muted-foreground">Capital</dt>
                  <dd className="font-mono text-foreground tabular-nums">${formatearArs(calculo.plan.arsTotal.minus(calculo.plan.arsInteresPactado))}</dd>
                  <dt className="text-muted-foreground">Sale de caja</dt>
                  <dd className="font-mono text-foreground tabular-nums">
                    {formatearUsdt(parteSociedad?.usdt ?? (estructura ? 0 : calculo.plan.usdtPrestado))} USDT
                  </dd>
                  {estructura
                    ?.filter((p) => p.participanteId !== "sociedad")
                    .map((p) => (
                      <Fragment key={p.participanteId}>
                        <dt className="text-muted-foreground">Pone {nombreTercero(p.participanteId)}</dt>
                        <dd className="font-mono text-foreground tabular-nums">
                          {p.usdt ? formatearUsdt(p.usdt) : "—"} USDT ({formatearPct(p.pctCapital)}%)
                        </dd>
                      </Fragment>
                    ))}
                  <dt className="text-muted-foreground">Cuotas</dt>
                  <dd className="font-mono text-foreground tabular-nums">
                    {calculo.plan.cuotas.length} {FRECUENCIAS[v.frecuencia].plural} · vence {formatearFecha(calculo.plan.vencimientoFinal)}
                  </dd>
                  <dt className="text-muted-foreground">Total a cobrar</dt>
                  <dd className="font-mono text-foreground tabular-nums">${formatearArs(calculo.plan.arsTotal)}</dd>
                </dl>
              )}
              <p className="mt-space-md text-body-sm text-muted-foreground">
                {correccion
                  ? `${correccion.numero} queda anulado y su desembolso vuelve a caja. El préstamo editado sale con número nuevo${correccion.cobros ? " y con los cobros reimputados" : ""}.`
                  : "Si después hay que cambiar algo, se hace con Editar en la ficha."}
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
              {correccion ? "Guardar" : "Desembolsar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

function EstructuraCapital({
  filas,
  cambiar,
  terceros,
  socios,
  estructura,
  nombreTercero,
  error,
}: {
  filas: FilaTercero[];
  cambiar: (f: (prev: FilaTercero[]) => FilaTercero[]) => void;
  terceros: OpcionTercero[];
  socios: { nombre: string; pct: string }[];
  estructura: { participanteId: string; pctCapital: Decimal; usdt: Decimal | null }[] | null;
  nombreTercero: (id: string) => string;
  error?: string;
}) {
  const libres = terceros.filter((t) => !filas.some((f) => f.participanteId === t.value));
  const agregar = () => {
    const t = libres[0];
    if (t) cambiar((prev) => [...prev, { participanteId: t.value, pct: t.pctDefault }]);
  };
  const sociedad = estructura?.find((p) => p.participanteId === "sociedad");

  return (
    <Panel
      icono={<Handshake aria-hidden />}
      titulo="Estructura de capital"
      accion={
        terceros.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="gap-space-xs" onClick={agregar} disabled={libres.length === 0}>
            <Plus aria-hidden />
            Agregar tercero
          </Button>
        )
      }
    >
      {filas.length === 0 ? (
        <p className="text-body-md text-muted-foreground">
          100% de la Sociedad ({socios.map((s) => `${s.nombre} ${s.pct}%`).join(" / ")}).{" "}
          {terceros.length === 0 ? (
            <>
              Para sumar a alguien que pone plata, dalo de alta en{" "}
              <Link href="/terceros" className="text-link hover:underline">
                Terceros
              </Link>
              .
            </>
          ) : (
            "Si un tercero pone plata, sumalo con su %."
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-space-sm">
          {filas.map((f, i) => {
            const items = terceros
              .filter((t) => t.value === f.participanteId || !filas.some((g) => g.participanteId === t.value))
              .map((t) => ({ value: t.value, label: t.label }));
            return (
              <div key={i} className="flex items-end gap-space-sm">
                <div className="flex min-w-0 flex-1 flex-col gap-space-xs">
                  <Label htmlFor={`tercero-${i}`}>Tercero</Label>
                  <Select
                    items={items}
                    value={f.participanteId}
                    onValueChange={(id) => {
                      if (!id) return;
                      const sugerido = terceros.find((t) => t.value === id)?.pctDefault ?? "";
                      cambiar((prev) => prev.map((g, j) => (j === i ? { participanteId: id, pct: g.pct || sugerido } : g)));
                    }}
                  >
                    <SelectTrigger id={`tercero-${i}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex w-32 flex-col gap-space-xs">
                  <Label htmlFor={`pct-${i}`}>% que pone</Label>
                  <EntradaNumero
                    id={`pct-${i}`}
                    sinNombre
                    valor={f.pct}
                    onChange={(pct) => cambiar((prev) => prev.map((g, j) => (j === i ? { ...g, pct } : g)))}
                    sufijo="%"
                    error={!!error}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar ${nombreTercero(f.participanteId)}`}
                  onClick={() => cambiar((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="text-body-sm text-danger">{error}</p>}
      {filas.length > 0 && (
        <div className="flex flex-col gap-space-xs rounded-lg bg-muted p-space-md">
          <span className="text-label text-muted-foreground">Reparto de capital y ganancia</span>
          {!estructura ? (
            <span className="text-body-md text-muted-foreground">Completá el % de cada tercero (entre todos, hasta 100%).</span>
          ) : (
            <ul className="flex flex-col gap-space-2xs text-body-md">
              {sociedad &&
                socios.map((s) => {
                  const pct = sociedad.pctCapital.times(parsearDecimal(s.pct) ?? 0).div(100);
                  return (
                    <li key={s.nombre} className="flex justify-between gap-margin">
                      <span className="text-foreground">{s.nombre} (Sociedad)</span>
                      <span className="font-mono tabular-nums text-foreground">{formatearPct(pct)}%</span>
                    </li>
                  );
                })}
              {estructura
                .filter((p) => p.participanteId !== "sociedad")
                .map((p) => (
                  <li key={p.participanteId} className="flex justify-between gap-margin">
                    <span className="text-foreground">{nombreTercero(p.participanteId)}</span>
                    <span className="font-mono tabular-nums text-foreground">
                      {formatearPct(p.pctCapital)}%{p.usdt && <span className="text-muted-foreground"> · pone {formatearUsdt(p.usdt)} USDT</span>}
                    </span>
                  </li>
                ))}
            </ul>
          )}
          <span className="text-body-sm text-muted-foreground">
            La plata de cada tercero entra a la caja al desembolsar; la caja pone solo la parte de la Sociedad. Cada uno se lleva su % de la ganancia.
          </span>
        </div>
      )}
    </Panel>
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
    <section className="flex flex-col gap-space-md rounded-lg border border-border bg-card p-margin-panel">
      <h2 className="text-label text-muted-foreground">Simulación</h2>
      <div className="grid grid-cols-3 gap-gutter-compact">
        <Kpi etiqueta="Total a cobrar" usdt={calculo?.proy.totalUsdt} ars={calculo?.plan.arsTotal} />
        <Kpi etiqueta="Ganancia proyectada" usdt={calculo?.proy.gananciaUsdt} ars={calculo?.plan.arsInteresPactado} destacado />
        <div className="flex flex-col gap-space-xs rounded-lg bg-muted p-space-md">
          <span className="text-label text-muted-foreground">Rendimiento</span>
          <span className="font-mono text-data-currency-primary text-foreground tabular-nums">
            {tasaTotal && calculo ? `${formatearPct(tasaTotal)}%` : "—"}
          </span>
          <span className="font-mono text-data-currency-secondary text-muted-foreground tabular-nums">
            {calculo ? `TNA ${formatearPct(calculo.proy.tnaPct)}%` : " "}
          </span>
        </div>
      </div>
      <p className="text-body-sm text-muted-foreground">
        Proyección al TC de entrada. La ganancia real depende del TC de cada cobro.
      </p>
    </section>
  );
}

function Kpi({ etiqueta, usdt, ars, destacado }: { etiqueta: string; usdt?: Decimal; ars?: Decimal; destacado?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-space-xs rounded-lg p-space-md", destacado ? "bg-success-soft" : "bg-muted")}>
      <span className={cn("text-label", destacado ? "text-success" : "text-muted-foreground")}>{etiqueta}</span>
      <span className={cn("truncate font-mono text-data-currency-primary tabular-nums", destacado ? "text-success" : "text-foreground")}>
        {usdt ? `${destacado ? "+" : ""}${formatearUsdt(usdt)}` : "—"}
        {usdt && <span className="ml-space-xs text-data-currency-secondary">USDT</span>}
      </span>
      <span className="truncate font-mono text-data-currency-secondary text-muted-foreground tabular-nums">
        {ars ? `≈ $${formatearArs(ars)}` : " "}
      </span>
    </div>
  );
}

function Cronograma({ calculo, frecuencia }: { calculo: Calculo; frecuencia: Frecuencia }) {
  const th = "px-space-xs py-space-sm text-right text-label text-muted-foreground";
  const td = "px-space-xs py-space-xs text-right font-mono text-data-cell tabular-nums";
  return (
    <section className="flex flex-col gap-space-md rounded-lg border border-border bg-card p-margin-panel">
      <div className="flex items-baseline justify-between gap-margin">
        <h2 className="text-headline-sm text-foreground">Cronograma de cuotas</h2>
        {calculo && (
          <span className="font-mono text-data-cell text-muted-foreground tabular-nums">
            {calculo.plan.cuotas.length} {FRECUENCIAS[frecuencia].plural}
          </span>
        )}
      </div>
      {!calculo ? (
        <p className="text-body-md text-muted-foreground">Completá capital, TC, tasa y cuotas para ver el cronograma.</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-muted">
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
                <tr key={c.numero} className="border-b border-border/50 even:bg-muted/40">
                  <td className={cn(td, "text-left text-link")}>#{String(c.numero).padStart(2, "0")}</td>
                  <td className={cn(td, "text-left")}>{formatearFecha(c.vencimiento)}</td>
                  <td className={td}>{formatearArs(c.arsCapital)}</td>
                  <td className={cn(td, "text-success")}>{formatearArs(c.arsInteres)}</td>
                  <td className={td}>{formatearArs(calculo.proy.cuotas[i]!.totalArs)}</td>
                  <td className={cn(td, "font-semibold")}>{formatearUsdt(calculo.proy.cuotas[i]!.totalUsdt)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted">
              <tr>
                <td colSpan={2} className="px-space-sm py-space-sm text-label text-muted-foreground">
                  Total
                </td>
                <td className={cn(td, "font-semibold")}>{formatearArs(calculo.plan.arsTotal.minus(calculo.plan.arsInteresPactado))}</td>
                <td className={cn(td, "font-semibold text-success")}>{formatearArs(calculo.plan.arsInteresPactado)}</td>
                <td className={cn(td, "font-semibold")}>{formatearArs(calculo.plan.arsTotal)}</td>
                <td className={cn(td, "font-semibold text-link")}>{formatearUsdt(calculo.proy.totalUsdt)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
