import { Ban, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/db";
import { historialAnulaciones, type AnulacionHistorial } from "@/db/anulaciones";
import { formatearFechaHora } from "@/lib/formato";

export const metadata: Metadata = { title: "Anulaciones · Cierre & Reparto" };

const ENTIDADES: Record<AnulacionHistorial["entidad"], string> = {
  pagos: "Pago",
  conversiones: "Conversión",
  aportes: "Aporte",
  cargos: "Cargo",
  prestamos: "Préstamo",
  pagosTercero: "Pago a tercero",
};

const DONDE = [
  ["Pagos", "desde el historial de la ficha del préstamo (evento Cobro)."],
  ["Mora, descuentos y ajustes", "desde la ficha del préstamo."],
  ["Conversiones", "desde Efectivo, en el historial de conversiones."],
  ["Aportes", "desde Socios, en el historial de aportes."],
  ["Pagos a terceros", "desde la ficha del tercero, en el historial de pagos."],
  ["Préstamos", "con Editar en la ficha del préstamo: se anula y se da de alta con los cambios; sus cobros se reimputan."],
] as const;

export default async function AnulacionesPage() {
  const anulaciones = await historialAnulaciones(db);
  const th = "px-space-md py-space-sm text-label text-muted-foreground whitespace-nowrap text-left";

  return (
    <section className="flex flex-col gap-margin">
      <div className="flex flex-col">
        <span className="text-label text-link">Correcciones</span>
        <h1 className="text-headline-xl text-foreground">Anulaciones</h1>
        <p className="text-body-md text-muted-foreground">
          Nada se edita ni se borra: un error se corrige anulando el registro, con su motivo, y volviéndolo a cargar bien.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-margin-panel">
        <div className="mb-space-sm flex items-center gap-space-sm">
          <Ban className="size-4 text-link" aria-hidden />
          <h2 className="text-label text-foreground">Cómo anular</h2>
        </div>
        <ul className="grid gap-x-margin gap-y-space-xs text-body-md text-muted-foreground md:grid-cols-2">
          {DONDE.map(([que, donde]) => (
            <li key={que}>
              <span className="font-medium text-foreground">{que}:</span> {donde}
            </li>
          ))}
        </ul>
        <p className="mt-space-sm text-body-sm text-muted-foreground">
          Si hay movimientos posteriores que dependen de lo que querés anular (otro cobro del mismo préstamo, una conversión de ese
          efectivo), primero se anulan esos, del más nuevo al más viejo.
        </p>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-space-sm border-b border-border px-margin-panel py-space-md">
          <History className="size-4 text-link" aria-hidden />
          <h2 className="text-headline-sm text-foreground">Historial</h2>
        </div>
        {anulaciones.length === 0 ? (
          <p className="px-margin-panel py-margin text-center text-body-md text-muted-foreground">Todavía no se anuló nada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="border-b border-border bg-muted">
                <tr>
                  <th className={th}>Fecha</th>
                  <th className={th}>Tipo</th>
                  <th className={th}>Qué se anuló</th>
                  <th className={th}>Motivo</th>
                  <th className={th}>Anuló</th>
                </tr>
              </thead>
              <tbody>
                {anulaciones.map((a) => (
                  <tr key={a.id} className="border-b border-border/60 last:border-b-0">
                    <td className="px-space-md py-space-sm font-mono text-data-cell whitespace-nowrap tabular-nums">{formatearFechaHora(a.en)}</td>
                    <td className="px-space-md py-space-sm">
                      <span className="rounded-full border border-danger/25 bg-danger-soft px-space-sm py-space-2xs text-badge-label text-danger">
                        {ENTIDADES[a.entidad]}
                      </span>
                    </td>
                    <td className="px-space-md py-space-sm text-body-md">
                      <Link href={a.enlace} className="text-foreground underline-offset-4 hover:text-link hover:underline">
                        {a.descripcion}
                      </Link>
                    </td>
                    <td className="px-space-md py-space-sm text-body-md text-muted-foreground">{a.motivo}</td>
                    <td className="px-space-md py-space-sm text-body-md whitespace-nowrap text-foreground">{a.usuario}</td>
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
