---
name: Cierre & Reparto · rediseño 2026-10
source: Claude Design — proyecto 5bfb8b9a-63b4-4e17-ab56-8105e6a771ba, archivo "Rediseño Cierre y Reparto.dc.html"
colors:
  background: 'oklch(0.985 0.003 90)'
  foreground: 'oklch(0.21 0.012 80)'
  card: 'oklch(1 0 0)'
  muted: 'oklch(0.962 0.004 90)'
  muted-foreground: 'oklch(0.49 0.012 80)'
  accent: 'oklch(0.94 0.005 90)'
  border: 'oklch(0.915 0.006 90)'
  input: 'oklch(0.87 0.008 90)'
  primary: 'oklch(0.26 0.03 255)'
  primary-foreground: 'oklch(0.985 0.003 90)'
  ring: 'oklch(0.55 0.14 255)'
  link: 'oklch(0.47 0.14 255)'
  usdt: 'oklch(0.48 0.13 285)'
  usdt-soft: 'oklch(0.955 0.025 285)'
  recover: 'oklch(0.56 0.11 245)'
  recover-soft: 'oklch(0.93 0.03 245)'
  success: 'oklch(0.50 0.13 150)'
  success-soft: 'oklch(0.955 0.04 150)'
  warning: 'oklch(0.52 0.12 65)'
  warning-soft: 'oklch(0.96 0.05 85)'
  danger: 'oklch(0.52 0.19 27)'
  danger-soft: 'oklch(0.958 0.03 27)'
  risk-1: 'oklch(0.62 0.15 150)'
  risk-2: 'oklch(0.85 0.15 92)'
  risk-3: 'oklch(0.74 0.16 55)'
  risk-4: 'oklch(0.56 0.2 27)'
  risk-5: 'oklch(0.2 0.01 80)'
typography:
  headline-xl: { fontFamily: Geist, fontSize: 28px, fontWeight: '600', lineHeight: 34px, letterSpacing: -0.01em }
  headline-lg: { fontFamily: Geist, fontSize: 22px, fontWeight: '600', lineHeight: 28px, letterSpacing: -0.01em }
  headline-sm: { fontFamily: Geist, fontSize: 17px, fontWeight: '600', lineHeight: 24px }
  body-lg: { fontFamily: Geist, fontSize: 16px, fontWeight: '400', lineHeight: 24px }
  body-md: { fontFamily: Geist, fontSize: 15px, fontWeight: '400', lineHeight: 22px }
  body-sm: { fontFamily: Geist, fontSize: 14px, fontWeight: '400', lineHeight: 20px }
  label: { fontFamily: Geist, fontSize: 13px, fontWeight: '400', lineHeight: 18px }
  data-currency-primary: { fontFamily: Geist (tabular-nums), fontSize: 26px, fontWeight: '500', lineHeight: 32px, letterSpacing: -0.02em }
  data-currency-secondary: { fontFamily: Geist (tabular-nums), fontSize: 13px, fontWeight: '500', lineHeight: 18px }
  data-cell: { fontFamily: Geist (tabular-nums), fontSize: 15px, fontWeight: '400', lineHeight: 22px }
  badge-label: { fontFamily: Geist (tabular-nums), fontSize: 13px, fontWeight: '500', lineHeight: 18px }
rounded:
  DEFAULT: 0.25rem
  modal: 0.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-compact: 0.5rem
  margin: 1.25rem
  margin-panel: 1.25rem
  page: 2rem
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Idea

Cierre & Reparto ordenado por lo que hacen los socios, no por las tablas de la base.
Mismas reglas y mismos números; cambia dónde está cada cosa, cómo se llama y cómo
se explica. Lo usan dos socios, a veces desde el celular: prima que se lea rápido y
en voz alta por sobre la densidad.

El diseño completo (pantallas, variantes, glosario y estados) está en Claude Design.
Las capturas `design/*.png` son de la versión anterior y solo sirven como referencia
del contenido de cada pantalla, no del estilo.

## Color

Los tokens son las variables CSS de `src/app/globals.css`: nombres de shadcn más los
del negocio. En componentes solo se usan clases de token (`bg-card`,
`text-muted-foreground`, `bg-danger-soft text-danger`), nunca hex/oklch ni la paleta
de Tailwind.

| Token | Uso |
|---|---|
| `background` / `card` | Fondo de la app / tarjetas, tablas, modales |
| `foreground` / `muted-foreground` | Texto principal / secundario y ayudas |
| `muted` / `accent` | Fondos de apoyo, filas de total, ítem activo / hover |
| `border` / `input` | Divisores / bordes de campos y botones outline |
| `primary` | Acción principal (azul muy oscuro) |
| `link` | Links y N° de préstamo |
| `usdt` (`-soft`) | Todo lo que es USDT: la etiqueta "USDT" va siempre en violeta |
| `recover` (`-soft`) | Lo recuperado del costo del préstamo |
| `success` (`-soft`) | Ganancia, al día, pagado, saldo a favor |
| `warning` (`-soft`) | Por vencer, efectivo viejo, avisos |
| `danger` (`-soft`) | Atraso, anular, errores (`destructive` apunta acá) |
| `risk-1…5` (`-foreground`) | Semáforo: verde, amarillo, naranja, rojo, negro |
| `overlay` | Velo de modales y sheets |

Regla de lectura: **pesos = lo que debe o paga el cliente** (con `$` adelante);
**USDT = lo que entra a la sociedad** (con la etiqueta violeta).

## Tipografía

Geist para texto y números (cifras de ancho fijo, `tabular-nums`). Mínimo 13px (etiquetas y metadatos),
14px en ayudas y 15–16px en texto. **Sin mayúsculas sostenidas** (nada de
`uppercase` ni tracking ancho).

Todo monto, TC, tasa, porcentaje, fecha, N° de préstamo o cuota va en
`font-mono tabular-nums`, alineado a la derecha en tablas. El texto corrido nunca va
en mono.

| Formato | Regla | Ejemplo |
|---|---|---|
| Pesos | 2 decimales, `$` adelante | `$ 1.975.517,33` |
| USDT | 2 visibles (exacto hasta 8 en tooltip) | `172,63 USDT` |
| Dólar | hasta 6 decimales, "$ por USDT" | `1.622,00` |
| Porcentaje | hasta 4 decimales, sin ceros de más | `50%` |

## Espaciado y forma

- Escala 4 · 8 · 12 · 16 · 20 · 24 · 32. Página: 32px de padding en escritorio, 20px
  en el celular.
- Radios: 4px por defecto; modales y sheets hasta 8px; badges de riesgo y "+" del
  celular redondos.
- Sin sombras en reposo; bordes de 1px. Sombra solo en menús, sheets y modales.
- Alturas: botones y campos 40px (44–52px en acciones principales del celular).

## Navegación

Seis secciones por tarea (`src/components/app/secciones.ts`):

| Sección | Rutas | Qué tiene |
|---|---|---|
| Inicio | `/` | Hoy, atrasados, plata, ganancia del mes |
| Cobros | `/pagos` | Agenda por día · historial de cobros |
| Préstamos | `/prestamos` | Listado · ficha (cuotas, cobros, editar) |
| Clientes | `/clientes` | Ficha: deuda, saldo a favor, préstamos |
| Plata | `/socios`, `/efectivo`, `/terceros` | Caja y socios · efectivo · terceros (pestañas) |
| Historial | `/anulaciones` | Todo lo que pasó, incluso lo anulado |

- **Escritorio:** barra lateral de 232px + barra superior de 64px con buscador
  (cliente, DNI o N°), menú "Nuevo" (préstamo, cliente, aporte, conversión) y botón
  "Registrar cobro" siempre visibles.
- **Celular:** barra inferior con Inicio, Cobros, "+" central, Préstamos y Plata. El
  "+" ofrece registrar cobro y las altas. Clientes e Historial quedan en el menú de
  arriba.

## Componentes clave

- **Badge de riesgo:** pill `bg-risk-N text-risk-N-foreground` con los días de
  atraso en mono (`10 d`). Cortes: al día; ≤3% del plazo leve; ≤10% atención;
  ≤20% preocupante; ≤45% grave; >45% muy grave.
- **Barra de recupero:** azul (`recover`) = vuelve lo que costó; raya = costo en
  USDT; verde (`success`) = ganancia.
- **Filtros con conteo:** el activo relleno `bg-primary`, el resto con borde.
- **Pestañas segmentadas:** fondo `muted`, la activa en `card`.
- **Avisos:** caja `*-soft` con texto en el color pleno (`bg-warning-soft`,
  `bg-danger-soft text-danger`).
- **Confirmación:** resumen en filas "etiqueta · valor" antes de guardar, con el
  recordatorio de que nada se borra (se anula desde el historial).
