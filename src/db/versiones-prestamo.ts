import "server-only";
import Decimal from "decimal.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./index";
import { anulaciones, clientes, participantes, prestamoParticipaciones, prestamos, usuarios } from "./schema";
import { formatearPct } from "@/lib/numeros";
import { diferenciasPrestamo, type CamposVersion, type Diferencia } from "@/lib/versiones";

/**
 * Editar un préstamo lo anula y crea otra fila que lo corrige (`corrige_a_id`).
 * Para los socios es el mismo préstamo: estas consultas recorren esa cadena.
 */

/** Versión vigente de la cadena a la que pertenece `id` (la última que lo corrige), o `id` si no se editó. */
export async function versionActual(id: string): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(sql`
    with recursive siguientes as (
      select ${prestamos.id} as id, 0 as nivel from ${prestamos} where ${prestamos.corrigeAId} = ${id}
      union all
      select p.id, s.nivel + 1 from ${prestamos} p join siguientes s on p.corrige_a_id = s.id
    )
    select id from siguientes order by nivel desc limit 1`);
  return rows[0]?.id ?? id;
}

export interface CambioPrestamo {
  /** Versión anterior (se puede abrir para ver cómo estaba). */
  anteriorId: string;
  /** N° de la versión anterior si era otro (ediciones previas a conservar el N°). */
  numeroAnterior: number | null;
  en: Date;
  usuario: string;
  motivo: string;
  diferencias: Diferencia[];
}

/** Ediciones que llevaron a la versión `id`, de la más nueva a la más vieja. */
export async function cambiosPrestamo(id: string): Promise<CambioPrestamo[]> {
  const { rows: cadena } = await db.execute<{ id: string }>(sql`
    with recursive anteriores as (
      select ${prestamos.id} as id, ${prestamos.corrigeAId} as corrige_a_id, 0 as nivel from ${prestamos} where ${prestamos.id} = ${id}
      union all
      select p.id, p.corrige_a_id, a.nivel + 1 from ${prestamos} p join anteriores a on p.id = a.corrige_a_id
    )
    select id from anteriores order by nivel`);
  if (cadena.length < 2) return [];
  const ids = cadena.map((c) => c.id);

  const [versiones, partes, anuladas] = await Promise.all([
    db
      .select({
        id: prestamos.id,
        numero: prestamos.numero,
        cliente: clientes.nombre,
        fechaDesembolso: prestamos.fechaDesembolso,
        arsCapital: prestamos.arsCapital,
        tcEntrada: prestamos.tcEntrada,
        frecuencia: prestamos.frecuencia,
        nCuotas: prestamos.nCuotas,
        tasaTotalPct: prestamos.tasaTotalPct,
        moraPct: prestamos.moraPct,
        diasGracia: prestamos.diasGracia,
        notas: prestamos.notas,
      })
      .from(prestamos)
      .innerJoin(clientes, eq(clientes.id, prestamos.clienteId))
      .where(inArray(prestamos.id, ids)),
    db
      .select({
        prestamoId: prestamoParticipaciones.prestamoId,
        nombre: participantes.nombre,
        tipo: participantes.tipo,
        pct: prestamoParticipaciones.pctCapital,
      })
      .from(prestamoParticipaciones)
      .innerJoin(participantes, eq(participantes.id, prestamoParticipaciones.participanteId))
      .where(inArray(prestamoParticipaciones.prestamoId, ids)),
    db
      .select({ entidadId: anulaciones.entidadId, en: anulaciones.creadoEn, motivo: anulaciones.motivo, usuario: usuarios.nombre })
      .from(anulaciones)
      .innerJoin(usuarios, eq(usuarios.id, anulaciones.creadoPor))
      .where(and(eq(anulaciones.entidad, "prestamos"), inArray(anulaciones.entidadId, ids))),
  ]);

  const estructura = (prestamoId: string) =>
    partes
      .filter((p) => p.prestamoId === prestamoId)
      .sort((a, b) => Number(b.tipo === "sociedad") - Number(a.tipo === "sociedad") || new Decimal(b.pct).cmp(a.pct))
      .map((p) => `${p.nombre} ${formatearPct(p.pct)}%`)
      .join(" · ");
  const campos = (vid: string): CamposVersion & { numero: number } => {
    const v = versiones.find((x) => x.id === vid)!;
    return { ...v, estructura: estructura(vid) };
  };

  // cadena[0] es la actual; cada anterior (i + 1) fue reemplazada por cadena[i].
  return cadena.slice(1).flatMap((anterior, i) => {
    const a = anuladas.find((x) => x.entidadId === anterior.id);
    if (!a) return [];
    const antes = campos(anterior.id);
    const ahora = campos(cadena[i]!.id);
    return [
      {
        anteriorId: anterior.id,
        numeroAnterior: antes.numero === ahora.numero ? null : antes.numero,
        en: a.en,
        usuario: a.usuario,
        motivo: a.motivo,
        diferencias: diferenciasPrestamo(antes, ahora),
      },
    ];
  });
}
