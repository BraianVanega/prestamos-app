import { and, asc, eq, notInArray, or } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Alerta } from "@/components/app/campos";
import { FormPrestamo, type OpcionCliente } from "@/components/app/form-prestamo";
import { db } from "@/db";
import { anulaciones, clientes, imputaciones, prestamos } from "@/db/schema";
import { DIAS_GRACIA_SUGERIDOS, MORA_PCT_SUGERIDA } from "@/engine/mora";
import { formatearDocumento } from "@/lib/formato";
import { hoyArgentina } from "@/lib/hoy";
import { textoEditable } from "@/lib/numeros";
import { numeroPrestamo } from "@/lib/prestamos";
import { corregirPrestamo } from "../../actions";

export const metadata: Metadata = { title: "Corregir préstamo · Cierre & Reparto" };

export default async function EditarPrestamoPage({ params }: PageProps<"/prestamos/[id]/editar">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [p] = await db.select().from(prestamos).where(eq(prestamos.id, id));
  if (!p) notFound();
  const numero = numeroPrestamo(p.numero);
  const volver = `/prestamos/${p.id}`;

  const pagosAnulados = db.select({ id: anulaciones.entidadId }).from(anulaciones).where(eq(anulaciones.entidad, "pagos"));
  const [conPagos, opciones] = await Promise.all([
    db
      .selectDistinct({ id: imputaciones.pagoId })
      .from(imputaciones)
      .where(and(eq(imputaciones.prestamoId, id), notInArray(imputaciones.pagoId, pagosAnulados))),
    db
      .select({ id: clientes.id, nombre: clientes.nombre, documento: clientes.documento })
      .from(clientes)
      .where(or(eq(clientes.estado, "activo"), eq(clientes.id, p.clienteId)))
      .orderBy(asc(clientes.nombre)),
  ]);

  const bloqueo =
    p.estado !== "vigente"
      ? `${numero} está ${p.estado}: solo se corrige un préstamo vigente.`
      : conPagos.length
        ? `${numero} tiene ${conPagos.length === 1 ? "un pago vigente" : `${conPagos.length} pagos vigentes`}. Para corregirlo, anulá primero esos pagos desde el historial de la ficha (del más nuevo al más viejo).`
        : null;
  if (bloqueo) {
    return (
      <section className="flex flex-col gap-margin">
        <Link href={volver} className="flex items-center gap-space-xs self-start text-body-md text-on-surface-variant hover:text-primary">
          <ArrowLeft className="size-4" aria-hidden />
          Volver a <span className="font-mono tabular-nums">{numero}</span>
        </Link>
        <h1 className="text-headline-xl text-on-surface">
          Corregir <span className="font-mono tabular-nums">{numero}</span>
        </h1>
        <Alerta>{bloqueo}</Alerta>
      </section>
    );
  }

  const clientesForm: OpcionCliente[] = opciones.map((c) => ({
    value: c.id,
    label: c.nombre,
    documento: formatearDocumento(c.documento),
  }));

  return (
    <FormPrestamo
      accion={corregirPrestamo.bind(null, p.id)}
      clientes={clientesForm}
      clienteInicial={clientesForm.find((c) => c.value === p.clienteId) ?? null}
      hoy={hoyArgentina()}
      moraSugerida={MORA_PCT_SUGERIDA}
      graciaSugerida={DIAS_GRACIA_SUGERIDOS}
      correccion={{ numero, volver }}
      inicial={{
        fechaDesembolso: p.fechaDesembolso,
        arsCapital: textoEditable(p.arsCapital),
        tcEntrada: textoEditable(p.tcEntrada),
        tasaMensualPct: textoEditable(p.tasaMensualPct),
        frecuencia: p.frecuencia,
        nCuotas: String(p.nCuotas),
        tasaTotalPct: textoEditable(p.tasaTotalPct),
        moraPct: textoEditable(p.moraPct),
        diasGracia: String(p.diasGracia),
        notas: p.notas ?? "",
      }}
    />
  );
}
