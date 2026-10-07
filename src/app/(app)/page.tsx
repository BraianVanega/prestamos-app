import Decimal from "decimal.js";
import { ArrowLeftRight, CalendarClock, ChartColumn, CircleCheck, Gavel, Landmark, PieChart, TriangleAlert, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BadgeRiesgo, COLORES_RIESGO } from "@/components/app/riesgo";
import { buttonVariants } from "@/components/ui/button";
import { cargarOverview, DIAS_AGENDA, MESES_GANANCIA, type Overview } from "@/db/overview";
import { BANDAS_RIESGO_PCT, type NivelRiesgo } from "@/engine/estado-prestamo";
import { diasEntre } from "@/engine/fechas";
import { formatearDocumento, formatearFecha, formatearFechaHora } from "@/lib/formato";
import { hoyArgentina } from "@/lib/hoy";
import { formatearArs, formatearPct, formatearTc, formatearUsdt } from "@/lib/numeros";
import { numeroPrestamo } from "@/lib/prestamos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview · Cierre & Reparto" };

/** Días de efectivo sin convertir a partir de los cuales se marca en rojo (igual que en Efectivo). */
const ALERTA_EFECTIVO_DIAS = 7;

const NOMBRE_MES = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
const MES_CORTO = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });
const aFecha = (mes: string) => new Date(`${mes}-01T00:00:00Z`);
const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const TIPOS_TX: Record<string, string> = {
  apertura: "Saldo de apertura",
  aporte: "Aporte",
  desembolso: "Desembolso",
  cobro: "Cobro",
  conversion: "Conversión",
  reconocimiento_ganancia: "Ganancia reconocida",
  perdida: "Pérdida",
  aplicacion_saldo_favor: "Saldo a favor aplicado",
  retiro: "Retiro",
  anulacion: "Anulación",
};

const ETIQUETA_RIESGO: Record<NivelRiesgo, string> = { verde: "Verde", amarillo: "Amarillo", naranja: "Naranja", rojo: "Rojo", negro: "Negro" };
const COLOR_SOCIO = ["bg-primary", "bg-tertiary"] as const;

function Etiqueta({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("text-label-caps text-on-surface-variant uppercase", className)}>{children}</span>;
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-lg border border-outline-variant bg-surface-container-lowest", className)}>{children}</section>;
}

function Usdt({ valor, className }: { valor: Decimal; className?: string }) {
  return (
    <span className="font-mono tabular-nums">
      <span className={cn("text-headline-lg", className ?? "text-on-surface")}>{formatearUsdt(valor)}</span>{" "}
      <span className="text-data-currency-secondary text-primary">USDT</span>
    </span>
  );
}

function Encabezado({ icono, titulo, subtitulo, extra }: { icono: React.ReactNode; titulo: string; subtitulo?: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-space-md border-b border-outline-variant px-space-md py-space-md">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-container text-on-primary [&_svg]:size-5">{icono}</span>
      <div className="flex min-w-0 flex-col">
        <h2 className="text-headline-sm text-on-surface">{titulo}</h2>
        {subtitulo && <span className="text-body-sm text-on-surface-variant">{subtitulo}</span>}
      </div>
      {extra && <div className="ml-auto shrink-0">{extra}</div>}
    </div>
  );
}

export default async function OverviewPage() {
  const o = await cargarOverview(hoyArgentina());

  return (
    <section className="flex flex-col gap-margin">
      <Franja o={o} />
      <div className="grid gap-gutter-compact md:grid-cols-2 xl:grid-cols-4">
        <CapitalEnCalle o={o} />
        <RecuperadoMes o={o} />
        <Ganancia o={o} />
        <Efectivo o={o} />
      </div>
      <div className="grid gap-margin xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex min-w-0 flex-col gap-margin">
          <Vencimientos o={o} />
          <GananciaSemestral o={o} />
        </div>
        <Atraso o={o} />
      </div>
      <UltimaOperacion o={o} />
    </section>
  );
}

function Franja({ o }: { o: Overview }) {
  return (
    <div className="flex flex-wrap items-center gap-x-margin gap-y-space-sm rounded-lg border border-outline-variant bg-surface-container-lowest px-space-md py-space-sm text-body-md text-on-surface-variant">
      <span className="flex items-center gap-space-sm">
        <span className="size-2 rounded-full bg-tertiary" aria-hidden />
        <Etiqueta>Período</Etiqueta>
        <span className="font-medium text-on-surface">{capitalizar(NOMBRE_MES.format(aFecha(o.hoy.slice(0, 7))).replace(" de ", " "))}</span>
      </span>
      <span className="flex items-center gap-space-sm">
        <ArrowLeftRight className="size-4" aria-hidden />
        Último TC:
        {o.ultimoTc ? (
          <span>
            <span className="font-mono text-on-surface tabular-nums">${formatearTc(o.ultimoTc.tc)} ARS/USDT</span>{" "}
            <span className="text-body-sm">
              ({o.ultimoTc.origen} del <span className="font-mono tabular-nums">{formatearFecha(o.ultimoTc.fecha)}</span>)
            </span>
          </span>
        ) : (
          <span>—</span>
        )}
      </span>
      <span className="flex items-center gap-space-sm">
        <PieChart className="size-4" aria-hidden />
        Split vigente:
        <span className="font-mono text-on-surface tabular-nums">
          {o.cuentas.socios.map((s) => `${s.nombre}: ${formatearPct(s.pctSociedad)}%`).join(" / ")}
        </span>
      </span>
      <span className="flex items-center gap-space-sm xl:ml-auto">
        <Wallet className="size-4" aria-hidden />
        Caja USDT:
        <span className={cn("font-mono font-semibold tabular-nums", o.cuentas.caja.lt(0) ? "text-error" : "text-on-surface")}>
          {formatearUsdt(o.cuentas.caja)} USDT
        </span>
      </span>
    </div>
  );
}

function Tarjeta({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Panel className={cn("flex flex-col gap-space-sm p-space-md", className)}>{children}</Panel>;
}

function CapitalEnCalle({ o }: { o: Overview }) {
  return (
    <Tarjeta>
      <Etiqueta>Capital vigente en calle</Etiqueta>
      <Usdt valor={o.cuentas.cartera} />
      <span className="font-mono text-data-cell text-on-surface-variant tabular-nums">Costo en USDT aún no recuperado</span>
      <div className="mt-auto flex items-center gap-space-sm rounded-lg bg-surface-container-low px-space-sm py-space-xs text-body-md text-on-surface">
        <CircleCheck className="size-4 text-tertiary" aria-hidden />
        <Link href="/prestamos?estado=al-dia" className="hover:text-primary">
          <span className="font-mono tabular-nums">{o.vigentes}</span> {o.vigentes === 1 ? "préstamo vigente" : "préstamos vigentes"}
        </Link>
        <span className="ml-auto text-body-sm text-on-surface-variant">
          A cobrar <span className="font-mono tabular-nums">${formatearArs(o.saldoPlanArs)}</span>
        </span>
      </div>
    </Tarjeta>
  );
}

function RecuperadoMes({ o }: { o: Overview }) {
  return (
    <Tarjeta>
      <Etiqueta>Recuperado del mes (cobranzas)</Etiqueta>
      <Usdt valor={o.mes.recuperadoUsdt} />
      <span className="font-mono text-data-cell text-on-surface-variant tabular-nums">
        Cobrado ${formatearArs(o.mes.cobradoArs)} en {o.mes.pagos} {o.mes.pagos === 1 ? "pago" : "pagos"}
      </span>
      <p className="mt-auto text-body-sm text-on-surface-variant">
        Costo recuperado más ganancia reconocida en el mes. El efectivo cuenta recién al convertirlo.
      </p>
    </Tarjeta>
  );
}

function Ganancia({ o }: { o: Overview }) {
  const total = o.cuentas.socios.reduce((s, x) => s.plus(x.ganancia), new Decimal(0));
  return (
    <Tarjeta>
      <div className="flex items-start gap-space-sm">
        <Etiqueta>Ganancia realizada</Etiqueta>
        <span className="ml-auto rounded-sm bg-surface-container px-space-sm py-space-2xs font-mono text-badge-label text-on-surface-variant tabular-nums">
          MES +{formatearUsdt(o.mes.gananciaUsdt)}
        </span>
      </div>
      <Usdt valor={total} />
      <div className="mt-auto grid grid-cols-2 gap-space-sm">
        {o.cuentas.socios.map((s) => (
          <div key={s.id} className="flex flex-col items-center rounded-lg bg-surface-container-low px-space-sm py-space-xs">
            <Etiqueta>
              {s.nombre} ({formatearPct(s.pctSociedad)}%)
            </Etiqueta>
            <span className="font-mono text-data-cell font-semibold text-on-surface tabular-nums">{formatearUsdt(s.ganancia)} USDT</span>
          </div>
        ))}
      </div>
    </Tarjeta>
  );
}

function Efectivo({ o }: { o: Overview }) {
  const dias = o.efectivo.masViejo ? diasEntre(o.efectivo.masViejo, o.hoy) : 0;
  const alerta = o.efectivo.ars.gt(0) && dias > ALERTA_EFECTIVO_DIAS;
  const hay = o.efectivo.ars.gt(0);
  return (
    <Tarjeta className={cn(alerta && "border-riesgo-rojo-borde bg-riesgo-rojo-bg/40")}>
      <div className="flex items-start gap-space-sm">
        <Etiqueta className={cn("flex items-center gap-space-xs", alerta && "text-error")}>
          {alerta && <TriangleAlert className="size-3.5" aria-hidden />}
          Efectivo sin convertir
        </Etiqueta>
        {hay && (
          <span
            className={cn(
              "ml-auto rounded-sm px-space-sm py-space-2xs font-mono text-badge-label tabular-nums",
              alerta ? "bg-riesgo-rojo-bg text-riesgo-rojo-fg" : "bg-surface-container text-on-surface-variant",
            )}
          >
            {dias} {dias === 1 ? "DÍA" : "DÍAS"} ANT.
          </span>
        )}
      </div>
      <span className="font-mono tabular-nums">
        <span className={cn("text-headline-lg", alerta ? "text-error" : "text-on-surface")}>${formatearArs(o.efectivo.ars)}</span>{" "}
        <span className="text-data-currency-secondary text-on-surface-variant">ARS</span>
      </span>
      <span className="text-body-sm text-on-surface-variant">
        {hay ? "Expuesto al tipo de cambio hasta convertirlo." : "No hay efectivo pendiente."}
      </span>
      <Link
        href="/efectivo"
        className={cn(buttonVariants({ variant: alerta ? "default" : "outline" }), "mt-auto gap-space-sm", alerta && "bg-error text-on-error hover:bg-error/90")}
      >
        <ArrowLeftRight aria-hidden />
        Registrar conversión
      </Link>
    </Tarjeta>
  );
}

function Vencimientos({ o }: { o: Overview }) {
  const th = "px-space-md py-space-sm text-label-caps text-on-surface-variant uppercase whitespace-nowrap";
  const cuando = (d: number) => (d === 0 ? "Hoy" : d === 1 ? "Mañana" : `En ${d} días`);
  return (
    <Panel className="overflow-hidden">
      <Encabezado
        icono={<CalendarClock aria-hidden />}
        titulo="Vencimientos próximos"
        subtitulo={`Cuotas impagas que vencen en los próximos ${DIAS_AGENDA} días`}
        extra={
          <span className="rounded-sm bg-surface-container px-space-sm py-space-2xs font-mono text-badge-label text-on-surface-variant tabular-nums">
            {o.vencimientos.length} {o.vencimientos.length === 1 ? "CUOTA" : "CUOTAS"}
          </span>
        }
      />
      {o.vencimientos.length === 0 ? (
        <p className="px-space-md py-margin text-center text-body-md text-on-surface-variant">No vence nada en los próximos {DIAS_AGENDA} días.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="border-b border-outline-variant bg-surface-container-low">
              <tr>
                <th className={cn(th, "text-left")}>Vencimiento</th>
                <th className={cn(th, "text-left")}>Préstamo</th>
                <th className={cn(th, "text-left")}>Cliente</th>
                <th className={cn(th, "text-right")}>Cuota</th>
                <th className={cn(th, "text-right")}>Monto exigible</th>
              </tr>
            </thead>
            <tbody>
              {o.vencimientos.map((v) => {
                const p = o.prestamos.get(v.prestamoId)!;
                return (
                  <tr key={v.cuota.id} className="border-b border-outline-variant/60 last:border-b-0 hover:bg-primary/4">
                    <td className="px-space-md py-space-sm whitespace-nowrap">
                      <span
                        className={cn(
                          "rounded-sm px-space-sm py-space-2xs font-mono text-data-cell tabular-nums",
                          v.enDias === 0
                            ? "bg-riesgo-rojo-bg text-riesgo-rojo-fg"
                            : v.enDias === 1
                              ? "bg-primary-fixed text-on-primary-fixed-variant"
                              : "text-on-surface",
                        )}
                      >
                        {cuando(v.enDias)} ({formatearFecha(v.cuota.vencimiento).slice(0, 5)})
                      </span>
                    </td>
                    <td className="px-space-md py-space-sm">
                      <Link href={`/prestamos/${p.id}`} className="font-mono text-body-lg font-semibold text-primary tabular-nums hover:underline">
                        {numeroPrestamo(p.numero)}
                      </Link>
                    </td>
                    <td className="px-space-md py-space-sm">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-body-lg font-medium text-on-surface">{p.cliente.nombre}</span>
                        {p.cliente.documento && (
                          <span className="font-mono text-data-cell text-on-surface-variant tabular-nums">{formatearDocumento(p.cliente.documento)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-space-md py-space-sm text-right font-mono text-data-cell whitespace-nowrap tabular-nums">
                      {String(v.cuota.numero).padStart(2, "0")} / {String(p.nCuotas).padStart(2, "0")}
                    </td>
                    <td className="px-space-md py-space-sm text-right font-mono text-data-currency-primary whitespace-nowrap text-on-surface tabular-nums">
                      ${formatearArs(v.cuota.saldo)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function GananciaSemestral({ o }: { o: Overview }) {
  const maximo = o.ganancia.reduce((m, x) => Decimal.max(m, x.total), new Decimal(0));
  const total = o.ganancia.reduce((s, x) => s.plus(x.total), new Decimal(0));
  const socios = o.cuentas.socios;
  const alto = (v: Decimal) => (maximo.isZero() ? "0" : Decimal.max(v, 0).div(maximo).times(100).toDecimalPlaces(2).toString());
  return (
    <Panel className="overflow-hidden">
      <Encabezado
        icono={<ChartColumn aria-hidden />}
        titulo="Ganancia realizada por mes"
        subtitulo={`Últimos ${MESES_GANANCIA} meses, en USDT por socio`}
        extra={
          <div className="flex flex-col items-end gap-space-2xs sm:flex-row sm:gap-margin">
            {socios.map((s, i) => (
              <span key={s.id} className="flex items-center gap-space-xs text-body-sm text-on-surface">
                <span className={cn("size-2.5 rounded-sm", COLOR_SOCIO[i % 2])} aria-hidden />
                {s.nombre} ({formatearPct(s.pctSociedad)}%)
              </span>
            ))}
          </div>
        }
      />
      <div className="p-space-md">
        <div className="relative grid h-56 grid-cols-6 items-end gap-margin rounded-lg bg-surface-container-low px-margin pt-margin">
          {maximo.isZero() && (
            <p className="absolute inset-x-0 top-1/3 text-center text-body-md text-on-surface-variant">
              Todavía no hay ganancia realizada: aparece cuando lo cobrado supera el costo en USDT del préstamo.
            </p>
          )}
          {o.ganancia.map((m, i) => {
            const actual = i === o.ganancia.length - 1;
            return (
              <div key={m.mes} className="flex h-full flex-col items-center justify-end gap-space-xs">
                <span className={cn("font-mono text-badge-label tabular-nums", actual ? "rounded-sm bg-on-surface px-space-xs py-space-2xs text-surface" : "text-on-surface-variant")}>
                  {formatearUsdt(m.total)}
                </span>
                <div
                  className={cn("flex w-full max-w-14 flex-col-reverse overflow-hidden rounded-t-sm", actual && "ring-2 ring-primary ring-offset-2 ring-offset-surface-container-low")}
                  style={{ height: `${alto(m.total)}%` }}
                  title={m.porSocio.map((x) => `${socios.find((s) => s.id === x.id)?.nombre}: ${formatearUsdt(x.monto)} USDT`).join(" · ")}
                >
                  {m.porSocio.map((x, j) => (
                    <div
                      key={x.id}
                      className={COLOR_SOCIO[j % 2]}
                      style={{ height: m.total.isZero() ? "0" : `${Decimal.max(x.monto, 0).div(m.total).times(100).toDecimalPlaces(2).toString()}%` }}
                    />
                  ))}
                </div>
                <span className={cn("pb-space-sm text-label-caps uppercase", actual ? "text-primary" : "text-on-surface-variant")}>
                  {MES_CORTO.format(aFecha(m.mes)).replace(".", "")}
                  {actual && " (act)"}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-space-md flex flex-wrap items-end gap-margin rounded-lg bg-surface-container-low px-space-md py-space-sm">
          <div className="flex flex-col">
            <Etiqueta>Total {MESES_GANANCIA} meses</Etiqueta>
            <span className="font-mono text-data-currency-primary text-on-surface tabular-nums">{formatearUsdt(total)} USDT</span>
          </div>
          {socios.map((s) => {
            const del = o.ganancia.reduce((t, m) => t.plus(m.porSocio.find((x) => x.id === s.id)?.monto ?? 0), new Decimal(0));
            return (
              <div key={s.id} className="flex flex-col">
                <Etiqueta>{s.nombre}</Etiqueta>
                <span className="font-mono text-data-cell text-on-surface tabular-nums">{formatearUsdt(del)} USDT</span>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

function Atraso({ o }: { o: Overview }) {
  const pctExpuesto = o.cuentas.cartera.gt(0) ? o.exposicionMoraUsdt.div(o.cuentas.cartera).times(100) : new Decimal(0);
  const bandas: { nivel: NivelRiesgo; texto: string }[] = [
    ...BANDAS_RIESGO_PCT.map((b, i) => ({
      nivel: b.nivel,
      texto: i === 0 ? `≤${b.hastaPct}%` : `${BANDAS_RIESGO_PCT[i - 1]!.hastaPct}–${b.hastaPct}%`,
    })),
    { nivel: "negro", texto: `>${BANDAS_RIESGO_PCT.at(-1)!.hastaPct}%` },
  ];
  return (
    <Panel className="flex flex-col overflow-hidden">
      <Encabezado
        icono={<Gavel aria-hidden />}
        titulo="Préstamos con atraso"
        subtitulo="Del más grave al más leve"
        extra={
          <span
            className={cn(
              "rounded-sm px-space-sm py-space-2xs font-mono text-badge-label tabular-nums",
              o.atraso.length ? "bg-error text-on-error" : "bg-surface-container text-on-surface-variant",
            )}
          >
            {o.atraso.length} {o.atraso.length === 1 ? "CASO" : "CASOS"}
          </span>
        }
      />
      <div className="flex flex-col gap-space-xs px-space-md pt-space-md">
        <Etiqueta>Riesgo: atraso como % del plazo</Etiqueta>
        <div className="grid grid-cols-5 gap-space-xs">
          {bandas.map((b) => (
            <span
              key={b.nivel}
              className={cn("rounded-sm border px-space-xs py-space-2xs text-center font-mono text-badge-label tabular-nums", COLORES_RIESGO[b.nivel].badge)}
              title={ETIQUETA_RIESGO[b.nivel]}
            >
              {b.texto}
            </span>
          ))}
        </div>
      </div>
      {o.atraso.length === 0 ? (
        <p className="flex items-center justify-center gap-space-sm px-space-md py-margin text-body-md text-on-surface-variant">
          <CircleCheck className="size-4 text-tertiary" aria-hidden />
          Ningún préstamo con atraso.
        </p>
      ) : (
        <ul className="flex flex-col gap-space-sm p-space-md">
          {o.atraso.slice(0, 8).map((a) => {
            const p = o.prestamos.get(a.id)!;
            return (
              <li
                key={a.id}
                className={cn(
                  "flex flex-col gap-space-xs rounded-lg border border-outline-variant border-l-4 bg-surface-container-low px-space-md py-space-sm",
                  {
                    verde: "border-l-tertiary",
                    amarillo: "border-l-riesgo-amarillo-fg",
                    naranja: "border-l-riesgo-naranja-fg",
                    rojo: "border-l-riesgo-rojo-fg",
                    negro: "border-l-on-surface",
                  }[a.riesgo],
                )}
              >
                <div className="flex flex-wrap items-center gap-x-space-sm gap-y-space-2xs">
                  <span className="truncate text-body-lg font-semibold text-on-surface">{p.cliente.nombre}</span>
                  <Link href={`/prestamos/${p.id}`} className="font-mono text-body-md font-semibold text-primary tabular-nums hover:underline">
                    {numeroPrestamo(p.numero)}
                  </Link>
                  <span className="ml-auto">
                    <BadgeRiesgo nivel={a.riesgo}>
                      Mora {a.diasAtraso} {a.diasAtraso === 1 ? "día" : "días"}
                    </BadgeRiesgo>
                  </span>
                </div>
                <span className="text-body-sm text-on-surface-variant">
                  {a.cuotasVencidas} {a.cuotasVencidas === 1 ? "cuota vencida" : "cuotas vencidas"} · cartera{" "}
                  <span className="font-mono tabular-nums">{formatearUsdt(p.carteraUsdt)} USDT</span>
                </span>
                <div className="flex items-end justify-between gap-space-sm">
                  <div className="flex flex-col">
                    <Etiqueta>Vencido (capital + interés)</Etiqueta>
                    <span className={cn("font-mono text-data-currency-primary tabular-nums", COLORES_RIESGO[a.riesgo].texto)}>
                      ${formatearArs(a.vencidoArs)}
                    </span>
                  </div>
                  <Link href={`/pagos/nuevo?cliente=${p.cliente.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Registrar pago
                  </Link>
                </div>
              </li>
            );
          })}
          {o.atraso.length > 8 && (
            <Link href="/prestamos?estado=en-mora" className="text-center text-body-md text-primary hover:underline">
              Ver los {o.atraso.length} préstamos en mora
            </Link>
          )}
        </ul>
      )}
      <div className="mt-auto flex items-center gap-space-sm border-t border-riesgo-rojo-borde bg-riesgo-rojo-bg px-space-md py-space-md">
        <TriangleAlert className="size-5 text-error" aria-hidden />
        <span className="text-body-lg font-medium text-on-surface">Exposición total en mora</span>
        <span className="ml-auto flex flex-col items-end">
          <span className="font-mono text-data-currency-primary text-error tabular-nums">{formatearUsdt(o.exposicionMoraUsdt)} USDT</span>
          <span className="font-mono text-body-sm text-on-surface-variant tabular-nums">({formatearPct(pctExpuesto)}% de la cartera)</span>
        </span>
      </div>
    </Panel>
  );
}

function UltimaOperacion({ o }: { o: Overview }) {
  const u = o.ultimaOperacion;
  return (
    <div className="flex flex-wrap items-center gap-x-space-md gap-y-space-xs rounded-lg border border-outline-variant bg-surface-container-lowest px-space-md py-space-sm text-body-md">
      <Etiqueta>Última operación registrada</Etiqueta>
      {u ? (
        <>
          <span className="flex items-center gap-space-xs font-medium text-on-surface">
            <span className={cn("size-2 rounded-full", u.tipo === "anulacion" ? "bg-error" : "bg-tertiary")} aria-hidden />
            {TIPOS_TX[u.tipo] ?? u.tipo}
          </span>
          {u.descripcion && <span className="min-w-0 truncate text-on-surface-variant">{u.descripcion}</span>}
          <span className="font-mono text-data-cell text-on-surface-variant tabular-nums">
            ({formatearFechaHora(u.en)} hs · {u.usuario})
          </span>
        </>
      ) : (
        <span className="text-on-surface-variant">Todavía no hay operaciones.</span>
      )}
      <Link href="/prestamos" className="ml-auto flex items-center gap-space-xs text-primary hover:underline">
        <Landmark className="size-4" aria-hidden />
        Ver préstamos
      </Link>
    </div>
  );
}
