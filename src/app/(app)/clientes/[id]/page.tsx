import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeEstadoCliente } from "@/components/app/badge-estado-cliente";
import { FormCliente } from "@/components/app/form-cliente";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/db";
import { clientes, prestamos } from "@/db/schema";
import { formatearDocumento, formatearFecha } from "@/lib/formato";
import { numeroPrestamo } from "@/lib/prestamos";
import { actualizarCliente } from "../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function buscarCliente(id: string) {
  if (!UUID.test(id)) return null;
  const [cliente] = await db.select().from(clientes).where(eq(clientes.id, id));
  return cliente ?? null;
}

export async function generateMetadata({ params }: PageProps<"/clientes/[id]">): Promise<Metadata> {
  const cliente = await buscarCliente((await params).id);
  return { title: `${cliente?.nombre ?? "Cliente"} · Cierre & Reparto` };
}

export default async function ClientePage({ params }: PageProps<"/clientes/[id]">) {
  const { id } = await params;
  const cliente = await buscarCliente(id);
  if (!cliente) notFound();

  const susPrestamos = await db
    .select({ id: prestamos.id, numero: prestamos.numero, estado: prestamos.estado, fecha: prestamos.fechaDesembolso })
    .from(prestamos)
    .where(eq(prestamos.clienteId, id))
    .orderBy(desc(prestamos.fechaDesembolso));

  return (
    <section className="flex max-w-3xl flex-col gap-margin">
      <div className="flex flex-col gap-space-xs">
        <Link href="/clientes" className="text-body-md text-on-surface-variant hover:text-primary">
          ← Clientes
        </Link>
        <div className="flex items-center gap-space-md">
          <h1 className="text-headline-xl text-on-surface">{cliente.nombre}</h1>
          <BadgeEstadoCliente estado={cliente.estado} />
        </div>
        <p className="text-body-md text-on-surface-variant">
          {cliente.documento && (
            <span className="font-mono tabular-nums">{formatearDocumento(cliente.documento)} · </span>
          )}
          Alta <span className="font-mono tabular-nums">{formatearFecha(cliente.creadoEn)}</span>
        </p>
      </div>

      <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-margin-panel">
        <div className="mb-margin flex items-center justify-between gap-margin">
          <h2 className="text-headline-sm text-on-surface">Préstamos</h2>
          {cliente.estado === "activo" && (
            <Link href={`/prestamos/nuevo?cliente=${cliente.id}`} className={buttonVariants({ size: "sm" })}>
              Nuevo préstamo
            </Link>
          )}
        </div>
        {susPrestamos.length === 0 ? (
          <p className="text-body-md text-on-surface-variant">Este cliente todavía no tiene préstamos.</p>
        ) : (
          <ul className="flex flex-col gap-space-xs text-body-md">
            {susPrestamos.map((p) => (
              <li key={p.id} className="flex items-center gap-space-md">
                <Link href={`/prestamos/${p.id}`} className="font-mono text-primary tabular-nums hover:underline">{numeroPrestamo(p.numero)}</Link>
                <span className="font-mono text-on-surface-variant tabular-nums">{formatearFecha(p.fecha)}</span>
                <span className="text-on-surface-variant capitalize">{p.estado}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-margin-panel">
        <h2 className="mb-margin text-headline-sm text-on-surface">Datos del cliente</h2>
        <FormCliente
          accion={actualizarCliente.bind(null, cliente.id)}
          iniciales={{
            nombre: cliente.nombre,
            documento: formatearDocumento(cliente.documento),
            telefono: cliente.telefono ?? "",
            email: cliente.email ?? "",
            direccion: cliente.direccion ?? "",
            actividad: cliente.actividad ?? "",
            referencias: cliente.referencias ?? "",
            estado: cliente.estado,
            notas: cliente.notas ?? "",
          }}
          textoGuardar="Guardar cambios"
          cancelarHref="/clientes"
        />
      </div>
    </section>
  );
}
