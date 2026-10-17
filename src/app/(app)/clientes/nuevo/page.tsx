import type { Metadata } from "next";
import Link from "next/link";
import { FormCliente } from "@/components/app/form-cliente";
import { crearCliente } from "../actions";

export const metadata: Metadata = { title: "Nuevo cliente · Cierre & Reparto" };

export default function NuevoClientePage() {
  return (
    <section className="flex max-w-3xl flex-col gap-margin">
      <div className="flex flex-col gap-space-xs">
        <Link href="/clientes" className="text-body-md text-muted-foreground hover:text-link">
          ← Clientes
        </Link>
        <h1 className="text-headline-xl text-foreground">Nuevo cliente</h1>
      </div>
      <div className="rounded-lg border border-border bg-card p-margin-panel">
        <FormCliente accion={crearCliente} iniciales={{ estado: "activo" }} textoGuardar="Crear cliente" cancelarHref="/clientes" enfocarNombre />
      </div>
    </section>
  );
}
