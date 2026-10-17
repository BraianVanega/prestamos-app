/**
 * Menú por tarea (DESIGN.md › Navegación): 6 secciones. Cada una abarca
 * las rutas de `rutas`; Plata agrupa socios, efectivo y terceros.
 */
export const SECCIONES = [
  { clave: "inicio", href: "/", etiqueta: "Inicio", rutas: ["/"] },
  { clave: "cobros", href: "/pagos", etiqueta: "Cobros", rutas: ["/pagos"] },
  { clave: "prestamos", href: "/prestamos", etiqueta: "Préstamos", rutas: ["/prestamos"] },
  { clave: "clientes", href: "/clientes", etiqueta: "Clientes", rutas: ["/clientes"] },
  { clave: "plata", href: "/socios", etiqueta: "Plata", rutas: ["/socios", "/efectivo", "/terceros"] },
  { clave: "historial", href: "/anulaciones", etiqueta: "Historial", rutas: ["/anulaciones"] },
] as const;

export type ClaveSeccion = (typeof SECCIONES)[number]["clave"];

/** En el celular la barra inferior lleva 4 secciones; Clientes e Historial van al menú. */
export const SECCIONES_MOVIL: readonly ClaveSeccion[] = ["inicio", "cobros", "prestamos", "plata"];

/** Atajos del menú "Nuevo" y del "+" del celular. */
export const ACCIONES_NUEVO = [
  { href: "/prestamos/nuevo", etiqueta: "Nuevo préstamo" },
  { href: "/clientes/nuevo", etiqueta: "Nuevo cliente" },
  { href: "/socios", etiqueta: "Registrar aporte" },
  { href: "/efectivo", etiqueta: "Convertir efectivo" },
] as const;

const coincide = (ruta: string, pathname: string) =>
  ruta === "/" ? pathname === "/" : pathname === ruta || pathname.startsWith(`${ruta}/`);

export const seccionActiva = (pathname: string): ClaveSeccion | undefined =>
  SECCIONES.find((s) => s.rutas.some((r) => coincide(r, pathname)))?.clave;
