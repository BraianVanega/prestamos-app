import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { FormPrestamo, type OpcionCliente } from "@/components/app/form-prestamo";
import { db } from "@/db";
import { clientes } from "@/db/schema";
import { DIAS_GRACIA_SUGERIDOS, MORA_PCT_SUGERIDA } from "@/engine/mora";
import { formatearDocumento } from "@/lib/formato";
import { hoyArgentina } from "@/lib/hoy";
import { crearPrestamo } from "../actions";

export const metadata: Metadata = { title: "Nuevo préstamo · Cierre & Reparto" };

export default async function NuevoPrestamoPage({ searchParams }: PageProps<"/prestamos/nuevo">) {
  const { cliente } = await searchParams;

  const activos = await db
    .select({ id: clientes.id, nombre: clientes.nombre, documento: clientes.documento })
    .from(clientes)
    .where(eq(clientes.estado, "activo"))
    .orderBy(asc(clientes.nombre));

  const opciones: OpcionCliente[] = activos.map((c) => ({
    value: c.id,
    label: c.nombre,
    documento: formatearDocumento(c.documento),
  }));
  const inicial = typeof cliente === "string" ? (opciones.find((o) => o.value === cliente) ?? null) : null;

  return (
    <FormPrestamo
      accion={crearPrestamo}
      clientes={opciones}
      clienteInicial={inicial}
      hoy={hoyArgentina()}
      moraSugerida={MORA_PCT_SUGERIDA}
      graciaSugerida={DIAS_GRACIA_SUGERIDOS}
    />
  );
}
