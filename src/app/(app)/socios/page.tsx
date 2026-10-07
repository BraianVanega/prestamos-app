import Decimal from "decimal.js";
import { CircleCheck, History, Users } from "lucide-react";
import type { Metadata } from "next";
import { FormAporte } from "@/components/app/form-aporte";
import { db } from "@/db";
import { cuentasSocios, historialAportes } from "@/db/socios";
import { formatearFecha } from "@/lib/formato";
import { hoyArgentina } from "@/lib/hoy";
import { formatearPct, formatearUsdt } from "@/lib/numeros";
import { cn } from "@/lib/utils";
import { registrarAporte } from "./actions";

export const metadata: Metadata = { title: "Socios · Cierre & Reparto" };

function Etiqueta({ children }: { children: React.ReactNode }) {
  return <span className="text-label-caps text-on-surface-variant uppercase">{children}</span>;
}

function Usdt({ valor, className }: { valor: Decimal; className?: string }) {
  return (
    <span className="font-mono tabular-nums">
      <span className={cn("text-headline-lg", className ?? "text-on-surface")}>{formatearUsdt(valor)}</span>{" "}
      <span className="text-data-currency-secondary text-on-surface-variant">USDT</span>
    </span>
  );
}

function Tarjeta({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-space-sm rounded-lg border border-outline-variant bg-surface-container-lowest p-space-md">{children}</div>;
}

export default async function SociosPage({ searchParams }: PageProps<"/socios">) {
  const { aporte } = await searchParams;
  const [cuentas, aportes] = await Promise.all([cuentasSocios(db), historialAportes(db)]);
  const sumar = (f: (s: (typeof cuentas.socios)[number]) => Decimal) => cuentas.socios.reduce((s, x) => s.plus(f(x)), new Decimal(0));
  const capital = sumar((s) => s.capital);
  const ganancia = sumar((s) => s.ganancia);
  const nombres = new Map(cuentas.socios.map((s) => [s.id, s.nombre]));
  const recien = typeof aporte === "string" ? aportes.find((a) => a.id === aporte) : undefined;

  const th = "px-space-md py-space-sm text-label-caps text-on-surface-variant uppercase whitespace-nowrap";
  const td = "px-space-md py-space-sm font-mono text-data-cell tabular-nums whitespace-nowrap";

  return (
    <section className="flex flex-col gap-margin">
      <div className="flex flex-col">
        <span className="text-label-caps text-primary uppercase">Sociedad</span>
        <h1 className="text-headline-xl text-on-surface">Socios y aportes</h1>
      </div>

      {recien && (
        <p className="flex items-center gap-space-sm rounded-lg border border-riesgo-verde-borde bg-riesgo-verde-bg px-space-md py-space-sm text-body-md text-riesgo-verde-fg">
          <CircleCheck className="size-4" aria-hidden />
          Aporte registrado: <span className="font-mono tabular-nums">{formatearUsdt(recien.usdt)} USDT</span>
        </p>
      )}

      <div className="grid gap-gutter-compact md:grid-cols-2 xl:grid-cols-4">
        <Tarjeta>
          <Etiqueta>Caja USDT</Etiqueta>
          <Usdt valor={cuentas.caja} className={cuentas.caja.lt(0) ? "text-error" : undefined} />
          <span className="text-body-sm text-on-surface-variant">
            {cuentas.caja.lt(0) ? "Negativa: se prestó más de lo aportado y cobrado." : "Disponible en la caja única."}
          </span>
        </Tarjeta>
        <Tarjeta>
          <Etiqueta>Capital aportado</Etiqueta>
          <Usdt valor={capital} />
          <span className="text-body-sm text-on-surface-variant">Capital protegido de los socios.</span>
        </Tarjeta>
        <Tarjeta>
          <Etiqueta>Cartera colocada</Etiqueta>
          <Usdt valor={cuentas.cartera} />
          <span className="text-body-sm text-on-surface-variant">Costo en USDT aún no recuperado.</span>
        </Tarjeta>
        <Tarjeta>
          <Etiqueta>Ganancia realizada</Etiqueta>
          <Usdt valor={ganancia} className="text-tertiary" />
          <span className="text-body-sm text-on-surface-variant">
            {cuentas.saldoFavor.gt(0) ? (
              <>
                Saldo a favor de clientes: <span className="font-mono tabular-nums">{formatearUsdt(cuentas.saldoFavor)} USDT</span>
              </>
            ) : (
              "Lo cobrado por encima del costo, sin retirar."
            )}
          </span>
        </Tarjeta>
      </div>

      <div className="grid grid-cols-1 items-start gap-margin xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <section className="flex flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
          <div className="flex items-center gap-space-sm border-b border-outline-variant px-margin-panel py-space-md">
            <Users className="size-4 text-primary" aria-hidden />
            <h2 className="text-headline-sm text-on-surface">Cuentas por socio</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr>
                  <th className={cn(th, "text-left")}>Socio</th>
                  <th className={cn(th, "text-right")}>% sociedad</th>
                  <th className={cn(th, "text-right")}>Capital aportado</th>
                  <th className={cn(th, "text-right")}>Ganancia realizada</th>
                  <th className={cn(th, "text-right")}>Total</th>
                </tr>
              </thead>
              <tbody>
                {cuentas.socios.map((s) => (
                  <tr key={s.id} className="border-b border-outline-variant/60 last:border-b-0">
                    <td className="px-space-md py-space-sm text-body-md font-medium text-on-surface">{s.nombre}</td>
                    <td className={cn(td, "text-right")}>{formatearPct(s.pctSociedad)}%</td>
                    <td className={cn(td, "text-right")}>{formatearUsdt(s.capital)}</td>
                    <td className={cn(td, "text-right text-tertiary")}>{formatearUsdt(s.ganancia)}</td>
                    <td className={cn(td, "text-right font-semibold")}>{formatearUsdt(s.capital.plus(s.ganancia))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-outline-variant bg-surface-container-low">
                <tr>
                  <td colSpan={2} className="px-space-md py-space-sm text-body-md font-medium text-on-surface">
                    Total
                  </td>
                  <td className={cn(td, "text-right font-semibold")}>{formatearUsdt(capital)}</td>
                  <td className={cn(td, "text-right font-semibold text-tertiary")}>{formatearUsdt(ganancia)}</td>
                  <td className={cn(td, "text-right font-semibold")}>{formatearUsdt(capital.plus(ganancia))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="border-t border-outline-variant px-margin-panel py-space-sm text-body-sm text-on-surface-variant">
            Lo que está a nombre de la Sociedad se reparte según el % de cada socio. Los retiros llegan en la fase 2.
          </p>
        </section>

        <FormAporte
          key={recien?.id ?? "nuevo"}
          accion={registrarAporte}
          socios={cuentas.socios.map((s) => ({ id: s.id, nombre: s.nombre, pct: formatearPct(s.pctSociedad) }))}
          hoy={hoyArgentina()}
        />
      </div>

      <section className="flex flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
        <div className="flex items-center gap-space-sm border-b border-outline-variant px-margin-panel py-space-md">
          <History className="size-4 text-primary" aria-hidden />
          <h2 className="text-headline-sm text-on-surface">Aportes</h2>
        </div>
        {aportes.length === 0 ? (
          <p className="px-margin-panel py-margin text-center text-body-md text-on-surface-variant">Todavía no hay aportes registrados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr>
                  <th className={cn(th, "text-left")}>Fecha</th>
                  <th className={cn(th, "text-left")}>Detalle</th>
                  {cuentas.socios.map((s) => (
                    <th key={s.id} className={cn(th, "text-right")}>
                      {s.nombre}
                    </th>
                  ))}
                  <th className={cn(th, "text-right")}>Total USDT</th>
                  <th className={cn(th, "text-left")}>Registró</th>
                </tr>
              </thead>
              <tbody>
                {aportes.map((a) => (
                  <tr key={a.id} className={cn("border-b border-outline-variant/60 last:border-b-0", a.anulado && "text-on-surface-variant line-through")}>
                    <td className={td}>{formatearFecha(a.fecha)}</td>
                    <td className="px-space-md py-space-sm text-body-md text-on-surface">{a.descripcion}</td>
                    {cuentas.socios.map((s) => {
                      const parte = a.porSocio.find((x) => x.participanteId === s.id);
                      return (
                        <td key={s.id} className={cn(td, "text-right")}>
                          {parte ? formatearUsdt(parte.usdt) : "—"}
                        </td>
                      );
                    })}
                    <td className={cn(td, "text-right font-semibold text-primary")}>{formatearUsdt(a.usdt)}</td>
                    <td className="px-space-md py-space-sm text-body-md text-on-surface">{a.usuario}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {aportes.some((a) => a.porSocio.some((x) => !nombres.has(x.participanteId))) && (
          <p className="px-margin-panel py-space-sm text-body-sm text-on-surface-variant">Hay aportes de participantes que ya no están activos.</p>
        )}
      </section>
    </section>
  );
}
