import { z } from "zod";
import { normalizarDocumento } from "./formato";

export const ESTADOS_CLIENTE = {
  activo: "Activo",
  bloqueado: "Bloqueado",
  inactivo: "Inactivo",
} as const;
export type EstadoCliente = keyof typeof ESTADOS_CLIENTE;

const textoOpcional = z
  .string()
  .trim()
  .transform((v) => v || null);

export const esquemaCliente = z.object({
  nombre: z.string().trim().min(1, "Ingresá el nombre o razón social."),
  documento: z.string().transform((v) => normalizarDocumento(v)),
  telefono: textoOpcional,
  email: z
    .string()
    .trim()
    .transform((v) => v.toLowerCase() || null)
    .refine((v) => v === null || z.email().safeParse(v).success, "El mail no es válido."),
  direccion: textoOpcional,
  actividad: textoOpcional,
  referencias: textoOpcional,
  estado: z.enum(["activo", "bloqueado", "inactivo"], "Elegí un estado."),
  notas: textoOpcional,
});

export type DatosCliente = z.output<typeof esquemaCliente>;
export type CamposCliente = keyof z.input<typeof esquemaCliente>;
