import { asc, count, ne, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { FormPago, type OpcionClientePago } from "@/components/app/form-pago";
import { db } from "@/db";
import { cargarDeudaCliente, saldoFavorCliente } from "@/db/registrar-pago";
import { clientes, prestamos } from "@/db/schema";
import { formatearDocumento } from "@/lib/formato";
import { hoyArgentina } from "@/lib/hoy";
import { registrarPago } from "../actions";

export const metadata: Metadata = { title: "Registrar pago · Cierre & Reparto" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RegistrarPagoPage({ searchParams }: PageProps<"/pagos/nuevo">) {
  const { cliente } = await searchParams;

  // Primero los clientes con préstamos vigentes; los inactivos no pagan.
  const filas = await db
    .select({
      id: clientes.id,
      nombre: clientes.nombre,
      documento: clientes.documento,
      vigentes: count(prestamos.id),
    })
    .from(clientes)
    .leftJoin(prestamos, sql`${prestamos.clienteId} = ${clientes.id} and ${prestamos.estado} = 'vigente'`)
    .where(ne(clientes.estado, "inactivo"))
    .groupBy(clientes.id)
    .orderBy(sql`count(${prestamos.id}) = 0`, asc(clientes.nombre));

  const opciones: OpcionClientePago[] = filas.map((c) => ({
    value: c.id,
    label: c.nombre,
    documento: formatearDocumento(c.documento),
    vigentes: c.vigentes,
  }));
  const elegido = typeof cliente === "string" && UUID.test(cliente) ? (opciones.find((o) => o.value === cliente) ?? null) : null;

  const [deuda, saldoFavor] = elegido
    ? await Promise.all([cargarDeudaCliente(db, elegido.value), saldoFavorCliente(db, elegido.value)])
    : [[], null];

  return (
    <FormPago
      key={elegido?.value ?? "ninguno"}
      accion={registrarPago}
      clientes={opciones}
      cliente={elegido}
      prestamos={deuda}
      saldoFavor={saldoFavor?.toFixed(2) ?? "0"}
      hoy={hoyArgentina()}
    />
  );
}
