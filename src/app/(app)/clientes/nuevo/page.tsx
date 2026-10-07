import type { Metadata } from "next";
import Link from "next/link";
import { FormCliente } from "@/components/app/form-cliente";
import { crearCliente } from "../actions";

export const metadata: Metadata = { title: "Nuevo cliente · Cierre & Reparto" };

export default function NuevoClientePage() {
  return (
    <section className="flex max-w-3xl flex-col gap-margin">
      <div className="flex flex-col gap-space-xs">
        <Link href="/clientes" className="text-body-md text-on-surface-variant hover:text-primary">
          ← Clientes
        </Link>
        <h1 className="text-headline-xl text-on-surface">Nuevo cliente</h1>
      </div>
      <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-margin-panel">
        <FormCliente accion={crearCliente} iniciales={{ estado: "activo" }} textoGuardar="Crear cliente" cancelarHref="/clientes" enfocarNombre />
      </div>
    </section>
  );
}
