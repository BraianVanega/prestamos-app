"use client";

import Decimal from "decimal.js";
import { ArrowLeft, Banknote, CircleCheck, HandCoins, Landmark, Scale, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useMemo, useRef, useState } from "react";
import type { EstadoFormPago } from "@/app/(app)/pagos/actions";
import { Alerta, Campo, EntradaNumero, Panel } from "@/components/app/campos";
import { BadgeRiesgo } from "@/components/app/riesgo";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { diasEntre, type Fecha } from "@/engine/fechas";
import { aplicarDescuentos, deudasAFecha, distribuirFifo, type Deuda, type PrestamoParaCobro } from "@/engine/pago";
import { redondearUsdt } from "@/engine/redondeo";
import { formatearFecha } from "@/lib/formato";
import { formatearArs, formatearNumero, formatearUsdt, parsearDecimal } from "@/lib/numeros";
import type { CamposPago } from "@/lib/pagos";
import { numeroPrestamo } from "@/lib/prestamos";
import { cn } from "@/lib/utils";

export interface OpcionClientePago {
  value: string;
  label: string;
  documento: string;
  vigentes: number;
}

type Accion = (prev: EstadoFormPago, form: FormData) => Promise<EstadoFormPago>;
type Tipo = "transferencia" | "efectivo";

const sinAcentos = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function filtrarCliente(item: OpcionClientePago, query: string) {
  const q = query.trim();
  if (!q) return true;
  const digitos = q.replace(/\D/g, "");
  if (digitos && item.documento.replace(/\D/g, "").includes(digitos)) return true;
  return sinAcentos(item.label).includes(sinAcentos(q));
}

const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/;
const cero = new Decimal(0);
/** Decimal → texto editable es-AR ("216.000", "68.000,5"); vacío si es 0. */
const aTexto = (d: Decimal) => (d.isZero() ? "" : formatearNumero(d, d.decimalPlaces()));

export function FormPago({
  accion,
  clientes,
  cliente,
  prestamos,
  saldoFavor,
  saldoAplicable,
  hoy,
}: {
  accion: Accion;
  clientes: OpcionClientePago[];
  cliente: OpcionClientePago | null;
  prestamos: PrestamoParaCobro[];
  saldoFavor: string;
  /** Parte del saldo a favor que se puede aplicar ya (el efectivo convertido a medias espera). */
  saldoAplicable: string;
  hoy: Fecha;
}) {
  const router = useRouter();
  const [estado, enviar, pendiente] = useActionState(accion, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmando, setConfirmando] = useState(false);

  const [v, setV] = useState({ tipo: "transferencia" as Tipo, ars: "", tcSalida: "", fecha: hoy, metodo: "", notas: "" });
  /** null = cascada FIFO automática; si no, montos editados a mano por clave de deuda. */
  const [manual, setManual] = useState<Record<string, string> | null>(null);
  const [usarSaldo, setUsarSaldo] = useState(false);
  const [descuentos, setDescuentos] = useState<Record<string, string>>({});
  const [motivoDescuento, setMotivoDescuento] = useState("");

  const [corregidos, setCorregidos] = useState({ de: estado, campos: new Set<CamposPago>() });
  if (corregidos.de !== estado) setCorregidos({ de: estado, campos: new Set() });
  const corregir = (c: CamposPago) =>
    setCorregidos((prev) => (prev.campos.has(c) ? prev : { de: prev.de, campos: new Set(prev.campos).add(c) }));
  const err = (c: CamposPago) => (corregidos.campos.has(c) ? undefined : estado.errores?.[c]);
  const set = (campo: keyof typeof v) => (valor: string) => {
    setV((prev) => ({ ...prev, [campo]: valor }));
    corregir(campo);
    if (campo === "ars" || campo === "fecha") corregir("montos");
  };

  const fecha = FECHA_OK.test(v.fecha) ? v.fecha : hoy;
  const ars = parsearDecimal(v.ars);
  const tc = v.tipo === "transferencia" ? parsearDecimal(v.tcSalida) : null;
  const tcOk = tc && tc.gt(0) ? tc : null;

  const { deudas: brutas, moraNueva } = useMemo(() => deudasAFecha(prestamos, fecha), [prestamos, fecha]);

  // Descuentos por fila: los válidos bajan la deuda; uno inválido bloquea el envío.
  const descuentoDe = new Map<string, Decimal | null>(
    brutas.map((d) => [d.clave, descuentos[d.clave]?.trim() ? parsearDecimal(descuentos[d.clave]!) : cero]),
  );
  const descuentoInvalido = (d: Deuda) => {
    const x = descuentoDe.get(d.clave);
    return x === null || x === undefined || x.lt(0) || x.decimalPlaces() > 2 || x.gt(d.mora.plus(d.interes));
  };
  const { deudas } = aplicarDescuentos(
    brutas,
    new Map(brutas.flatMap((d) => (descuentoInvalido(d) ? [] : [[d.clave, descuentoDe.get(d.clave)!] as const]))),
  );
  const totalDescuento = brutas.reduce((s, d) => s.plus(descuentoInvalido(d) ? 0 : descuentoDe.get(d.clave)!), cero);
  const hayDescuento = totalDescuento.gt(0);
  const descuentosInvalidos = brutas.some(descuentoInvalido);

  const saldoUsable = usarSaldo ? new Decimal(saldoAplicable) : cero;
  const recibido = ars && ars.gt(0) ? ars : cero;
  const disponible = recibido.plus(saldoUsable);
  const fifo = distribuirFifo(disponible, deudas);

  const montos = new Map<string, Decimal | null>(
    deudas.map((d) => [d.clave, manual ? (manual[d.clave]?.trim() ? parsearDecimal(manual[d.clave]!) : cero) : fifo.get(d.clave)!]),
  );

  const deudaTotal = brutas.reduce((s, d) => s.plus(d.total), cero);
  const imputado = [...montos.values()].reduce<Decimal>((s, m) => s.plus(m ?? 0), cero);
  const sobrante = disponible.minus(imputado);
  const saldoAplicado = Decimal.min(saldoUsable, imputado);
  const filaInvalida = deudas.some((d) => {
    const m = montos.get(d.clave);
    return m === null || m!.lt(0) || m!.gt(d.total) || m!.decimalPlaces() > 2;
  });
  const excedido = sobrante.lt(0);
  const usdt = (x: Decimal) => (tcOk ? redondearUsdt(x.div(tcOk)) : null);
  // Con saldo a favor, cada parte se valúa al TC de su pago de origen: no hay un único equivalente.
  const usdtImputado = saldoAplicado.gt(0) ? () => null : usdt;
  const atrasoMax = deudas.reduce((max, d) => Math.max(max, diasEntre(d.vencimiento, fecha)), 0);
  const cancelados = new Set(
    prestamos
      .filter((p) => {
        const ds = deudas.filter((d) => d.prestamoId === p.id);
        return ds.length > 0 && ds.every((d) => montos.get(d.clave)?.eq(d.total) || d.total.isZero());
      })
      .map((p) => p.id),
  );

  const aJson = (valores: Map<string, Decimal | null>) =>
    JSON.stringify(
      Object.fromEntries(
        deudas.flatMap((d) => {
          const m = valores.get(d.clave);
          return m && m.gt(0) ? [[d.clave, m.toFixed(2)]] : [];
        }),
      ),
    );
  const montosJson = aJson(montos);
  const descuentosJson = aJson(descuentoDe);

  const editar = (clave: string, texto: string) => {
    setManual((prev) => {
      const base = prev ?? Object.fromEntries(deudas.map((d) => [d.clave, aTexto(fifo.get(d.clave)!)]));
      return { ...base, [clave]: texto };
    });
    corregir("montos");
  };

  const editarDescuento = (clave: string, texto: string) => {
    setDescuentos((prev) => ({ ...prev, [clave]: texto }));
    corregir("descuentos");
  };

  const cobroOk = recibido.gt(0) ? v.tipo === "efectivo" || !!tcOk : saldoAplicado.gt(0);
  const listo =
    !!cliente && cobroOk && !filaInvalida && !excedido && !descuentosInvalidos && (!hayDescuento || !!motivoDescuento.trim());
  const pedirConfirmacion = () => (listo ? setConfirmando(true) : formRef.current?.requestSubmit());

  return (
    <form ref={formRef} action={enviar} noValidate className="flex flex-col gap-margin">
      <input type="hidden" name="clienteId" value={cliente?.value ?? ""} />
      <input type="hidden" name="tipo" value={v.tipo} />
      <input type="hidden" name="montos" value={montosJson} />
      <input type="hidden" name="descuentos" value={descuentosJson} />
      <input type="hidden" name="usarSaldo" value={usarSaldo ? "on" : ""} />
      {v.tipo === "efectivo" && <input type="hidden" name="tcSalida" value="" />}

      <div className="flex flex-wrap items-center gap-margin">
        <Link
          href="/prestamos"
          aria-label="Volver a préstamos"
          className="flex size-9 items-center justify-center rounded-lg bg-surface-container-low text-on-surface hover:bg-surface-container"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <div className="flex flex-col">
          <span className="text-label-caps text-primary uppercase">Cobranza</span>
          <h1 className="text-headline-xl text-on-surface">Registrar pago</h1>
        </div>
        <Button type="button" className="ml-auto h-9 gap-space-sm px-margin" onClick={pedirConfirmacion} disabled={pendiente}>
          <CircleCheck aria-hidden />
          {pendiente ? "Registrando…" : "Confirmar e imputar"}
        </Button>
      </div>

      {estado.error && <Alerta>{estado.error}</Alerta>}

      <div className="grid grid-cols-1 items-start gap-margin xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <fieldset disabled={pendiente} className="flex min-w-0 flex-col gap-margin">
          <Panel icono={<UserRound aria-hidden />} titulo="Cliente">
            <Campo id="cliente" etiqueta="Cliente que paga" error={err("clienteId")}>
              <Combobox
                items={clientes}
                value={cliente}
                onValueChange={(c: OpcionClientePago | null) => router.push(c ? `/pagos/nuevo?cliente=${c.value}` : "/pagos/nuevo")}
                filter={filtrarCliente}
                isItemEqualToValue={(a: OpcionClientePago, b: OpcionClientePago) => a.value === b.value}
              >
                <ComboboxInput id="cliente" placeholder="Buscá por nombre o DNI/CUIT…" className="w-full" aria-invalid={!!err("clienteId")} />
                <ComboboxContent>
                  <ComboboxEmpty>No hay clientes que coincidan.</ComboboxEmpty>
                  <ComboboxList>
                    {(item: OpcionClientePago) => (
                      <ComboboxItem key={item.value} value={item}>
                        <span className="flex-1 truncate">{item.label}</span>
                        <span className="font-mono text-data-cell text-on-surface-variant tabular-nums">
                          {item.documento}
                          {item.vigentes > 0 && ` · ${item.vigentes} vig.`}
                        </span>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </Campo>

            {cliente && (
              <div className="flex flex-wrap items-center gap-margin rounded-lg bg-surface-container-low p-space-md">
                <div className="flex min-w-0 flex-col">
                  <span className="text-headline-sm text-on-surface">{cliente.label}</span>
                  {cliente.documento && <span className="font-mono text-data-cell text-on-surface-variant tabular-nums">{cliente.documento}</span>}
                  {new Decimal(saldoFavor).gt(0) && (
                    <span className="text-body-sm text-tertiary">
                      Tiene <span className="font-mono tabular-nums">${formatearArs(saldoFavor)}</span> de saldo a favor
                    </span>
                  )}
                  {new Decimal(saldoAplicable).gt(0) && brutas.length > 0 && (
                    <label className="mt-space-xs flex cursor-pointer items-center gap-space-sm text-body-md text-on-surface">
                      <Switch
                        checked={usarSaldo}
                        onCheckedChange={(c) => {
                          setUsarSaldo(c);
                          corregir("ars");
                          corregir("montos");
                        }}
                        aria-label="Aplicar saldo a favor"
                      />
                      Aplicar saldo a favor a la deuda
                      {!new Decimal(saldoAplicable).eq(saldoFavor) && (
                        <span className="font-mono text-body-sm text-on-surface-variant tabular-nums">
                          (${formatearArs(saldoAplicable)} disponibles)
                        </span>
                      )}
                    </label>
                  )}
                </div>
                <div className="ml-auto flex flex-col items-end gap-space-2xs">
                  {atrasoMax > 0 && <BadgeRiesgo nivel="rojo">En mora · {atrasoMax} días</BadgeRiesgo>}
                  <span className="text-label-caps text-on-surface-variant uppercase">Deuda exigible al {formatearFecha(fecha)}</span>
                  <span className={cn("font-mono text-headline-lg tabular-nums", atrasoMax > 0 ? "text-error" : "text-on-surface")}>
                    ${formatearArs(deudaTotal)}
                  </span>
                </div>
              </div>
            )}
          </Panel>

          <Panel icono={<HandCoins aria-hidden />} titulo="Medio de cobro">
            <div role="radiogroup" aria-label="Medio de cobro" className="grid grid-cols-2 gap-space-2xs rounded-lg bg-surface-container-low p-space-2xs">
              {(
                [
                  ["transferencia", "Transferencia", <Landmark key="t" aria-hidden />],
                  ["efectivo", "Efectivo", <Banknote key="e" aria-hidden />],
                ] as const
              ).map(([t, etiqueta, icono]) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={v.tipo === t}
                  onClick={() => {
                    set("tipo")(t);
                    corregir("tcSalida");
                  }}
                  className={cn(
                    "flex h-9 items-center justify-center gap-space-sm rounded-lg text-label-caps uppercase transition-colors [&_svg]:size-4",
                    v.tipo === t ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-container",
                  )}
                >
                  {icono}
                  {etiqueta}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-margin md:grid-cols-3">
              <Campo
                id="ars"
                etiqueta="Monto cobrado (ARS)"
                error={err("ars")}
                ayuda={usarSaldo ? "Vacío si solo aplicás saldo a favor." : undefined}
              >
                <EntradaNumero id="ars" valor={v.ars} onChange={set("ars")} prefijo="$" error={!!err("ars")} />
              </Campo>
              {v.tipo === "transferencia" ? (
                <Campo id="tcSalida" etiqueta="TC liquidación (ARS / USDT)" error={err("tcSalida")} ayuda="TC neto del proveedor.">
                  <EntradaNumero id="tcSalida" valor={v.tcSalida} onChange={set("tcSalida")} error={!!err("tcSalida")} />
                </Campo>
              ) : (
                <div className="flex flex-col gap-space-xs">
                  <span className="text-body-md font-medium text-on-surface">TC liquidación</span>
                  <p className="rounded-lg bg-surface-container-low px-space-md py-space-sm text-body-sm text-on-surface-variant">
                    Se fija al convertir el efectivo a USDT. Hasta entonces no hay ganancia realizada.
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-space-xs">
                <span className="text-body-md font-medium text-on-surface">Equivalente USDT</span>
                <span className="flex h-8 items-center justify-end rounded-lg bg-primary-fixed px-space-md font-mono text-data-currency-primary text-on-primary-fixed-variant tabular-nums">
                  {usdt(recibido) && recibido.gt(0) ? `${formatearUsdt(usdt(recibido)!)} USDT` : "—"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-margin md:grid-cols-3">
              <Campo id="fecha" etiqueta="Fecha del pago" error={err("fecha")}>
                <Input
                  id="fecha"
                  name="fecha"
                  type="date"
                  max={hoy}
                  value={v.fecha}
                  onChange={(e) => {
                    set("fecha")(e.target.value);
                    setManual(null);
                  }}
                  className="font-mono tabular-nums"
                  aria-invalid={!!err("fecha")}
                />
              </Campo>
              <div className="md:col-span-2">
                <Campo id="metodo" etiqueta="Medio / referencia" error={err("metodo")} ayuda="Banco, billetera o N° de operación.">
                  <Input id="metodo" name="metodo" value={v.metodo} onChange={(e) => set("metodo")(e.target.value)} autoComplete="off" />
                </Campo>
              </div>
            </div>
            <Campo id="notas" etiqueta="Notas internas" error={err("notas")}>
              <Textarea id="notas" name="notas" value={v.notas} onChange={(e) => set("notas")(e.target.value)} rows={2} />
            </Campo>
          </Panel>
        </fieldset>

        <aside className="flex min-w-0 flex-col gap-margin xl:sticky xl:top-16">
          <Conciliacion
            recibido={recibido}
            saldoAplicado={saldoAplicado}
            descuento={totalDescuento}
            imputado={imputado}
            sobrante={sobrante}
            usdt={usdt}
            usdtImputado={usdtImputado}
            efectivo={v.tipo === "efectivo"}
          />
        </aside>
      </div>

      <section className="flex flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
        <div className="flex flex-wrap items-center gap-margin border-b border-outline-variant px-margin-panel py-space-md">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-headline-sm text-on-surface">Distribución del pago</h2>
            <p className="text-body-md text-on-surface-variant">
              Cascada por vencimiento más viejo: en cada cuota, mora → interés → capital. Podés ajustar los montos a mano
              y cargar un descuento (baja la mora y el interés, no el capital).
            </p>
          </div>
          <Button type="button" variant="secondary" className="ml-auto gap-space-sm" onClick={() => setManual(null)} disabled={!manual}>
            <Sparkles aria-hidden />
            Aplicar cascada (FIFO)
          </Button>
        </div>
        {(err("montos") || err("descuentos")) && (
          <p className="px-margin-panel pt-space-sm text-body-sm text-error">{err("montos") ?? err("descuentos")}</p>
        )}
        <TablaDistribucion
          brutas={brutas}
          deudas={deudas}
          descuentos={descuentos}
          descuentoInvalido={descuentoInvalido}
          onEditarDescuento={editarDescuento}
          montos={montos}
          manual={manual}
          fifo={fifo}
          fecha={fecha}
          usdt={usdtImputado}
          sobrante={sobrante}
          onEditar={editar}
          sinCliente={!cliente}
          deshabilitado={pendiente}
        />
        {hayDescuento && (
          <div className="border-t border-outline-variant px-margin-panel py-space-md">
            <Campo
              id="motivoDescuento"
              etiqueta={`Motivo del descuento ($${formatearArs(totalDescuento)})`}
              error={err("motivoDescuento") ?? (motivoDescuento.trim() ? undefined : "Obligatorio: queda en la ficha del préstamo.")}
            >
              <Input
                id="motivoDescuento"
                name="motivoDescuento"
                value={motivoDescuento}
                onChange={(e) => {
                  setMotivoDescuento(e.target.value);
                  corregir("motivoDescuento");
                }}
                placeholder="Ej.: pago adelantado"
                autoComplete="off"
                maxLength={200}
              />
            </Campo>
          </div>
        )}
        {moraNueva.length > 0 && (
          <p className="border-t border-outline-variant bg-riesgo-rojo-bg/40 px-margin-panel py-space-sm text-body-sm text-riesgo-rojo-fg">
            Con este pago se carga la mora de{" "}
            {moraNueva.map((m, i) => (
              <span key={m.cuotaId}>
                {i > 0 && ", "}
                <span className="font-mono tabular-nums">
                  {numeroPrestamo(prestamos.find((p) => p.id === m.prestamoId)!.numero)} cuota {m.cuotaNumero} (${formatearArs(m.ars)})
                </span>
              </span>
            ))}
            : el atraso superó los días de gracia.
          </p>
        )}
      </section>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent className="rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmá el pago</AlertDialogTitle>
            <AlertDialogDescription render={<div />}>
              {cliente && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-margin gap-y-space-xs text-body-md">
                  <dt className="text-on-surface-variant">Cliente</dt>
                  <dd className="text-on-surface">{cliente.label}</dd>
                  <dt className="text-on-surface-variant">Cobrado</dt>
                  <dd className="font-mono text-on-surface tabular-nums">
                    {recibido.gt(0)
                      ? `$${formatearArs(recibido)} · ${v.tipo === "efectivo" ? "efectivo" : `TC ${v.tcSalida} = ${formatearUsdt(usdt(recibido) ?? 0)} USDT`}`
                      : "Sin pago nuevo"}
                  </dd>
                  {saldoAplicado.gt(0) && (
                    <>
                      <dt className="text-on-surface-variant">Saldo a favor aplicado</dt>
                      <dd className="font-mono text-on-surface tabular-nums">${formatearArs(saldoAplicado)}</dd>
                    </>
                  )}
                  {hayDescuento && (
                    <>
                      <dt className="text-on-surface-variant">Descuento</dt>
                      <dd className="text-on-surface">
                        <span className="font-mono tabular-nums">${formatearArs(totalDescuento)}</span> · {motivoDescuento.trim()}
                      </dd>
                    </>
                  )}
                  <dt className="text-on-surface-variant">Fecha</dt>
                  <dd className="font-mono text-on-surface tabular-nums">{formatearFecha(fecha)}</dd>
                  <dt className="text-on-surface-variant">Imputado</dt>
                  <dd className="font-mono text-on-surface tabular-nums">
                    ${formatearArs(imputado)} en {[...montos.values()].filter((m) => m?.gt(0)).length} cuota(s)
                  </dd>
                  {sobrante.gt(0) && (
                    <>
                      <dt className="text-on-surface-variant">Saldo a favor</dt>
                      <dd className="font-mono text-tertiary tabular-nums">${formatearArs(sobrante)}</dd>
                    </>
                  )}
                  {cancelados.size > 0 && (
                    <>
                      <dt className="text-on-surface-variant">Se cancela</dt>
                      <dd className="font-mono text-on-surface tabular-nums">
                        {prestamos.filter((p) => cancelados.has(p.id)).map((p) => numeroPrestamo(p.numero)).join(", ")}
                      </dd>
                    </>
                  )}
                </dl>
              )}
              <p className="mt-space-md text-body-sm text-on-surface-variant">
                {recibido.gt(0) ? "El pago no se edita: un error se corrige anulándolo." : "La aplicación no se edita: un error se corrige anulándola."}
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
              {recibido.gt(0) ? "Registrar pago" : "Aplicar saldo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

function Conciliacion({
  recibido,
  saldoAplicado,
  descuento,
  imputado,
  sobrante,
  usdt,
  usdtImputado,
  efectivo,
}: {
  recibido: Decimal;
  saldoAplicado: Decimal;
  descuento: Decimal;
  imputado: Decimal;
  sobrante: Decimal;
  usdt: (x: Decimal) => Decimal | null;
  usdtImputado: (x: Decimal) => Decimal | null;
  efectivo: boolean;
}) {
  const fila = (etiqueta: string, ars: Decimal, clase?: string, aUsdt: (x: Decimal) => Decimal | null = usdtImputado) => (
    <div className="flex items-baseline justify-between gap-space-md">
      <span className="text-label-caps text-on-surface-variant uppercase">{etiqueta}</span>
      <span className="flex flex-col items-end font-mono tabular-nums">
        <span className={cn("text-data-currency-primary", clase)}>${formatearArs(ars)}</span>
        {aUsdt(ars) && <span className="text-data-currency-secondary text-on-surface-variant">{formatearUsdt(aUsdt(ars)!)} USDT</span>}
      </span>
    </div>
  );
  return (
    <section className="flex flex-col gap-space-md rounded-lg border border-outline-variant bg-surface-container-lowest p-margin-panel">
      <div className="flex items-center gap-space-sm">
        <Scale className="size-4 text-primary" aria-hidden />
        <h2 className="text-label-caps text-on-surface uppercase">Conciliación</h2>
      </div>
      {fila("1. Total recibido", recibido, undefined, usdt)}
      {saldoAplicado.gt(0) && fila("+ Saldo a favor aplicado", saldoAplicado, "text-tertiary", () => null)}
      {descuento.gt(0) && fila("Descuento otorgado", descuento, "text-on-surface-variant", () => null)}
      {fila("2. Total imputado", imputado)}
      <div className="border-t border-outline-variant pt-space-md">
        {sobrante.lt(0) ? (
          <p className="rounded-lg border border-riesgo-rojo-borde bg-riesgo-rojo-bg px-space-md py-space-sm font-mono text-data-cell text-riesgo-rojo-fg tabular-nums">
            Imputaste ${formatearArs(sobrante.abs())} de más
          </p>
        ) : sobrante.gt(0) ? (
          fila("3. Saldo a favor", sobrante, "text-tertiary")
        ) : (
          <p className="flex items-center gap-space-sm rounded-lg bg-riesgo-verde-bg px-space-md py-space-sm font-mono text-badge-label text-riesgo-verde-fg uppercase">
            <CircleCheck className="size-4" aria-hidden />
            $0,00 de diferencia · cuadrado
          </p>
        )}
      </div>
      <p className="text-body-sm text-on-surface-variant">
        {efectivo
          ? "En efectivo entra a la caja de efectivo en ARS; el recupero en USDT y la ganancia se registran al convertir."
          : "El USDT recupera primero el costo de cada préstamo; recién lo que lo supera es ganancia."}
      </p>
    </section>
  );
}

function TablaDistribucion({
  brutas,
  deudas,
  descuentos,
  descuentoInvalido,
  onEditarDescuento,
  montos,
  manual,
  fifo,
  fecha,
  usdt,
  sobrante,
  onEditar,
  sinCliente,
  deshabilitado,
}: {
  /** Deuda antes de descuentos (lo exigible). */
  brutas: Deuda[];
  /** Deuda con los descuentos aplicados (lo que se imputa). */
  deudas: Deuda[];
  descuentos: Record<string, string>;
  descuentoInvalido: (d: Deuda) => boolean;
  onEditarDescuento: (clave: string, texto: string) => void;
  montos: Map<string, Decimal | null>;
  manual: Record<string, string> | null;
  fifo: Map<string, Decimal>;
  fecha: Fecha;
  usdt: (x: Decimal) => Decimal | null;
  sobrante: Decimal;
  onEditar: (clave: string, texto: string) => void;
  sinCliente: boolean;
  deshabilitado: boolean;
}) {
  const th = "px-space-md py-space-sm text-label-caps text-on-surface-variant uppercase whitespace-nowrap";
  const td = "px-space-md py-space-sm font-mono text-data-cell tabular-nums whitespace-nowrap";

  if (deudas.length === 0) {
    return (
      <p className="px-margin-panel py-margin text-center text-body-md text-on-surface-variant">
        {sinCliente ? "Elegí un cliente para ver su deuda." : "El cliente no tiene deuda vigente: todo el pago queda como saldo a favor."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead className="border-b border-outline-variant bg-surface-container-low">
          <tr>
            <th className={cn(th, "text-left")}>Préstamo</th>
            <th className={cn(th, "text-left")}>Cuota</th>
            <th className={cn(th, "text-left")}>Vencimiento</th>
            <th className={cn(th, "text-right")}>Exigible ARS</th>
            <th className={cn(th, "text-right")}>Exigible USDT</th>
            <th className={cn(th, "text-right")}>Descuento ARS</th>
            <th className={cn(th, "text-right")}>A imputar ARS</th>
            <th className={cn(th, "text-right")}>Imputado USDT</th>
            <th className={cn(th, "text-left")}>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {brutas.map((bruta, i) => {
            const d = deudas[i]!;
            const atraso = diasEntre(d.vencimiento, fecha);
            const monto = montos.get(d.clave) ?? null;
            const invalido = monto === null || monto.lt(0) || monto.gt(d.total) || monto.decimalPlaces() > 2;
            const texto = manual ? (manual[d.clave] ?? "") : aTexto(fifo.get(d.clave)!);
            return (
              <tr key={d.clave} className={cn("border-b border-outline-variant/60 last:border-b-0", atraso > 0 && "bg-riesgo-rojo-bg/30")}>
                <td className={cn(td, "font-semibold text-primary")}>{numeroPrestamo(d.prestamoNumero)}</td>
                <td className={td}>{d.cuotaNumero !== null ? `${d.cuotaNumero}/${d.nCuotas}` : <span className="font-sans">Cargos</span>}</td>
                <td className={td}>
                  <span className={cn(atraso > 0 && "text-error")}>{formatearFecha(d.vencimiento)}</span>
                  <span className={cn("block font-sans text-badge-label uppercase", atraso > 0 ? "text-error" : "text-on-surface-variant")}>
                    {atraso > 0 ? `Atraso +${atraso}d` : atraso === 0 ? "Vence hoy" : `Vence en ${-atraso} días`}
                  </span>
                </td>
                <td className={cn(td, "text-right")}>
                  <span className="font-semibold">${formatearArs(bruta.total)}</span>
                  <span className="block text-badge-label text-on-surface-variant">
                    {[
                      bruta.mora.gt(0) && `mora ${formatearArs(bruta.mora)}`,
                      bruta.interes.gt(0) && `int ${formatearArs(bruta.interes)}`,
                      bruta.capital.gt(0) && `cap ${formatearArs(bruta.capital)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </td>
                <td className={cn(td, "text-right text-on-surface-variant")}>{usdt(bruta.total) ? formatearUsdt(usdt(bruta.total)!) : "—"}</td>
                <td className="px-space-md py-space-xs">
                  <Input
                    value={descuentos[d.clave] ?? ""}
                    onChange={(e) => onEditarDescuento(d.clave, e.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    disabled={deshabilitado || bruta.mora.plus(bruta.interes).isZero()}
                    title={`Hasta $${formatearArs(bruta.mora.plus(bruta.interes))} (mora + interés)`}
                    aria-label={`Descuento a ${numeroPrestamo(d.prestamoNumero)} cuota ${d.cuotaNumero ?? "cargos"}`}
                    aria-invalid={descuentoInvalido(bruta)}
                    className="ml-auto w-28 text-right font-mono tabular-nums"
                  />
                </td>
                <td className="px-space-md py-space-xs">
                  <Input
                    value={texto}
                    onChange={(e) => onEditar(d.clave, e.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    disabled={deshabilitado}
                    aria-label={`Monto a imputar a ${numeroPrestamo(d.prestamoNumero)} cuota ${d.cuotaNumero ?? "cargos"}`}
                    aria-invalid={invalido}
                    className="ml-auto w-36 text-right font-mono tabular-nums"
                  />
                </td>
                <td className={cn(td, "text-right text-primary")}>{monto && usdt(monto) && monto.gt(0) ? formatearUsdt(usdt(monto)!) : "—"}</td>
                <td className="px-space-md py-space-sm">
                  <Resultado deuda={d} monto={monto} invalido={invalido} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t border-outline-variant bg-surface-container-low">
          <tr>
            <td colSpan={6} className="px-space-md py-space-sm text-body-md font-medium text-on-surface">
              Remanente: saldo a favor del cliente
            </td>
            <td className={cn(td, "text-right font-semibold", sobrante.gt(0) ? "text-tertiary" : sobrante.lt(0) ? "text-error" : "")}>
              ${formatearArs(sobrante)}
            </td>
            <td className={cn(td, "text-right")}>{usdt(sobrante.abs()) && !sobrante.isZero() ? formatearUsdt(usdt(sobrante)!) : "—"}</td>
            <td className="px-space-md py-space-sm text-label-caps text-on-surface-variant uppercase">
              {sobrante.gt(0) ? "Queda a favor" : sobrante.lt(0) ? "Excedido" : "Sin excedente"}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Resultado({ deuda, monto, invalido }: { deuda: Deuda; monto: Decimal | null; invalido: boolean }) {
  const base = "inline-flex items-center rounded-full border px-space-sm py-space-2xs font-mono text-badge-label uppercase whitespace-nowrap";
  if (invalido) {
    return (
      <span className={cn(base, "border-riesgo-rojo-borde bg-riesgo-rojo-bg text-riesgo-rojo-fg")}>
        {monto === null ? "Monto inválido" : monto.gt(deuda.total) ? "Supera la deuda" : "Revisá el monto"}
      </span>
    );
  }
  if (deuda.total.isZero() && (!monto || monto.isZero())) {
    return <span className={cn(base, "border-riesgo-verde-borde bg-riesgo-verde-bg text-riesgo-verde-fg")}>Cancela con descuento</span>;
  }
  if (!monto || monto.isZero()) return <span className="text-body-sm text-on-surface-variant">Sin imputar</span>;
  if (monto.eq(deuda.total)) {
    return <span className={cn(base, "border-riesgo-verde-borde bg-riesgo-verde-bg text-riesgo-verde-fg")}>Cancela cuota</span>;
  }
  const pct = monto.div(deuda.total).times(100).toFixed(1).replace(".", ",");
  return <span className={cn(base, "border-outline-variant bg-surface-container text-on-surface-variant")}>Parcial ({pct}%)</span>;
}
