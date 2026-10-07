@AGENTS.md

# Cierre & Reparto

Sistema de gestión de préstamos (ARS / USDT) para una sociedad con dos socios.

- Negocio: `docs/spec.pdf`
- Esquema: `src/db/schema.ts` (parte de `docs/schema.ts`; cambios posteriores en migraciones 0002+)
- Integridad en la base: `drizzle/0001_triggers.sql`
- Diseño: `design/DESIGN.md` + `design/*.png`

## Reglas no negociables

### Dinero: siempre `decimal.js`, nunca `number`
- Todo monto, TC, tasa o porcentaje es `Decimal` (`import Decimal from "decimal.js"`).
  Prohibido `number`, `parseFloat`, `Number()`, `toFixed` sobre number o aritmética con `+ - * /` nativos.
- Drizzle devuelve `numeric` como `string`: convertir a `Decimal` apenas se lee y
  volver a `string` (`.toFixed(n)`) recién al escribir.
- Redondeos iguales a los de la base: USDT 8 decimales, ARS 2, TC 6, porcentajes 4.
  Los CHECK verifican `usdt_prestado = round(ars_capital / tc_entrada, 8)` y
  `ars_interes_pactado = round(ars_capital * tasa_total_pct / 100, 2)`.
- Si un valor cruza al cliente (props, JSON), viaja como `string`.

### Tablas financieras append-only
- `pagos`, `imputaciones`, `cargos`, `cuotas`, `conversiones`, `conversion_lotes`,
  `transacciones`, `asientos`, `anulaciones`, `prestamo_participaciones` y `auditoria`
  no admiten UPDATE, DELETE ni TRUNCATE (los triggers lo bloquean).
- Un error se corrige registrando una anulación (`anulaciones` + transacción tipo
  `anulacion` que revierte los asientos), nunca editando ni borrando.
- En `prestamos` solo se editan `estado`, `fecha_cierre` y `notas`. Clientes,
  préstamos, participantes y proveedores no se borran.
- Validaciones diferidas al COMMIT: asientos balanceados por moneda, participaciones
  del préstamo al 100% (capital y ganancia), pagos 100% imputados, lotes de conversión
  completos. Todo lo que forma una operación va en **una sola transacción**.
- En cada transacción de escritura, setear el usuario (y opcionalmente el motivo)
  para la auditoría:
  `select set_config('app.usuario_id', '<uuid>', true)` /
  `select set_config('app.motivo', '<texto>', true)`.
- No modificar `src/db/schema.ts` ni migraciones ya aplicadas sin pedirlo explícitamente.
  Cambios de esquema = migración nueva con `pnpm db:generate`.

### Ganancia por recuperación de costo en USDT
- La ganancia se reconoce recién cuando lo cobrado (en USDT) supera el costo en USDT
  del préstamo (`usdt_prestado`). Antes de eso, todo cobro recupera capital.
- La imputación en ARS (capital / interés / mora) solo define cuánto debe el cliente;
  no determina la contabilidad ni la ganancia.
- Caja única; capital y ganancia se llevan por participante según
  `prestamo_participaciones` (y la parte de la Sociedad se reparte por `pct_sociedad`).

### Motor financiero puro en `src/engine`
- Funciones puras: entran datos, salen resultados (`Decimal`). Sin DB, sin I/O, sin
  fecha actual implícita (la fecha se recibe por parámetro), sin React ni Next.
- Todo cálculo de negocio vive ahí (cuotas, imputación, reconocimiento de ganancia,
  reparto, asientos a generar). Las server actions/rutas orquestan: leen, llaman al
  motor y persisten.
- Cada función del motor tiene tests en Vitest al lado (`*.test.ts`).

## UI

- Texto en **español rioplatense** (voseo: "Registrá", "Elegí", "Confirmá").
  Montos con formato `es-AR` (`1.234.567,89`).
- Componentes de **shadcn/ui** (`pnpm dlx shadcn@latest add <componente>`) en
  `src/components/ui`; no reinventar lo que shadcn ya resuelve.
- Diseño según `design/DESIGN.md` y las capturas `design/*.png`: revisarlas antes
  de construir o cambiar una pantalla.
- **Sin colores hardcodeados**: nada de hex/rgb/oklch en componentes ni clases de la
  paleta de Tailwind (`bg-blue-600`, `text-slate-500`). Solo tokens del tema definidos
  en `src/app/globals.css`: `bg-primary`, `bg-surface-container-low`,
  `text-on-surface-variant`, `border-outline-variant`, `text-tertiary`,
  `bg-riesgo-rojo-bg text-riesgo-rojo-fg border-riesgo-rojo-borde`, etc.
  Si falta un color, se agrega como token en `globals.css`.
- Tipografía con los tokens de DESIGN.md: `text-headline-xl|lg|sm`, `text-body-lg|md|sm`,
  `text-label-caps`, `text-data-currency-primary|secondary`, `text-data-cell`, `text-badge-label`.
- **Números con `tabular-nums`**: todo monto, TC, tasa, porcentaje, fecha, N° de
  préstamo o cuota se renderiza con `font-mono tabular-nums` (JetBrains Mono), alineado
  a la derecha en tablas.
- Radios: 4px por defecto (`rounded-lg`), modales hasta 8px; badges de riesgo `rounded-full`.
- Por ahora solo tema claro (DESIGN.md no define tokens oscuros).

## Comandos

```bash
pnpm dev                # Next en http://localhost:3000
pnpm build / pnpm lint / pnpm typecheck
pnpm test               # unit (src/**/*.test.ts)
pnpm test:integration   # contra el Postgres local (tests/integration)

pnpm db:up              # Supabase local (Postgres 17 + Auth) en Docker; db en localhost:54322
pnpm db:down            # supabase stop
pnpm db:migrate         # aplica drizzle/*.sql
pnpm db:seed            # 2 usuarios (Auth + usuarios) + Sociedad + Socio 1 / Socio 2 (50/50), idempotente
pnpm db:generate        # nueva migración desde el esquema
pnpm db:studio
```

`.env.local` (copiar de `.env.example`) define `DATABASE_URL`.

## Estructura

```
src/app/            rutas (App Router)
src/components/ui/  componentes shadcn
src/db/             schema.ts, cliente (index.ts), seed.ts
src/engine/         motor financiero puro + tests
drizzle/            migraciones (0000 inicial, 0001 triggers)
tests/integration/  tests contra la base
docs/  design/      spec, esquema original y diseño (no mover)
```
