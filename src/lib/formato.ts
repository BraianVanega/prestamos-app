/**
 * Formato de datos para la UI (es-AR). Los montos tienen su propio formateador
 * sobre Decimal; acá van documentos y fechas.
 */

/**
 * DNI / CUIT se guardan solo con dígitos para que "32.891.004" y "32891004"
 * sean el mismo documento. Si trae letras (pasaporte), se guarda en mayúsculas
 * sin espacios.
 */
export function normalizarDocumento(valor: string): string | null {
  const limpio = valor.trim();
  if (!limpio) return null;
  if (/^[\d.\-\s]+$/.test(limpio)) return limpio.replace(/\D/g, "") || null;
  return limpio.replace(/\s+/g, "").toUpperCase();
}

/** 8 dígitos → 32.891.004 (DNI); 11 dígitos → 30-71120938-2 (CUIT/CUIL). */
export function formatearDocumento(doc: string | null | undefined): string {
  if (!doc) return "";
  if (/^\d{11}$/.test(doc)) return `${doc.slice(0, 2)}-${doc.slice(2, 10)}-${doc.slice(10)}`;
  if (/^\d{7,8}$/.test(doc)) return doc.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return doc;
}

/** `YYYY-MM-DD` o Date → DD/MM/YYYY (fechas de calendario, sin zona horaria). */
export function formatearFecha(fecha: string | Date): string {
  const iso = typeof fecha === "string" ? fecha.slice(0, 10) : fecha.toISOString().slice(0, 10);
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
