import Decimal from "decimal.js";
import { Banknote, CircleCheck, History, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { BotonAnular } from "@/components/app/boton-anular";
import { FormConversion, type LoteForm } from "@/components/app/form-conversion";
import { db } from "@/db";
import { efectivoPendiente, historialConversiones, saldoCajaEfectivo } from "@/db/conversion";
import { diasEntre } from "@/engine/fechas";
import { formatearFecha } from "@/lib/formato";
import { hoyArgentina } from "@/lib/hoy";
import { formatearArs, formatearNumero, formatearUsdt } from "@/lib/numeros";
import { numeroPrestamo } from "@/lib/prestamos";
import { cn } from "@/lib/utils";
import { registrarConversion } from "./actions";

export const metadata: Metadata = { title: "Efectivo · Cierre & Reparto" };

function Etiqueta({ children }: { children: React.ReactNode }) {
  return <span className="text-label-caps text-on-surface-variant uppercase">{children}</span>;
}

function Tarjeta({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-space-sm rounded-lg border border-outline-variant bg-surface-container-lowest p-space-md">{children}</div>;
}

export default async function EfectivoPage({ searchParams }: PageProps<"/efectivo">) {
  const { convertido } = await searchParams;
  const hoy = hoyArgentina();
  const [pendientes, historial, caja] = await Promise.all([efectivoPendiente(db), historialConversiones(db), saldoCajaEfectivo(db)]);

  const total = pendientes.reduce((s, p) => s.plus(p.pendiente), new Decimal(0));
  const masViejo = pendientes[0];
  const diasMasViejo = masViejo ? diasEntre(masViejo.fecha, hoy) : 0;
  const mes = hoy.slice(0, 7);
  const delMes = historial.filter((c) => !c.anulada && c.fecha.startsWith(mes));
  const arsMes = delMes.reduce((s, c) => s.plus(c.ars), new Decimal(0));
  const usdtMes = delMes.reduce((s, c) => s.plus(c.usdt), new Decimal(0));
  const recienConvertida = typeof convertido === "string" ? historial.find((c) => c.id === convertido && !c.anulada) : undefined;

  const lotes: LoteForm[] = pendientes.map((p) => ({
    pagoId: p.pagoId,
    fecha: p.fecha,
    cliente: p.clienteNombre,
    destino: [...p.porPrestamo.map((x) => numeroPrestamo(x.numero)), ...(p.saldoFavor.gt(0) ? ["a favor"] : [])].join(", "),
    ars: p.ars.toFixed(2),
    pendiente: p.pendiente.toFixed(2),
  }));

  const th = "px-space-md py-space-sm text-label-caps text-on-surface-variant uppercase whitespace-nowrap";
  const td = "px-space-md py-space-sm font-mono text-data-cell tabular-nums whitespace-nowrap";

  return (
    <section className="flex flex-col gap-margin">
      <div className="flex flex-col">
        <span className="text-label-caps text-primary uppercase">Caja</span>
        <h1 className="text-headline-xl text-on-surface">Efectivo y conversión</h1>
      </div>

      {recienConvertida && (
        <p className="flex items-center gap-space-sm rounded-lg border border-riesgo-verde-borde bg-riesgo-verde-bg px-space-md py-space-sm text-body-md text-riesgo-verde-fg">
          <CircleCheck className="size-4" aria-hidden />
          Conversión registrada:{" "}
          <span className="font-mono tabular-nums">
            ${formatearArs(recienConvertida.ars)} → {formatearUsdt(recienConvertida.usdt)} USDT
          </span>
        </p>
      )}

      <div className="grid gap-gutter-compact md:grid-cols-3">
        <Tarjeta>
          <Etiqueta>Efectivo sin convertir</Etiqueta>
          <span className="font-mono text-headline-lg text-on-surface tabular-nums">${formatearArs(total)}</span>
          <span className="text-body-sm text-on-surface-variant">
            {pendientes.length} pago(s) en efectivo
            {!caja.eq(total) && (
              <span className="text-error">
                {" "}
                · la caja según el libro da <span className="font-mono tabular-nums">${formatearArs(caja)}</span>
              </span>
            )}
          </span>
        </Tarjeta>
        <Tarjeta>
          <Etiqueta>Antigüedad del más viejo</Etiqueta>
          <span className={cn("font-mono text-headline-lg tabular-nums", diasMasViejo > 7 ? "text-error" : "text-on-surface")}>
            {masViejo ? `${diasMasViejo} días` : "—"}
          </span>
          <span className="text-body-sm text-on-surface-variant">
            {masViejo ? <>Cobrado el <span className="font-mono tabular-nums">{formatearFecha(masViejo.fecha)}</span></> : "Sin efectivo pendiente"}
          </span>
        </Tarjeta>
        <Tarjeta>
          <Etiqueta>Convertido este mes</Etiqueta>
          <span className="font-mono tabular-nums">
            <span className="text-headline-lg text-on-surface">{formatearUsdt(usdtMes)}</span>{" "}
            <span className="text-data-currency-secondary text-on-surface-variant">USDT</span>
          </span>
          <span className="font-mono text-data-cell text-on-surface-variant tabular-nums">
            ${formatearArs(arsMes)} ARS
            {usdtMes.gt(0) && ` · TC prom. ${formatearNumero(arsMes.div(usdtMes), 2)}`}
          </span>
        </Tarjeta>
      </div>

      {total.gt(0) && (
        <p className="flex items-center gap-space-sm rounded-lg border border-riesgo-naranja-borde bg-riesgo-naranja-bg px-space-md py-space-sm text-body-md text-riesgo-naranja-fg">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          <span>
            Hay <span className="font-mono tabular-nums">${formatearArs(total)}</span> en efectivo; el más viejo hace{" "}
            <span className="font-mono tabular-nums">{diasMasViejo}</span> días sin convertir. Mientras no se convierta está expuesto a la
            devaluación y no hay ganancia realizada.
          </span>
        </p>
      )}

      <FormConversion key={convertido ? String(convertido) : "nueva"} accion={registrarConversion} lotes={lotes} hoy={hoy} />

      <section className="flex flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
        <div className="flex items-center gap-space-sm border-b border-outline-variant px-margin-panel py-space-md">
          <History className="size-4 text-primary" aria-hidden />
          <h2 className="text-headline-sm text-on-surface">Conversiones</h2>
        </div>
        {historial.length === 0 ? (
          <p className="flex items-center justify-center gap-space-sm px-margin-panel py-margin text-body-md text-on-surface-variant">
            <Banknote className="size-4" aria-hidden />
            Todavía no se convirtió efectivo.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr>
                  <th className={cn(th, "text-left")}>Fecha</th>
                  <th className={cn(th, "text-right")}>ARS</th>
                  <th className={cn(th, "text-right")}>TC</th>
                  <th className={cn(th, "text-right")}>USDT</th>
                  <th className={cn(th, "text-right")}>Lotes</th>
                  <th className={cn(th, "text-left")}>Notas</th>
                  <th className={cn(th, "text-left")}>Registró</th>
                  <th className={cn(th, "relative")}>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {historial.map((c) => (
                  <tr key={c.id} className={cn("border-b border-outline-variant/60 last:border-b-0", c.anulada && "text-on-surface-variant line-through")}>
                    <td className={td}>{formatearFecha(c.fecha)}</td>
                    <td className={cn(td, "text-right")}>${formatearArs(c.ars)}</td>
                    <td className={cn(td, "text-right")}>{formatearNumero(c.tc, Math.max(2, c.tc.decimalPlaces()))}</td>
                    <td className={cn(td, "text-right font-semibold text-primary")}>{formatearUsdt(c.usdt)}</td>
                    <td className={cn(td, "text-right")}>{c.lotes}</td>
                    <td className="px-space-md py-space-sm text-body-md text-on-surface-variant">{c.notas ?? "—"}</td>
                    <td className="px-space-md py-space-sm text-body-md text-on-surface">{c.usuario}</td>
                    <td className="px-space-md py-space-sm text-right">
                      {c.anulada ? (
                        <span className="text-body-sm text-error">Anulada</span>
                      ) : (
                        <BotonAnular
                          entidad="conversiones"
                          id={c.id}
                          titulo="la conversión"
                          detalle={`Conversión del ${formatearFecha(c.fecha)}: $${formatearArs(c.ars)} a TC ${formatearNumero(c.tc, Math.max(2, c.tc.decimalPlaces()))} = ${formatearUsdt(c.usdt)} USDT`}
                          aviso="El efectivo vuelve a quedar sin convertir y se revierten el ingreso de USDT, el recupero de costo y la ganancia."
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
    </section>
  );
}
