import type Decimal from "decimal.js";
import { ArrowLeft, CircleCheck, History, Landmark } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BotonAnular } from "@/components/app/boton-anular";
import { FormPagoTercero } from "@/components/app/form-pago-tercero";
import { FormTercero } from "@/components/app/form-tercero";
import { db } from "@/db";
import { cuentasTerceros, historialPagosTercero } from "@/db/terceros";
import { formatearFecha } from "@/lib/formato";
import { hoyArgentina } from "@/lib/hoy";
import { formatearPct, formatearUsdt, textoEditable } from "@/lib/numeros";
import { numeroPrestamo } from "@/lib/prestamos";
import { cn } from "@/lib/utils";
import { actualizarTercero, registrarPagoTercero } from "../actions";

export const metadata: Metadata = { title: "Tercero · Cierre & Reparto" };

const ESTADOS: Record<string, string> = { vigente: "Vigente", cancelado: "Cancelado", castigado: "Castigado", refinanciado: "Refinanciado" };

function Tarjeta({ etiqueta, valor, nota, className }: { etiqueta: string; valor: Decimal; nota: string; className?: string }) {
  return (
    <div className="flex flex-col gap-space-sm rounded-lg border border-outline-variant bg-surface-container-lowest p-space-md">
      <span className="text-label-caps text-on-surface-variant uppercase">{etiqueta}</span>
      <span className="font-mono tabular-nums">
        <span className={cn("text-headline-lg", className ?? "text-on-surface")}>{formatearUsdt(valor)}</span>{" "}
        <span className="text-data-currency-secondary text-on-surface-variant">USDT</span>
      </span>
      <span className="text-body-sm text-on-surface-variant">{nota}</span>
    </div>
  );
}

export default async function TerceroPage({ params, searchParams }: PageProps<"/terceros/[id]">) {
  const { id } = await params;
  const { pago } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const hoy = hoyArgentina();
  const [[t], pagos] = await Promise.all([cuentasTerceros(db, hoy, id), historialPagosTercero(db, id)]);
  if (!t) notFound();
  const d = t.deuda;
  const recien = typeof pago === "string" ? pagos.find((p) => p.id === pago) : undefined;

  const th = "px-space-md py-space-sm text-label-caps text-on-surface-variant uppercase whitespace-nowrap";
  const td = "px-space-md py-space-sm font-mono text-data-cell tabular-nums whitespace-nowrap";

  return (
    <section className="flex flex-col gap-margin">
      <div className="flex flex-col gap-space-xs">
        <Link href="/terceros" className="flex w-fit items-center gap-space-xs text-body-md text-on-surface-variant hover:text-on-surface">
          <ArrowLeft className="size-4" aria-hidden />
          Terceros
        </Link>
        <h1 className="text-headline-xl text-on-surface">
          {t.nombre}
          {!t.activo && <span className="ml-space-sm text-body-md text-on-surface-variant">(inactivo)</span>}
        </h1>
        {t.notas && <p className="text-body-md whitespace-pre-line text-on-surface-variant">{t.notas}</p>}
      </div>

      {recien && !recien.anulado && (
        <p className="flex items-center gap-space-sm rounded-lg border border-riesgo-verde-borde bg-riesgo-verde-bg px-space-md py-space-sm text-body-md text-riesgo-verde-fg">
          <CircleCheck className="size-4" aria-hidden />
          Pago registrado: <span className="font-mono tabular-nums">{formatearUsdt(recien.usdt)} USDT</span>
        </p>
      )}

      <div className="grid gap-gutter-compact md:grid-cols-2 xl:grid-cols-4">
        <Tarjeta etiqueta="Puso" valor={d.puesto} nota="Su parte de los préstamos vigentes y cerrados." />
        <Tarjeta etiqueta="Capital recuperado" valor={d.capitalRecuperado} nota={`Su % de lo cobrado. Pagado: ${formatearUsdt(d.pagadoCapital)} USDT.`} />
        <Tarjeta
          etiqueta="Ganancia realizada"
          valor={d.ganancia}
          nota={`Su % de la ganancia. Pagado: ${formatearUsdt(d.pagadoGanancia)} USDT.`}
          className="text-tertiary"
        />
        <Tarjeta etiqueta="Se le debe" valor={d.disponible} nota="Capital recuperado + ganancia, menos lo pagado." className="text-primary" />
      </div>

      <div className="grid grid-cols-1 items-start gap-margin xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex min-w-0 flex-col gap-margin">
          <section className="flex flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
            <div className="flex items-center gap-space-sm border-b border-outline-variant px-margin-panel py-space-md">
              <Landmark className="size-4 text-primary" aria-hidden />
              <h2 className="text-headline-sm text-on-surface">Préstamos</h2>
            </div>
            {t.prestamos.length === 0 ? (
              <p className="px-margin-panel py-margin text-center text-body-md text-on-surface-variant">
                Todavía no puso plata en ningún préstamo. Se suma desde el alta del préstamo, en Estructura de capital.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead className="border-b border-outline-variant bg-surface-container-low">
                    <tr>
                      <th className={cn(th, "text-left")}>N° préstamo</th>
                      <th className={cn(th, "text-left")}>Cliente</th>
                      <th className={cn(th, "text-left")}>Estado</th>
                      <th className={cn(th, "text-right")}>Su %</th>
                      <th className={cn(th, "text-right")}>Puso USDT</th>
                      <th className={cn(th, "text-right")}>Recuperado del préstamo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.prestamos.map((p) => (
                      <tr key={p.id} className="border-b border-outline-variant/60 last:border-b-0">
                        <td className={td}>
                          <Link href={`/prestamos/${p.id}`} className="text-primary hover:underline">
                            {numeroPrestamo(p.numero)}
                          </Link>
                        </td>
                        <td className="px-space-md py-space-sm text-body-md text-on-surface">{p.cliente}</td>
                        <td className="px-space-md py-space-sm text-body-md text-on-surface-variant">{ESTADOS[p.estado] ?? p.estado}</td>
                        <td className={cn(td, "text-right")}>{formatearPct(p.pct)}%</td>
                        <td className={cn(td, "text-right")}>{formatearUsdt(p.puesto)}</td>
                        <td className={cn(td, "text-right")}>
                          {formatearUsdt(p.recuperado)} / {formatearUsdt(p.usdtPrestado)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="flex flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
            <div className="flex items-center gap-space-sm border-b border-outline-variant px-margin-panel py-space-md">
              <History className="size-4 text-primary" aria-hidden />
              <h2 className="text-headline-sm text-on-surface">Pagos al tercero</h2>
            </div>
            {pagos.length === 0 ? (
              <p className="px-margin-panel py-margin text-center text-body-md text-on-surface-variant">Todavía no se le pagó nada.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead className="border-b border-outline-variant bg-surface-container-low">
                    <tr>
                      <th className={cn(th, "text-left")}>Fecha</th>
                      <th className={cn(th, "text-left")}>Detalle</th>
                      <th className={cn(th, "text-right")}>USDT</th>
                      <th className={cn(th, "text-left")}>Registró</th>
                      <th className={th}>
                        <span className="sr-only">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagos.map((p) => (
                      <tr key={p.id} className={cn("border-b border-outline-variant/60 last:border-b-0", p.anulado && "text-on-surface-variant line-through")}>
                        <td className={td}>{formatearFecha(p.fecha)}</td>
                        <td className="px-space-md py-space-sm text-body-md text-on-surface">{p.descripcion}</td>
                        <td className={cn(td, "text-right font-semibold text-primary")}>{formatearUsdt(p.usdt)}</td>
                        <td className="px-space-md py-space-sm text-body-md text-on-surface">{p.usuario}</td>
                        <td className="px-space-md py-space-sm text-right">
                          {p.anulado ? (
                            <span className="text-body-sm text-error">Anulado</span>
                          ) : (
                            <BotonAnular
                              entidad="pagosTercero"
                              id={p.id}
                              titulo="el pago al tercero"
                              detalle={`${p.descripcion ?? "Pago"} (${formatearFecha(p.fecha)})`}
                              aviso="La plata vuelve a la caja USDT y a lo que se le debe al tercero."
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-margin">
          {d.disponible.gt(0) && (
            <FormPagoTercero
              key={typeof pago === "string" ? pago : "nuevo"}
              accion={registrarPagoTercero.bind(null, t.id)}
              hoy={hoy}
              disponible={{ texto: formatearUsdt(d.disponible), editable: textoEditable(d.disponible) }}
            />
          )}
          <FormTercero
            accion={actualizarTercero.bind(null, t.id)}
            inicial={{ nombre: t.nombre, pctDefault: t.pctDefault ? textoEditable(t.pctDefault) : "", notas: t.notas ?? "", activo: t.activo }}
          />
        </div>
      </div>
    </section>
  );
}
