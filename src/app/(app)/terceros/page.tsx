import Decimal from "decimal.js";
import { Handshake } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FormTercero } from "@/components/app/form-tercero";
import { db } from "@/db";
import { cuentasTerceros } from "@/db/terceros";
import { hoyArgentina } from "@/lib/hoy";
import { formatearUsdt } from "@/lib/numeros";
import { cn } from "@/lib/utils";
import { crearTercero } from "./actions";

export const metadata: Metadata = { title: "Terceros · Cierre & Reparto" };

export default async function TercerosPage() {
  const terceros = await cuentasTerceros(db, hoyArgentina());
  const th = "px-space-md py-space-sm text-label-caps text-on-surface-variant uppercase whitespace-nowrap text-right";
  const td = "px-space-md py-space-sm font-mono text-data-cell tabular-nums whitespace-nowrap text-right";
  const totalDeuda = terceros.reduce((s, t) => s.plus(t.deuda.disponible), new Decimal(0));

  return (
    <section className="flex flex-col gap-margin">
      <div className="flex flex-col">
        <span className="text-label-caps text-primary uppercase">Fondeadores</span>
        <h1 className="text-headline-xl text-on-surface">Terceros</h1>
        <p className="text-body-md text-on-surface-variant">
          Ponen plata en préstamos puntuales y se llevan el mismo % de la ganancia. El resto del préstamo es de la Sociedad.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-margin xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <section className="flex flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
          <div className="flex items-center gap-space-sm border-b border-outline-variant px-margin-panel py-space-md">
            <Handshake className="size-4 text-primary" aria-hidden />
            <h2 className="text-headline-sm text-on-surface">Cuentas</h2>
            <span className="ml-auto text-body-sm text-on-surface-variant">
              Se les debe <span className="font-mono tabular-nums text-on-surface">{formatearUsdt(totalDeuda)} USDT</span>
            </span>
          </div>
          {terceros.length === 0 ? (
            <p className="px-margin-panel py-margin text-center text-body-md text-on-surface-variant">Todavía no hay terceros.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="border-b border-outline-variant bg-surface-container-low">
                  <tr>
                    <th className={cn(th, "text-left")}>Tercero</th>
                    <th className={th}>Préstamos</th>
                    <th className={th}>Puso USDT</th>
                    <th className={th}>Recuperado</th>
                    <th className={th}>Ganancia</th>
                    <th className={th}>Pagado</th>
                    <th className={th}>Se le debe</th>
                  </tr>
                </thead>
                <tbody>
                  {terceros.map((t) => (
                    <tr key={t.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low">
                      <td className="px-space-md py-space-sm text-body-md">
                        <Link href={`/terceros/${t.id}`} className="text-primary hover:underline">
                          {t.nombre}
                        </Link>
                        {!t.activo && <span className="ml-space-sm text-body-sm text-on-surface-variant">(inactivo)</span>}
                      </td>
                      <td className={td}>{t.prestamos.filter((p) => p.estado === "vigente").length} vig. / {t.prestamos.length}</td>
                      <td className={td}>{formatearUsdt(t.deuda.puesto)}</td>
                      <td className={td}>{formatearUsdt(t.deuda.capitalRecuperado)}</td>
                      <td className={cn(td, "text-tertiary")}>{formatearUsdt(t.deuda.ganancia)}</td>
                      <td className={td}>{formatearUsdt(t.deuda.pagadoCapital.plus(t.deuda.pagadoGanancia))}</td>
                      <td className={cn(td, "font-semibold text-on-surface")}>{formatearUsdt(t.deuda.disponible)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <FormTercero accion={crearTercero} />
      </div>
    </section>
  );
}
