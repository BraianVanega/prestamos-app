import { z } from "zod";

export const esquemaAnulacion = z.object({
  entidad: z.enum(["pagos", "conversiones", "aportes", "cargos", "pagosTercero"], "No se reconoce qué querés anular."),
  id: z.uuid("No se reconoce qué querés anular."),
  motivo: z.string().trim().min(3, "Indicá el motivo (mínimo 3 caracteres).").max(200, "Máximo 200 caracteres."),
});

export type CamposAnulacion = keyof z.input<typeof esquemaAnulacion>;

export type EntidadAnulable = z.infer<typeof esquemaAnulacion>["entidad"];

/**
 * Motivo de lo que anula una edición de préstamo por dentro (cobros que se vuelven
 * a registrar, moras perdonadas que pasan a la versión nueva). No son correcciones
 * de los socios: no se listan; la edición se ve en "Cambios" de la ficha.
 */
export const PATRON_MOTIVO_EDICION = "^(Corrección de|Perdonada en) #PR-[0-9]+";
