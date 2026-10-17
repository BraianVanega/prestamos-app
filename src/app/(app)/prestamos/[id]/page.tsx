import Decimal from "decimal.js";
import { ArrowLeft, Ban, CalendarDays, History, PencilLine, ReceiptText, SlidersHorizontal, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotonAnular } from "@/components/app/boton-anular";
import { BadgeRiesgo, BarraProgreso, COLORES_RIESGO } from "@/components/app/riesgo";
import { buttonVariants } from "@/components/ui/button";
import { cargarFichaPrestamo, type CargoFicha, type EventoFicha, type FichaPrestamo } from "@/db/ficha-prestamo";
import { atrasoPctDelPlazo, nivelRiesgo, type CuotaEstado } from "@/engine/estado-prestamo";
import { formatearDocumento, formatearFecha, formatearFechaHora } from "@/lib/formato";
import { hoyArgentina } from "@/lib/hoy";
import { formatearArs, formatearPct, formatearTc, formatearUsdt } from "@/lib/numeros";
import { FRECUENCIAS, numeroPrestamo } from "@/lib/prestamos";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/prestamos/[id]">): Promise<Metadata> {
  const ficha = await cargarFichaPrestamo((await params).id, hoyArgentina());
  return { title: `${ficha ? numeroPrestamo(ficha.prestamo.numero) : "Préstamo"} · Cierre & Reparto` };
}

const ESTADOS_PRESTAMO = {
  vigente: { etiqueta: "Vigente", clase: "border-success/25 bg-success-soft text-success" },
  cancelado: { etiqueta: "Cancelado", clase: "border-border bg-accent text-muted-foreground" },
  castigado: { etiqueta: "Castigado", clase: "border-danger/25 bg-danger-soft text-danger" },
  refinanciado: { etiqueta: "Refinanciado", clase: "border-border bg-accent text-muted-foreground" },
  anulado: { etiqueta: "Anulado", clase: "border-danger/25 bg-danger-soft text-danger" },
} as const;

const TIPOS_EVENTO: Record<EventoFicha["tipo"], string> = {
  apertura: "Saldo de apertura",
  aporte: "Aporte",
  desembolso: "Desembolso",
  cobro: "Cobro",
  conversion: "Conversión",
  reconocimiento_ganancia: "Ganancia reconocida",
  perdida: "Pérdida",
  aplicacion_saldo_favor: "Saldo a favor aplicado",
  retiro: "Pago a tercero",
  anulacion: "Anulación",
};

const TIPOS_CARGO: Record<CargoFicha["tipo"], string> = { mora: "Mora", descuento: "Descuento", ajuste: "Ajuste" };

const pctDe = (parte: Decimal, total: Decimal) => (total.isZero() ? new Decimal(0) : parte.div(total).times(100));
const cuotaN = (n: number) => `#${String(n).padStart(2, "0")}`;

function Etiqueta({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("text-label text-muted-foreground", className)}>{children}</span>;
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border border-border bg-card", className)}>{children}</div>;
}

function Usdt({ valor, className }: { valor: Decimal; className?: string }) {
  return (
    <span className="font-mono tabular-nums">
      <span className={cn("text-headline-lg", className)}>{formatearUsdt(valor)}</span>{" "}
      <span className="text-data-currency-secondary text-usdt">USDT</span>
    </span>
  );
}

export default async function PrestamoPage({ params }: PageProps<"/prestamos/[id]">) {
  const { id } = await params;
  const hoy = hoyArgentina();
  const f = await cargarFichaPrestamo(id, hoy);
  if (!f) notFound();
  const { prestamo: p, cliente, plan } = f;

  const usdtPrestado = new Decimal(p.usdtPrestado);
  const arsCapital = new Decimal(p.arsCapital);
  const arsInteres = new Decimal(p.arsInteresPactado);
  const pctRecuperado = pctDe(f.recuperadoUsdt, usdtPrestado);
  const restantes = plan.cuotas.length - plan.cuotasPagadas;
  const vigente = p.estado === "vigente";
  const anulado = p.estado === "anulado";

  return (
    <section className="flex flex-col gap-margin">
      <div className="flex flex-wrap items-center gap-gutter-compact">
        <Link href="/prestamos" className="flex items-center gap-space-xs text-body-md text-muted-foreground hover:text-link">
          <ArrowLeft className="size-4" aria-hidden />
          Préstamos
        </Link>
        <span className="text-muted-foreground" aria-hidden>
          /
        </span>
        <h1 className="font-mono text-headline-sm text-link tabular-nums">{numeroPrestamo(p.numero)}</h1>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-space-sm py-space-2xs font-mono text-badge-label",
            ESTADOS_PRESTAMO[p.estado].clase,
          )}
        >
          {ESTADOS_PRESTAMO[p.estado].etiqueta}
        </span>
        {vigente && plan.diasAtraso > 0 && (
          <BadgeRiesgo nivel={f.riesgo}>
            En mora · +{plan.diasAtraso} días ({formatearPct(atrasoPctDelPlazo(plan.diasAtraso, f.diasPlazo))}% del plazo)
          </BadgeRiesgo>
        )}
        {vigente && plan.diasAtraso === 0 && plan.proxima && <BadgeRiesgo nivel="verde">Al día</BadgeRiesgo>}
        {(vigente || p.estado === "cancelado") && (
          <div className="ml-auto flex flex-wrap gap-space-sm">
            <Link href={`/prestamos/${p.id}/editar`} className={cn(buttonVariants({ variant: vigente ? "outline" : "default" }), "gap-space-sm")}>
              <PencilLine aria-hidden />
              Editar
            </Link>
            {vigente && (
              <Link href={`/pagos/nuevo?cliente=${cliente.id}`} className={cn(buttonVariants(), "gap-space-sm")}>
                <Wallet aria-hidden />
                Registrar cobro
              </Link>
            )}
          </div>
        )}
      </div>

      {f.anulacion && (
        <div role="note" className="flex flex-wrap items-start gap-space-sm rounded-lg border border-danger/25 bg-danger-soft px-space-md py-space-sm text-body-md text-danger">
          <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            Anulado por edición el <span className="font-mono tabular-nums">{formatearFechaHora(f.anulacion.en)}</span> por{" "}
            {f.anulacion.usuario}: {f.anulacion.motivo}. Su desembolso se revirtió y no cuenta en caja ni en cartera; sus cobros se reimputaron al préstamo nuevo.
            {f.anulacion.reemplazo && (
              <>
                {" "}
                Lo reemplaza{" "}
                <Link href={`/prestamos/${f.anulacion.reemplazo.id}`} className="font-mono font-semibold tabular-nums underline">
                  {numeroPrestamo(f.anulacion.reemplazo.numero)}
                </Link>
                .
              </>
            )}
          </p>
        </div>
      )}
      {f.corrigeA && (
        <p className="flex items-center gap-space-sm text-body-md text-muted-foreground">
          <PencilLine className="size-4 shrink-0" aria-hidden />
          <span>
            Reemplaza a{" "}
            <Link href={`/prestamos/${f.corrigeA.id}`} className="font-mono text-link tabular-nums hover:underline">
              {numeroPrestamo(f.corrigeA.numero)}
            </Link>
            , anulado al editarlo.
          </span>
        </p>
      )}

      <div className="grid gap-gutter-compact md:grid-cols-2 2xl:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))]">
        <TarjetaCliente f={f} />

        <Panel className="flex flex-col gap-space-sm p-space-md">
          <Etiqueta>Capital otorgado</Etiqueta>
          <Usdt valor={usdtPrestado} />
          <span className="font-mono text-data-cell text-muted-foreground tabular-nums">${formatearArs(arsCapital)} ARS</span>
          <Etiqueta className="mt-auto">
            TC entrada <span className="font-mono tabular-nums">${formatearTc(p.tcEntrada)}</span>
          </Etiqueta>
        </Panel>

        <Panel className="flex flex-col gap-space-sm p-space-md">
          <div className="flex items-baseline justify-between gap-space-sm">
            <Etiqueta>Total recuperado</Etiqueta>
            <span className={cn("font-mono text-data-cell font-semibold tabular-nums", COLORES_RIESGO[f.riesgo].texto)}>
              {pctRecuperado.toFixed(0)}%
            </span>
          </div>
          <Usdt valor={f.recuperadoUsdt} className={COLORES_RIESGO[f.riesgo].texto} />
          <span className="font-mono text-data-cell text-muted-foreground tabular-nums">${formatearArs(f.cobradoArs)} ARS cobrados</span>
          <div className="mt-auto">
            <BarraProgreso pct={pctRecuperado} nivel={f.riesgo} />
          </div>
        </Panel>

        <Panel className="flex flex-col gap-space-sm p-space-md">
          <Etiqueta>Rendimiento neto</Etiqueta>
          <Usdt valor={f.gananciaUsdt} className={f.gananciaUsdt.gt(0) ? "text-success" : undefined} />
          <span className="text-body-sm text-muted-foreground">
            {f.gananciaUsdt.gt(0) ? "Ganancia reconocida" : "Se reconoce al recuperar el costo en USDT"}
          </span>
          <div className="mt-auto flex flex-wrap gap-x-space-md gap-y-space-2xs">
            {f.titulares.map((t) => (
              <span key={t.id} className="font-mono text-data-cell text-muted-foreground tabular-nums">
                {t.nombre}: {formatearUsdt(t.gananciaUsdt)}
              </span>
            ))}
          </div>
        </Panel>

        <Panel className="flex flex-col gap-space-sm p-space-md">
          <Etiqueta>Saldo exigible</Etiqueta>
          {anulado ? (
            <>
              <span className="font-mono tabular-nums">
                <span className="text-headline-lg">$0,00</span>{" "}
                <span className="text-data-currency-secondary text-muted-foreground">ARS</span>
              </span>
              <Etiqueta className="mt-auto">Préstamo anulado: no hay deuda</Etiqueta>
            </>
          ) : (
            <>
              <span className="font-mono tabular-nums">
                <span className="text-headline-lg">${formatearArs(f.saldo.total)}</span>{" "}
                <span className="text-data-currency-secondary text-muted-foreground">ARS</span>
              </span>
              <dl className="grid grid-cols-[1fr_auto] gap-x-space-sm font-mono text-data-cell text-muted-foreground tabular-nums">
                <dt>Cuotas</dt>
                <dd className="text-right">${formatearArs(f.saldo.plan)}</dd>
                {!f.saldo.cargos.isZero() && (
                  <>
                    <dt>Cargos</dt>
                    <dd className="text-right">${formatearArs(f.saldo.cargos)}</dd>
                  </>
                )}
                {f.saldo.moraACargar.gt(0) && (
                  <>
                    <dt>Mora</dt>
                    <dd className="text-right text-danger">${formatearArs(f.saldo.moraACargar)}</dd>
                  </>
                )}
              </dl>
              <Etiqueta className={cn("mt-auto", restantes > 0 && plan.diasAtraso > 0 && "text-danger")}>
                {restantes === 0 ? "Plan cancelado" : restantes === 1 ? "1 cuota restante" : `${restantes} cuotas restantes`}
              </Etiqueta>
            </>
          )}
        </Panel>
      </div>

      <div className="grid items-start gap-gutter-compact xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex min-w-0 flex-col gap-gutter-compact">
          <Cronograma f={f} arsCapital={arsCapital} arsInteres={arsInteres} />
          <Cargos f={f} />
        </div>
        <div className="flex min-w-0 flex-col gap-gutter-compact">
          <Condiciones f={f} arsCapital={arsCapital} arsInteres={arsInteres} />
          <Historial eventos={f.historial} />
        </div>
      </div>
    </section>
  );
}

function TarjetaCliente({ f }: { f: FichaPrestamo }) {
  const { cliente, prestamo: p } = f;
  return (
    <Panel className="flex flex-col gap-space-md p-space-md md:col-span-2 2xl:col-span-1">
      <div className="flex flex-col">
        <Link href={`/clientes/${cliente.id}`} className="text-headline-sm text-foreground hover:text-link hover:underline">
          {cliente.nombre}
        </Link>
        {cliente.documento && (
          <span className="font-mono text-data-cell text-muted-foreground tabular-nums">{formatearDocumento(cliente.documento)}</span>
        )}
      </div>
      <div className="flex flex-col gap-space-xs rounded-lg bg-muted p-space-sm">
        <div className="flex items-baseline justify-between gap-space-sm">
          <Etiqueta>Estructura capital</Etiqueta>
          <span className="text-body-md font-medium text-foreground">{f.estructura}</span>
        </div>
        {f.titulares.map((t) => (
          <div key={t.id} className="flex items-baseline justify-between gap-space-sm font-mono text-data-cell tabular-nums">
            <span className="text-foreground">{t.nombre}</span>
            <span className="text-muted-foreground">
              {formatearPct(t.pctCapital)}% ({formatearUsdt(t.capitalUsdt)} USDT)
            </span>
          </div>
        ))}
      </div>
      <div className="mt-auto grid grid-cols-2 gap-space-sm">
        <div className="flex flex-col">
          <Etiqueta>Desembolso</Etiqueta>
          <span className="font-mono text-data-cell tabular-nums">{formatearFecha(p.fechaDesembolso)}</span>
        </div>
        <div className="flex flex-col">
          <Etiqueta>Vencimiento final</Etiqueta>
          <span className="font-mono text-data-cell tabular-nums">{formatearFecha(p.vencimientoFinal)}</span>
        </div>
      </div>
    </Panel>
  );
}

function SituacionCuota({ c, diasPlazo }: { c: CuotaEstado; diasPlazo: number }) {
  const base = "inline-flex items-center rounded-full border px-space-sm py-space-2xs font-mono text-badge-label whitespace-nowrap";
  switch (c.situacion) {
    case "pagada":
      return <span className={cn(base, COLORES_RIESGO.verde.badge)}>Pagada</span>;
    case "vencida":
      return <BadgeRiesgo nivel={nivelRiesgo(c.diasAtraso, diasPlazo)}>Vencida +{c.diasAtraso}d</BadgeRiesgo>;
    case "parcial":
      return <span className={cn(base, COLORES_RIESGO.amarillo.badge)}>Parcial</span>;
    case "pendiente":
      return <span className={cn(base, "border-border bg-muted text-muted-foreground")}>Pendiente</span>;
  }
}

function Cronograma({ f, arsCapital, arsInteres }: { f: FichaPrestamo; arsCapital: Decimal; arsInteres: Decimal }) {
  const { plan, prestamo: p } = f;
  const th = "px-space-sm py-space-sm text-label text-muted-foreground whitespace-nowrap";
  const td = "px-space-sm py-space-sm font-mono text-data-cell tabular-nums whitespace-nowrap";

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-space-sm border-b border-border bg-muted px-space-md py-space-sm">
        <CalendarDays className="size-5 text-link" aria-hidden />
        <h2 className="text-headline-sm text-foreground">Cronograma de cuotas y pagos</h2>
        <span className="ml-auto text-body-md text-muted-foreground">
          {p.nCuotas} cuotas {FRECUENCIAS[p.frecuencia].plural} · Tasa{" "}
          <span className="font-mono font-semibold text-foreground tabular-nums">{formatearPct(p.tasaTotalPct)}%</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="border-b border-border">
            <tr>
              <th className={cn(th, "text-left")}>Cuota</th>
              <th className={cn(th, "text-left")}>Vto.</th>
              <th className={cn(th, "text-right")}>Capital ARS</th>
              <th className={cn(th, "text-right")}>Interés ARS</th>
              <th className={cn(th, "text-right")}>Total ARS</th>
              <th className={cn(th, "text-right")}>Saldo ARS</th>
              <th className={cn(th, "text-left")}>Estado</th>
              <th className={cn(th, "text-left")}>Fecha pago</th>
              <th className={cn(th, "text-right")}>TC liq.</th>
            </tr>
          </thead>
          <tbody>
            {plan.cuotas.map((c) => (
              <FilaCuota key={c.id} c={c} f={f} esProxima={plan.proxima?.id === c.id} td={td} />
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-muted">
            <tr>
              <td className={cn(td, "font-sans font-semibold")} colSpan={2}>
                Total
              </td>
              <td className={cn(td, "text-right")}>{formatearArs(arsCapital)}</td>
              <td className={cn(td, "text-right text-success")}>{formatearArs(arsInteres)}</td>
              <td className={cn(td, "text-right font-semibold")}>{formatearArs(arsCapital.plus(arsInteres))}</td>
              <td className={cn(td, "text-right font-semibold")}>{p.estado === "anulado" ? "—" : formatearArs(plan.saldoArs)}</td>
              <td className={td} colSpan={3}>
                <span className="font-sans text-body-sm text-muted-foreground">
                  {plan.cuotasPagadas}/{plan.cuotas.length} pagadas
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

function FilaCuota({
  c,
  f,
  esProxima,
  td,
}: {
  c: CuotaEstado;
  f: FichaPrestamo;
  esProxima: boolean;
  td: string;
}) {
  const original = f.cuotasOriginales.get(c.id)!;
  const pago = f.ultimoPagoPorCuota.get(c.id);
  const anulado = f.prestamo.estado === "anulado";
  return (
    <tr className={cn("border-b border-border/60 last:border-b-0", esProxima && "bg-primary/4")}>
      <td className={cn(td, esProxima ? "font-semibold text-link" : "text-foreground")}>{cuotaN(c.numero)}</td>
      <td className={cn(td, esProxima && "font-semibold")}>{formatearFecha(c.vencimiento)}</td>
      <td className={cn(td, "text-right")}>{formatearArs(original.capital)}</td>
      <td className={cn(td, "text-right text-success")}>{formatearArs(original.interes)}</td>
      <td className={cn(td, "text-right font-semibold")}>{formatearArs(original.capital.plus(original.interes))}</td>
      <td className={cn(td, "text-right", c.pagada || anulado ? "text-muted-foreground" : "text-foreground")}>
        {c.pagada || anulado ? "—" : formatearArs(c.saldo)}
      </td>
      <td className={td}>
        {anulado ? (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-space-sm py-space-2xs font-mono text-badge-label whitespace-nowrap text-muted-foreground">
            Anulada
          </span>
        ) : (
          <SituacionCuota c={c} diasPlazo={f.diasPlazo} />
        )}
      </td>
      <td className={td}>{pago ? formatearFecha(pago.fecha) : "—"}</td>
      <td className={cn(td, "text-right text-muted-foreground")}>
        {pago ? (pago.tcSalida ? `$${formatearTc(pago.tcSalida)}` : <span className="font-sans">Efectivo</span>) : "—"}
      </td>
    </tr>
  );
}

function Cargos({ f }: { f: FichaPrestamo }) {
  const vacio = f.cargos.length === 0 && f.moraPendiente.length === 0;
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center gap-space-sm border-b border-border bg-muted px-space-md py-space-sm">
        <SlidersHorizontal className="size-5 text-link" aria-hidden />
        <div className="flex flex-col">
          <h2 className="text-headline-sm text-foreground">Mora, cargos y descuentos</h2>
          <span className="text-body-sm text-muted-foreground">
            {new Decimal(f.prestamo.moraPct).isZero()
              ? "Sin recargo por atraso"
              : `Mora del ${formatearPct(f.prestamo.moraPct)}% sobre el capital impago, pasados ${f.prestamo.diasGracia} días de gracia`}
          </span>
        </div>
      </div>
      {vacio ? (
        <p className="px-space-md py-margin text-center text-body-md text-muted-foreground">Sin mora ni cargos.</p>
      ) : (
        <ul className="flex flex-col gap-space-sm p-space-md">
          {f.moraPendiente.map((m) => (
            <li
              key={m.cuotaId}
              className="flex items-center gap-space-md rounded-lg border border-dashed border-danger/25 bg-danger-soft/40 px-space-md py-space-sm"
            >
              <span className="size-2 shrink-0 rounded-full bg-danger" aria-hidden />
              <div className="flex min-w-0 flex-col">
                <span className="text-body-md font-medium text-foreground">
                  Mora a cargar · Cuota <span className="font-mono tabular-nums">{cuotaN(m.cuotaNumero)}</span>
                </span>
                <span className="text-body-sm text-muted-foreground">
                  Desde <span className="font-mono tabular-nums">{formatearFecha(m.fecha)}</span> sobre{" "}
                  <span className="font-mono tabular-nums">${formatearArs(m.base)}</span> de capital · se registra con el próximo pago
                </span>
              </div>
              <span className="ml-auto font-mono text-data-currency-primary whitespace-nowrap text-danger tabular-nums">
                +${formatearArs(m.ars)}
              </span>
            </li>
          ))}
          {f.cargos.map((c) => (
            <li
              key={c.id}
              className={cn(
                "flex flex-wrap items-center gap-x-space-md gap-y-space-xs rounded-lg border border-border bg-muted px-space-md py-space-sm",
                c.anulado && "opacity-60",
              )}
            >
              <span className={cn("size-2 shrink-0 rounded-full", c.ars.gt(0) ? "bg-danger" : "bg-success")} aria-hidden />
              <div className="flex min-w-0 flex-1 basis-56 flex-col">
                <span className={cn("text-body-md font-medium text-foreground", c.anulado && "line-through")}>
                  {TIPOS_CARGO[c.tipo]}
                  {c.cuotaNumero !== null && (
                    <>
                      {" "}
                      · Cuota <span className="font-mono tabular-nums">{cuotaN(c.cuotaNumero)}</span>
                    </>
                  )}{" "}
                  — {c.motivo}
                </span>
                <span className="text-body-sm text-muted-foreground">
                  {c.creadoPor} · <span className="font-mono tabular-nums">{formatearFecha(c.fecha)}</span>
                  {c.anulado && " · Anulado"}
                </span>
              </div>
              <span
                className={cn(
                  "ml-auto font-mono text-data-currency-primary whitespace-nowrap tabular-nums",
                  c.ars.gt(0) ? "text-danger" : "text-success",
                  c.anulado && "line-through",
                )}
              >
                {c.ars.gt(0) ? "+" : "−"}${formatearArs(c.ars.abs())}
              </span>
              {!c.anulado && (
                <BotonAnular
                  entidad="cargos"
                  id={c.id}
                  titulo={c.tipo === "mora" ? "la mora" : c.tipo === "descuento" ? "el descuento" : "el ajuste"}
                  detalle={`${TIPOS_CARGO[c.tipo]}${c.cuotaNumero !== null ? ` · cuota ${c.cuotaNumero}` : ""}: ${c.ars.gt(0) ? "+" : "−"}$${formatearArs(c.ars.abs())} — ${c.motivo}`}
                  aviso={
                    c.tipo === "mora"
                      ? "La mora anulada queda perdonada: no se vuelve a generar en esa cuota."
                      : "La deuda vuelve a subir; si el préstamo estaba cancelado, se reabre."
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Condiciones({ f, arsCapital, arsInteres }: { f: FichaPrestamo; arsCapital: Decimal; arsInteres: Decimal }) {
  const p = f.prestamo;
  const filas: [string, string][] = [
    ["Capital", `$${formatearArs(arsCapital)}`],
    ["Tasa del préstamo", `${formatearPct(p.tasaTotalPct)}%`],
    ["Equivalente mensual", `${formatearPct(p.tasaMensualPct)}%`],
    ["Interés pactado", `$${formatearArs(arsInteres)}`],
    ["Total a cobrar", `$${formatearArs(arsCapital.plus(arsInteres))}`],
    ["Plazo", `${f.diasPlazo} días`],
    ["Mora / gracia", new Decimal(p.moraPct).isZero() ? "Sin recargo" : `${formatearPct(p.moraPct)}% / ${p.diasGracia} días`],
  ];
  return (
    <Panel className="p-space-md">
      <div className="mb-space-sm flex items-center gap-space-sm">
        <ReceiptText className="size-5 text-link" aria-hidden />
        <h2 className="text-headline-sm text-foreground">Condiciones</h2>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-space-md gap-y-space-xs rounded-lg bg-muted p-space-sm">
        {filas.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-body-md text-muted-foreground">{k}</dt>
            <dd className="text-right font-mono text-data-cell text-foreground tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {p.notas && <p className="mt-space-sm text-body-md whitespace-pre-line text-muted-foreground">{p.notas}</p>}
    </Panel>
  );
}

function Historial({ eventos }: { eventos: EventoFicha[] }) {
  const punto: Partial<Record<EventoFicha["tipo"], string>> = {
    desembolso: "bg-primary",
    cobro: "bg-success",
    reconocimiento_ganancia: "bg-success",
    anulacion: "bg-danger",
    perdida: "bg-danger",
  };
  return (
    <Panel className="p-space-md">
      <div className="mb-space-md flex items-center gap-space-sm">
        <History className="size-5 text-link" aria-hidden />
        <h2 className="text-headline-sm text-foreground">Historial</h2>
        <Etiqueta className="ml-auto">
          {eventos.length} {eventos.length === 1 ? "evento" : "eventos"}
        </Etiqueta>
      </div>
      <ol className="flex flex-col">
        {eventos.map((e, i) => (
          <li key={e.id} className="relative flex gap-space-md pb-space-lg last:pb-0">
            {i < eventos.length - 1 && <span className="absolute top-4 bottom-0 left-[5px] w-px bg-border" aria-hidden />}
            <span className={cn("mt-1 size-3 shrink-0 rounded-full", punto[e.tipo] ?? "bg-input")} aria-hidden />
            <div className={cn("flex min-w-0 flex-col gap-space-2xs", e.anulada && "opacity-60")}>
              <span className="font-mono text-label text-muted-foreground tabular-nums">{formatearFechaHora(e.en)} HS</span>
              <span className={cn("text-body-lg font-semibold text-foreground", e.anulada && "line-through")}>
                {TIPOS_EVENTO[e.tipo]}
                {e.anulada && <span className="ml-space-sm text-body-sm font-normal text-danger no-underline">Anulado</span>}
              </span>
              {e.descripcion && <span className="text-body-md text-muted-foreground">{e.descripcion}</span>}
              {!e.usdt.isZero() && (
                <span className="font-mono text-data-cell text-foreground tabular-nums">
                  {e.usdt.gt(0) ? "Cartera +" : e.tipo === "anulacion" ? "Cartera −" : "Recuperado "}
                  {formatearUsdt(e.usdt.abs())} USDT
                </span>
              )}
              {e.motivo && <span className="text-body-sm text-muted-foreground">Motivo: {e.motivo}</span>}
              <div className="flex items-center gap-space-sm">
                <span className="w-fit rounded-sm bg-accent px-space-sm py-space-2xs text-body-sm text-muted-foreground">
                  {e.usuario}
                </span>
                {e.tipo === "cobro" && e.pagoId && !e.anulada && (
                  <BotonAnular
                    entidad="pagos"
                    id={e.pagoId}
                    titulo="el pago"
                    detalle={e.descripcion ?? "Cobro"}
                    aviso="Se anula el pago completo (todas sus imputaciones y el saldo a favor que se haya aplicado desde él). Si era efectivo ya convertido, anulá antes la conversión. La mora y los descuentos que nacieron con el pago se anulan aparte."
                  />
                )}
              </div>
            </div>
          </li>
        ))}
        {eventos.length === 0 && <p className="text-body-md text-muted-foreground">Sin movimientos.</p>}
      </ol>
    </Panel>
  );
}
