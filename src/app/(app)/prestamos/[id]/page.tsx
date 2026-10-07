import Decimal from "decimal.js";
import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { clientes, cuotas, prestamos } from "@/db/schema";
import { formatearDocumento, formatearFecha } from "@/lib/formato";
import { formatearArs, formatearPct, formatearTc, formatearUsdt } from "@/lib/numeros";
import { FRECUENCIAS, numeroPrestamo } from "@/lib/prestamos";
import { cn } from "@/lib/utils";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function buscar(id: string) {
  if (!UUID.test(id)) return null;
  const [fila] = await db
    .select({ prestamo: prestamos, cliente: { id: clientes.id, nombre: clientes.nombre, documento: clientes.documento } })
    .from(prestamos)
    .innerJoin(clientes, eq(clientes.id, prestamos.clienteId))
    .where(eq(prestamos.id, id));
  return fila ?? null;
}

export async function generateMetadata({ params }: PageProps<"/prestamos/[id]">): Promise<Metadata> {
  const fila = await buscar((await params).id);
  return { title: `${fila ? numeroPrestamo(fila.prestamo.numero) : "Préstamo"} · Cierre & Reparto` };
}

/** Ficha mínima del préstamo; la ficha completa (pagos, saldo, mora) viene después. */
export default async function PrestamoPage({ params }: PageProps<"/prestamos/[id]">) {
  const { id } = await params;
  const fila = await buscar(id);
  if (!fila) notFound();
  const { prestamo: p, cliente } = fila;

  const plan = (await db.select().from(cuotas).where(eq(cuotas.prestamoId, id)).orderBy(asc(cuotas.numero))).map((c) => ({
    ...c,
    arsCapital: new Decimal(c.arsCapital),
    arsInteres: new Decimal(c.arsInteres),
  }));
  const arsCapital = new Decimal(p.arsCapital);
  const arsInteres = new Decimal(p.arsInteresPactado);

  const datos: [string, string][] = [
    ["Capital", `$${formatearArs(arsCapital)}`],
    ["TC entrada", formatearTc(p.tcEntrada)],
    ["USDT prestado", `${formatearUsdt(p.usdtPrestado)} USDT`],
    ["Tasa mensual / total", `${formatearPct(p.tasaMensualPct)}% / ${formatearPct(p.tasaTotalPct)}%`],
    ["Interés pactado", `$${formatearArs(arsInteres)}`],
    ["Total a cobrar", `$${formatearArs(arsCapital.plus(arsInteres))}`],
    ["Mora / gracia", `${formatearPct(p.moraPct)}% / ${p.diasGracia} días`],
    ["Desembolso / vence", `${formatearFecha(p.fechaDesembolso)} / ${formatearFecha(p.vencimientoFinal)}`],
  ];

  const td = "px-space-sm py-space-xs text-right font-mono text-data-cell tabular-nums";
  const th = "px-space-sm py-space-sm text-right text-label-caps text-on-surface-variant uppercase";

  return (
    <section className="flex max-w-4xl flex-col gap-margin">
      <div className="flex flex-col gap-space-xs">
        <Link href="/prestamos" className="text-body-md text-on-surface-variant hover:text-primary">
          ← Préstamos
        </Link>
        <h1 className="flex items-baseline gap-space-md text-headline-xl text-on-surface">
          <span className="font-mono tabular-nums">{numeroPrestamo(p.numero)}</span>
          <Link href={`/clientes/${cliente.id}`} className="text-headline-lg hover:text-primary hover:underline">
            {cliente.nombre}
          </Link>
        </h1>
        <p className="text-body-md text-on-surface-variant">
          {cliente.documento && <span className="font-mono tabular-nums">{formatearDocumento(cliente.documento)} · </span>}
          {p.nCuotas} cuotas {FRECUENCIAS[p.frecuencia].plural} · <span className="capitalize">{p.estado}</span>
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-gutter-compact md:grid-cols-4">
        {datos.map(([etiqueta, valor]) => (
          <div key={etiqueta} className="flex flex-col gap-space-xs rounded-lg border border-outline-variant bg-surface-container-lowest p-space-md">
            <dt className="text-label-caps text-on-surface-variant uppercase">{etiqueta}</dt>
            <dd className="font-mono text-data-cell text-on-surface tabular-nums">{valor}</dd>
          </div>
        ))}
      </dl>

      <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
        <table className="w-full border-collapse">
          <thead className="bg-surface-container-low">
            <tr>
              <th className={cn(th, "text-left")}>N°</th>
              <th className={cn(th, "text-left")}>Vencimiento</th>
              <th className={th}>Capital</th>
              <th className={th}>Interés</th>
              <th className={th}>Total ARS</th>
            </tr>
          </thead>
          <tbody>
            {plan.map((c) => (
              <tr key={c.id} className="border-t border-outline-variant/50">
                <td className={cn(td, "text-left text-primary")}>#{String(c.numero).padStart(2, "0")}</td>
                <td className={cn(td, "text-left")}>{formatearFecha(c.vencimiento)}</td>
                <td className={td}>{formatearArs(c.arsCapital)}</td>
                <td className={cn(td, "text-tertiary")}>{formatearArs(c.arsInteres)}</td>
                <td className={td}>{formatearArs(c.arsCapital.plus(c.arsInteres))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {p.notas && <p className="text-body-md whitespace-pre-line text-on-surface-variant">{p.notas}</p>}
    </section>
  );
}
