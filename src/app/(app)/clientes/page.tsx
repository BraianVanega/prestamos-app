import { and, asc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BadgeEstadoCliente } from "@/components/app/badge-estado-cliente";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { clientes, prestamos } from "@/db/schema";
import { ESTADOS_CLIENTE, type EstadoCliente } from "@/lib/clientes";
import { formatearDocumento, formatearFecha } from "@/lib/formato";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Clientes · Cierre & Reparto" };

const LIMITE = 200;

const esEstado = (v: unknown): v is EstadoCliente => typeof v === "string" && v in ESTADOS_CLIENTE;

/** Patrón para ILIKE con los comodines del usuario escapados. */
const contiene = (texto: string) => `%${texto.replace(/[\\%_]/g, "\\$&")}%`;

export default async function ClientesPage({ searchParams }: PageProps<"/clientes">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const estado = esEstado(params.estado) ? params.estado : null;

  const filtros: SQL[] = [];
  if (estado) filtros.push(eq(clientes.estado, estado));
  if (q) {
    const digitos = q.replace(/\D/g, "");
    const condiciones = [ilike(clientes.nombre, contiene(q)), ilike(clientes.telefono, contiene(q))];
    if (digitos) condiciones.push(ilike(clientes.documento, contiene(digitos)));
    condiciones.push(ilike(clientes.documento, contiene(q.toUpperCase())));
    filtros.push(or(...condiciones)!);
  }

  const vigentes = db
    .select({
      clienteId: prestamos.clienteId,
      cantidad: sql<number>`count(*)::int`.as("cantidad"),
    })
    .from(prestamos)
    .where(eq(prestamos.estado, "vigente"))
    .groupBy(prestamos.clienteId)
    .as("vigentes");

  const [filas, conteos] = await Promise.all([
    db
      .select({
        id: clientes.id,
        nombre: clientes.nombre,
        documento: clientes.documento,
        telefono: clientes.telefono,
        estado: clientes.estado,
        creadoEn: clientes.creadoEn,
        prestamosVigentes: sql<number>`coalesce(${vigentes.cantidad}, 0)`,
      })
      .from(clientes)
      .leftJoin(vigentes, eq(vigentes.clienteId, clientes.id))
      .where(filtros.length ? and(...filtros) : undefined)
      .orderBy(asc(clientes.nombre))
      .limit(LIMITE),
    db
      .select({ estado: clientes.estado, cantidad: sql<number>`count(*)::int` })
      .from(clientes)
      .groupBy(clientes.estado),
  ]);

  const total = conteos.reduce((acc, c) => acc + c.cantidad, 0);
  const pestañas: { valor: EstadoCliente | null; etiqueta: string; cantidad: number }[] = [
    { valor: null, etiqueta: "Todos", cantidad: total },
    ...(Object.keys(ESTADOS_CLIENTE) as EstadoCliente[]).map((e) => ({
      valor: e,
      etiqueta: ESTADOS_CLIENTE[e],
      cantidad: conteos.find((c) => c.estado === e)?.cantidad ?? 0,
    })),
  ];

  const hrefCon = (cambios: { estado?: EstadoCliente | null }) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    const e = "estado" in cambios ? cambios.estado : estado;
    if (e) sp.set("estado", e);
    const s = sp.toString();
    return s ? `/clientes?${s}` : "/clientes";
  };

  return (
    <section className="flex flex-col gap-margin">
      <div className="flex items-center justify-between gap-margin">
        <h1 className="text-headline-xl text-on-surface">Clientes</h1>
        <Link href="/clientes/nuevo" className={cn(buttonVariants(), "gap-space-sm")}>
          <Plus aria-hidden />
          Nuevo cliente
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-gutter">
        <nav aria-label="Filtrar por estado" className="flex gap-space-xs">
          {pestañas.map((p) => {
            const activa = p.valor === estado;
            return (
              <Link
                key={p.etiqueta}
                href={hrefCon({ estado: p.valor })}
                aria-current={activa ? "page" : undefined}
                className={cn(
                  "rounded-full px-space-md py-space-xs text-body-md font-medium transition-colors",
                  activa
                    ? "bg-primary-container text-on-primary"
                    : "bg-surface-container-low text-on-surface hover:bg-surface-container",
                )}
              >
                {p.etiqueta} <span className="font-mono tabular-nums">({p.cantidad})</span>
              </Link>
            );
          })}
        </nav>

        <form action="/clientes" role="search" className="relative ml-auto w-full max-w-sm">
          {estado && <input type="hidden" name="estado" value={estado} />}
          <Search
            className="pointer-events-none absolute top-1/2 left-space-md size-4 -translate-y-1/2 text-on-surface-variant"
            aria-hidden
          />
          <Input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Filtrar por nombre, DNI/CUIT o teléfono…"
            aria-label="Filtrar clientes"
            className="bg-surface-container-lowest pl-8"
          />
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
        <Table>
          <TableHeader className="bg-surface-container-low">
            <TableRow>
              <TableHead className="text-label-caps text-on-surface-variant uppercase">Cliente</TableHead>
              <TableHead className="text-label-caps text-on-surface-variant uppercase">DNI / CUIT</TableHead>
              <TableHead className="text-label-caps text-on-surface-variant uppercase">Teléfono</TableHead>
              <TableHead className="text-label-caps text-on-surface-variant uppercase">Estado</TableHead>
              <TableHead className="text-right text-label-caps text-on-surface-variant uppercase">Préstamos vigentes</TableHead>
              <TableHead className="text-right text-label-caps text-on-surface-variant uppercase">Alta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((c) => (
              <TableRow key={c.id} className="h-10">
                <TableCell>
                  <Link href={`/clientes/${c.id}`} className="font-medium text-on-surface hover:text-primary hover:underline">
                    {c.nombre}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-data-cell tabular-nums">{formatearDocumento(c.documento)}</TableCell>
                <TableCell className="font-mono text-data-cell tabular-nums">{c.telefono}</TableCell>
                <TableCell>
                  <BadgeEstadoCliente estado={c.estado} />
                </TableCell>
                <TableCell className="text-right font-mono text-data-cell tabular-nums">{c.prestamosVigentes}</TableCell>
                <TableCell className="text-right font-mono text-data-cell tabular-nums">{formatearFecha(c.creadoEn)}</TableCell>
              </TableRow>
            ))}
            {filas.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-margin-panel text-center text-body-lg text-on-surface-variant">
                  {q || estado ? "No hay clientes que coincidan con el filtro." : "Todavía no cargaste clientes."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {filas.length === LIMITE && (
        <p className="text-body-sm text-on-surface-variant">
          Se muestran los primeros <span className="font-mono tabular-nums">{LIMITE}</span>. Usá el filtro para encontrar al resto.
        </p>
      )}
    </section>
  );
}
