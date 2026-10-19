import Decimal from "decimal.js";
import { Banknote, CircleCheck, History, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { BotonAnular } from "@/components/app/boton-anular";
import { FormConversion, type LoteForm } from "@/components/app/form-conversion";
import { SubnavPlata } from "@/components/app/subnav-plata";
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
  return <span className="text-label text-muted-foreground">{children}</span>;
}

function Tarjeta({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-space-sm rounded-lg border border-border bg-card p-space-md">{children}</div>;
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

  const th = "px-space-md py-space-sm text-label text-muted-foreground whitespace-nowrap";
  const td = "px-space-md py-space-sm font-mono text-data-cell tabular-nums whitespace-nowrap";

  return (
    <section className="flex flex-col gap-margin">
      <SubnavPlata />
      <div className="flex flex-col">
        <span className="text-label text-link">Caja</span>
        <h1 className="text-headline-xl text-foreground">Efectivo y conversión</h1>
      </div>

      {recienConvertida && (
        <p className="flex items-center gap-space-sm rounded-lg border border-success/25 bg-success-soft px-space-md py-space-sm text-body-md text-success">
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
          <span className="font-mono text-headline-lg font-medium text-foreground tabular-nums">${formatearArs(total)}</span>
          <span className="text-body-sm text-muted-foreground">
            {pendientes.length} pago(s) en efectivo
            {!caja.eq(total) && (
              <span className="text-danger">
                {" "}
                · la caja según el libro da <span className="font-mono tabular-nums">${formatearArs(caja)}</span>
              </span>
            )}
          </span>
        </Tarjeta>
        <Tarjeta>
          <Etiqueta>Antigüedad del más viejo</Etiqueta>
          <span className={cn("font-mono text-headline-lg font-medium tabular-nums", diasMasViejo > 7 ? "text-danger" : "text-foreground")}>
            {masViejo ? `${diasMasViejo} días` : "—"}
          </span>
          <span className="text-body-sm text-muted-foreground">
            {masViejo ? <>Cobrado el <span className="font-mono tabular-nums">{formatearFecha(masViejo.fecha)}</span></> : "Sin efectivo pendiente"}
          </span>
        </Tarjeta>
        <Tarjeta>
          <Etiqueta>Convertido este mes</Etiqueta>
          <span className="font-mono tabular-nums">
            <span className="text-headline-lg text-foreground">{formatearUsdt(usdtMes)}</span>{" "}
            <span className="text-data-currency-secondary text-usdt">USDT</span>
          </span>
          <span className="font-mono text-data-cell text-muted-foreground tabular-nums">
            ${formatearArs(arsMes)} ARS
            {usdtMes.gt(0) && ` · TC prom. ${formatearNumero(arsMes.div(usdtMes), 2)}`}
          </span>
        </Tarjeta>
      </div>

      {total.gt(0) && (
        <p className="flex items-center gap-space-sm rounded-lg border border-warning/25 bg-warning-soft px-space-md py-space-sm text-body-md text-warning">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          <span>
            Hay <span className="font-mono tabular-nums">${formatearArs(total)}</span> en efectivo; el más viejo hace{" "}
            <span className="font-mono tabular-nums">{diasMasViejo}</span> días sin convertir. Mientras no se convierta está expuesto a la
            devaluación y no hay ganancia realizada.
          </span>
        </p>
      )}

      <FormConversion key={convertido ? String(convertido) : "nueva"} accion={registrarConversion} lotes={lotes} hoy={hoy} />

      <section className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-space-sm border-b border-border px-margin-panel py-space-md">
          <History className="size-4 text-link" aria-hidden />
          <h2 className="text-headline-sm text-foreground">Conversiones</h2>
        </div>
        {historial.length === 0 ? (
          <p className="flex items-center justify-center gap-space-sm px-margin-panel py-margin text-body-md text-muted-foreground">
            <Banknote className="size-4" aria-hidden />
            Todavía no se convirtió efectivo.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="border-b border-border bg-muted">
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
                  <tr key={c.id} className={cn("border-b border-border/60 last:border-b-0", c.anulada && "text-muted-foreground line-through")}>
                    <td className={td}>{formatearFecha(c.fecha)}</td>
                    <td className={cn(td, "text-right")}>${formatearArs(c.ars)}</td>
                    <td className={cn(td, "text-right")}>{formatearNumero(c.tc, Math.max(2, c.tc.decimalPlaces()))}</td>
                    <td className={cn(td, "text-right font-semibold text-link")}>{formatearUsdt(c.usdt)}</td>
                    <td className={cn(td, "text-right")}>{c.lotes}</td>
                    <td className="px-space-md py-space-sm text-body-md text-muted-foreground">{c.notas ?? "—"}</td>
                    <td className="px-space-md py-space-sm text-body-md text-foreground">{c.usuario}</td>
                    <td className="px-space-md py-space-sm text-right">
                      {c.anulada ? (
                        <span className="text-body-sm text-danger">Anulada</span>
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
