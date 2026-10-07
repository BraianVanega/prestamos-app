import { z } from "zod";

export const esquemaAnulacion = z.object({
  entidad: z.enum(["pagos", "conversiones", "aportes", "cargos"], "No se reconoce qué querés anular."),
  id: z.uuid("No se reconoce qué querés anular."),
  motivo: z.string().trim().min(3, "Indicá el motivo (mínimo 3 caracteres).").max(200, "Máximo 200 caracteres."),
});

export type CamposAnulacion = keyof z.input<typeof esquemaAnulacion>;

export type EntidadAnulable = z.infer<typeof esquemaAnulacion>["entidad"];
