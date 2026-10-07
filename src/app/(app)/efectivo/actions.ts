"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ErrorConversion, insertarConversion } from "@/db/conversion";
import { escribir, usuarioActual } from "@/lib/auth";
import { esquemaConversion, type CamposConversion } from "@/lib/conversiones";
import { hoyArgentina } from "@/lib/hoy";

export type EstadoFormConversion = {
  error?: string;
  errores?: Partial<Record<CamposConversion, string>>;
};

const CAMPOS: CamposConversion[] = ["fecha", "ars", "tc", "notas", "lotes"];

export async function registrarConversion(_prev: EstadoFormConversion, form: FormData): Promise<EstadoFormConversion> {
  const usuario = await usuarioActual();
  const parsed = esquemaConversion.safeParse(Object.fromEntries(CAMPOS.map((c) => [c, String(form.get(c) ?? "")])));
  if (!parsed.success) {
    const errores: EstadoFormConversion["errores"] = {};
    for (const issue of parsed.error.issues) errores[issue.path[0] as CamposConversion] ??= issue.message;
    return { errores };
  }
  const d = parsed.data;
  if (d.fecha > hoyArgentina()) return { errores: { fecha: "La fecha no puede ser futura." } };

  let resultado: Awaited<ReturnType<typeof insertarConversion>>;
  try {
    resultado = await escribir(
      usuario,
      (tx) =>
        insertarConversion(
          tx,
          {
            fecha: d.fecha,
            ars: d.ars,
            tc: d.tc,
            notas: d.notas,
            lotes: new Map(Object.entries(d.lotes).map(([k, v]) => [k, new Decimal(v)])),
          },
          { usuarioId: usuario.id },
        ),
      "Conversión de efectivo",
    );
  } catch (e) {
    if (e instanceof ErrorConversion) return { error: e.message };
    throw e;
  }

  revalidatePath("/efectivo");
  revalidatePath("/prestamos");
  for (const id of resultado.prestamos) revalidatePath(`/prestamos/${id}`);
  redirect(`/efectivo?convertido=${resultado.conversionId}`);
}
