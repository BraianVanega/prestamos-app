/**
 * Cierre & Reparto — Esquema fase 1 (Drizzle + Postgres)
 *
 * Principios:
 * - Montos siempre `numeric` (Drizzle los devuelve como string → usar decimal.js).
 * - Tablas financieras append-only: se anula, no se edita ni se borra (ver 0001_triggers.sql).
 * - La ganancia se reconoce por recuperación de costo en USDT (opción B):
 *   la imputación ARS solo define cuánto debe el cliente, no la contabilidad.
 * - Caja única; la propiedad del capital y la ganancia se lleva por participante.
 * - Fondeadores: previstos en el modelo (tipo_participante), sin UI hasta v3.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  timestamp,
  date,
  integer,
  serial,
  bigserial,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  unique,
  check,
  primaryKey,
  foreignKey,
} from "drizzle-orm/pg-core";

/* ───────────── Tipos monetarios ───────────── */

const usdt = (name: string) => numeric(name, { precision: 20, scale: 8 });
const ars = (name: string) => numeric(name, { precision: 20, scale: 2 });
const tc = (name: string) => numeric(name, { precision: 20, scale: 6 });
const pct = (name: string) => numeric(name, { precision: 9, scale: 4 });

/** Columnas de alta. Función para crear builders nuevos en cada tabla. */
const alta = () => ({
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  creadoPor: uuid("creado_por")
    .notNull()
    .references(() => usuarios.id),
});

/* ───────────── Enums ───────────── */

export const rolUsuario = pgEnum("rol_usuario", ["admin", "operador", "lectura"]);
export const tipoParticipante = pgEnum("tipo_participante", ["sociedad", "socio", "fondeador"]);
export const frecuencia = pgEnum("frecuencia", ["dia", "semana", "quincena", "mes"]);
export const estadoCliente = pgEnum("estado_cliente", ["activo", "bloqueado", "inactivo"]);
export const estadoPrestamo = pgEnum("estado_prestamo", [
  "vigente",
  "cancelado", // cerrado con o sin pérdida
  "castigado", // incobrable
  "refinanciado", // reemplazado por otro préstamo
]);
export const tipoPago = pgEnum("tipo_pago", ["transferencia", "efectivo"]);
export const conceptoImputacion = pgEnum("concepto_imputacion", [
  "capital",
  "interes",
  "mora",
  "saldo_favor",
]);
export const tipoCargo = pgEnum("tipo_cargo", ["mora", "descuento", "ajuste"]);
export const moneda = pgEnum("moneda", ["USDT", "ARS"]);
export const tipoCuenta = pgEnum("tipo_cuenta", [
  "caja_usdt",
  "caja_efectivo_ars",
  "puente_cambio", // contrapartida ARS↔USDT para balancear por moneda
  "cartera", // capital colocado, por préstamo, al costo en USDT
  "capital", // por participante
  "ganancia", // por participante (realizada, no retirada)
  "saldo_favor", // por cliente
  "apertura", // saldos migrados del Excel
]);
export const tipoTransaccion = pgEnum("tipo_transaccion", [
  "apertura",
  "aporte",
  "desembolso",
  "cobro",
  "conversion",
  "reconocimiento_ganancia",
  "perdida",
  "aplicacion_saldo_favor",
  "retiro", // fase 2
  "anulacion",
]);

/* ───────────── Usuarios y participantes ───────────── */

/** Perfil de negocio. Sesiones, contraseñas y 2FA los maneja la librería de auth. */
export const usuarios = pgTable("usuarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  nombre: text("nombre").notNull(),
  rol: rolUsuario("rol").notNull().default("admin"),
  activo: boolean("activo").notNull().default(true),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Una fila tipo 'sociedad' (seed) + una por socio.
 * La parte de la sociedad se divide entre socios según pct_sociedad.
 */
export const participantes = pgTable(
  "participantes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nombre: text("nombre").notNull(),
    tipo: tipoParticipante("tipo").notNull(),
    pctSociedad: pct("pct_sociedad"),
    usuarioId: uuid("usuario_id").references(() => usuarios.id),
    activo: boolean("activo").notNull().default(true),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("socio_tiene_pct", sql`${t.tipo} <> 'socio' or ${t.pctSociedad} is not null`),
    uniqueIndex("una_sola_sociedad").on(t.tipo).where(sql`${t.tipo} = 'sociedad'`),
  ],
);

/* ───────────── Clientes y proveedores ───────────── */

export const proveedores = pgTable("proveedores", {
  id: uuid("id").primaryKey().defaultRandom(),
  nombre: text("nombre").notNull(),
  contacto: text("contacto"),
  notas: text("notas"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export const clientes = pgTable(
  "clientes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nombre: text("nombre").notNull(),
    documento: text("documento"),
    telefono: text("telefono"),
    email: text("email"),
    direccion: text("direccion"),
    actividad: text("actividad"),
    referencias: text("referencias"),
    estado: estadoCliente("estado").notNull().default("activo"),
    notas: text("notas"),
    ...alta(),
  },
  (t) => [
    index("clientes_nombre_idx").on(t.nombre),
    uniqueIndex("clientes_documento_uq").on(t.documento).where(sql`${t.documento} is not null`),
  ],
);

/* ───────────── Préstamos ───────────── */

export const prestamos = pgTable(
  "prestamos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    numero: serial("numero").notNull().unique(), // número visible, como en la planilla
    clienteId: uuid("cliente_id")
      .notNull()
      .references(() => clientes.id),
    proveedorId: uuid("proveedor_id").references(() => proveedores.id),
    fechaDesembolso: date("fecha_desembolso").notNull(),

    // Ingredientes (P4): se cargan
    arsCapital: ars("ars_capital").notNull(),
    tcEntrada: tc("tc_entrada").notNull(), // TC neto del proveedor
    tasaMensualPct: pct("tasa_mensual_pct").notNull(),
    tasaTotalPct: pct("tasa_total_pct").notNull(), // tasa del plazo completo (sugerida = mensual × meses, editable)
    frecuencia: frecuencia("frecuencia").notNull(),
    nCuotas: integer("n_cuotas").notNull(),
    vencimientoFinal: date("vencimiento_final").notNull(),
    // Mora: recargo único = mora_pct × capital impago de la cuota si el atraso supera dias_gracia
    moraPct: pct("mora_pct").notNull().default("20"),
    diasGracia: integer("dias_gracia").notNull().default(5),

    // Resultados congelados al alta, verificados por CHECK
    usdtPrestado: usdt("usdt_prestado").notNull(),
    arsInteresPactado: ars("ars_interes_pactado").notNull(),

    // Único bloque editable (ver trigger)
    estado: estadoPrestamo("estado").notNull().default("vigente"),
    fechaCierre: date("fecha_cierre"),
    notas: text("notas"),

    refinanciadoDesdeId: uuid("refinanciado_desde_id"),
    ...alta(),
  },
  (t) => [
    foreignKey({ columns: [t.refinanciadoDesdeId], foreignColumns: [t.id] }),
    index("prestamos_cliente_idx").on(t.clienteId),
    index("prestamos_estado_idx").on(t.estado),
    check("ars_capital_pos", sql`${t.arsCapital} > 0`),
    check("tc_entrada_pos", sql`${t.tcEntrada} > 0`),
    check("n_cuotas_pos", sql`${t.nCuotas} > 0`),
    check("tasas_no_neg", sql`${t.tasaMensualPct} >= 0 and ${t.tasaTotalPct} >= 0`),
    check("mora_no_neg", sql`${t.moraPct} >= 0 and ${t.diasGracia} >= 0`),
    check("usdt_prestado_ok", sql`${t.usdtPrestado} = round(${t.arsCapital} / ${t.tcEntrada}, 8)`),
    check(
      "interes_pactado_ok",
      sql`${t.arsInteresPactado} = round(${t.arsCapital} * ${t.tasaTotalPct} / 100, 2)`,
    ),
    check(
      "cierre_coherente",
      sql`(${t.estado} = 'vigente') = (${t.fechaCierre} is null)`,
    ),
  ],
);

/** Caso A: sociedad 100/100. Caso C: socio 100/100. v3: mezclas con fondeadores. */
export const prestamoParticipaciones = pgTable(
  "prestamo_participaciones",
  {
    prestamoId: uuid("prestamo_id")
      .notNull()
      .references(() => prestamos.id),
    participanteId: uuid("participante_id")
      .notNull()
      .references(() => participantes.id),
    pctCapital: pct("pct_capital").notNull(),
    pctGanancia: pct("pct_ganancia").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.prestamoId, t.participanteId] }),
    check("pct_capital_rango", sql`${t.pctCapital} > 0 and ${t.pctCapital} <= 100`),
    check("pct_ganancia_rango", sql`${t.pctGanancia} >= 0 and ${t.pctGanancia} <= 100`),
  ],
);

/** Plan de pagos. Inmutable: las negociaciones van por `cargos` o refinanciación. */
export const cuotas = pgTable(
  "cuotas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prestamoId: uuid("prestamo_id")
      .notNull()
      .references(() => prestamos.id),
    numero: integer("numero").notNull(),
    vencimiento: date("vencimiento").notNull(),
    arsCapital: ars("ars_capital").notNull(),
    arsInteres: ars("ars_interes").notNull(),
  },
  (t) => [
    unique("cuota_unica").on(t.prestamoId, t.numero),
    index("cuotas_vencimiento_idx").on(t.vencimiento),
    check("cuota_montos", sql`${t.arsCapital} >= 0 and ${t.arsInteres} >= 0`),
  ],
);

/** Mora (+), descuento (−) o ajuste (±) caso por caso. Siempre con motivo. */
export const cargos = pgTable(
  "cargos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prestamoId: uuid("prestamo_id")
      .notNull()
      .references(() => prestamos.id),
    cuotaId: uuid("cuota_id").references(() => cuotas.id),
    fecha: date("fecha").notNull(),
    tipo: tipoCargo("tipo").notNull(),
    ars: ars("ars").notNull(),
    motivo: text("motivo").notNull(),
    ...alta(),
  },
  (t) => [
    index("cargos_prestamo_idx").on(t.prestamoId),
    check(
      "signo_cargo",
      sql`${t.ars} <> 0 and (
        (${t.tipo} = 'mora' and ${t.ars} > 0) or
        (${t.tipo} = 'descuento' and ${t.ars} < 0) or
        ${t.tipo} = 'ajuste')`,
    ),
  ],
);

/* ───────────── Pagos ───────────── */

/** Un pago = una transferencia o entrega de efectivo real, a nivel cliente. */
export const pagos = pgTable(
  "pagos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clienteId: uuid("cliente_id")
      .notNull()
      .references(() => clientes.id),
    fecha: date("fecha").notNull(),
    ars: ars("ars").notNull(),
    tipo: tipoPago("tipo").notNull(),
    tcSalida: tc("tc_salida"), // null si es efectivo: el TC llega con la conversión
    metodo: text("metodo"),
    comprobanteUrl: text("comprobante_url"),
    notas: text("notas"),
    ...alta(),
  },
  (t) => [
    index("pagos_cliente_idx").on(t.clienteId),
    index("pagos_fecha_idx").on(t.fecha),
    check("pago_pos", sql`${t.ars} > 0`),
    check(
      "tc_segun_tipo",
      sql`(${t.tipo} = 'transferencia' and ${t.tcSalida} > 0) or
          (${t.tipo} = 'efectivo' and ${t.tcSalida} is null)`,
    ),
  ],
);

/**
 * Distribución del pago entre préstamos/cuotas (solo deuda ARS del cliente).
 * - Suma por pago = pago.ars (trigger diferido).
 * - Aplicar saldo a favor después: fila saldo_favor negativa + fila positiva
 *   al préstamo, ambas con el mismo pago_id (conserva el TC de origen).
 */
export const imputaciones = pgTable(
  "imputaciones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pagoId: uuid("pago_id")
      .notNull()
      .references(() => pagos.id),
    fecha: date("fecha").notNull(),
    prestamoId: uuid("prestamo_id").references(() => prestamos.id),
    cuotaId: uuid("cuota_id").references(() => cuotas.id),
    concepto: conceptoImputacion("concepto").notNull(),
    ars: ars("ars").notNull(),
    ...alta(),
  },
  (t) => [
    index("imputaciones_pago_idx").on(t.pagoId),
    index("imputaciones_prestamo_idx").on(t.prestamoId),
    check(
      "prestamo_segun_concepto",
      sql`(${t.concepto} = 'saldo_favor') = (${t.prestamoId} is null)`,
    ),
    check(
      "signo_imputacion",
      sql`${t.ars} <> 0 and (${t.concepto} = 'saldo_favor' or ${t.ars} > 0)`,
    ),
    check("cuota_requiere_prestamo", sql`${t.cuotaId} is null or ${t.prestamoId} is not null`),
  ],
);

/* ───────────── Conversiones de efectivo ───────────── */

export const conversiones = pgTable(
  "conversiones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fecha: date("fecha").notNull(),
    ars: ars("ars").notNull(),
    tc: tc("tc").notNull(),
    usdtResultante: usdt("usdt_resultante").notNull(),
    notas: text("notas"),
    ...alta(),
  },
  (t) => [
    check("conversion_pos", sql`${t.ars} > 0 and ${t.tc} > 0`),
    check("usdt_conversion_ok", sql`${t.usdtResultante} = round(${t.ars} / ${t.tc}, 8)`),
  ],
);

/** Qué pagos en efectivo cubre cada conversión (FIFO sugerido por la app). */
export const conversionLotes = pgTable(
  "conversion_lotes",
  {
    conversionId: uuid("conversion_id")
      .notNull()
      .references(() => conversiones.id),
    pagoId: uuid("pago_id")
      .notNull()
      .references(() => pagos.id),
    ars: ars("ars").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.conversionId, t.pagoId] }),
    index("lotes_pago_idx").on(t.pagoId),
    check("lote_pos", sql`${t.ars} > 0`),
  ],
);

/* ───────────── Ledger ───────────── */

/** Agrupa asientos balanceados por moneda (trigger diferido). */
export const transacciones = pgTable(
  "transacciones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fecha: date("fecha").notNull(),
    tipo: tipoTransaccion("tipo").notNull(),
    descripcion: text("descripcion"),
    prestamoId: uuid("prestamo_id").references(() => prestamos.id),
    pagoId: uuid("pago_id").references(() => pagos.id),
    conversionId: uuid("conversion_id").references(() => conversiones.id),
    anulaTransaccionId: uuid("anula_transaccion_id").unique(),
    motivo: text("motivo"),
    ...alta(),
  },
  (t) => [
    foreignKey({ columns: [t.anulaTransaccionId], foreignColumns: [t.id] }),
    index("tx_fecha_idx").on(t.fecha),
    index("tx_prestamo_idx").on(t.prestamoId),
    check(
      "anulacion_con_motivo",
      sql`${t.tipo} <> 'anulacion' or (${t.anulaTransaccionId} is not null and ${t.motivo} is not null)`,
    ),
  ],
);

export const asientos = pgTable(
  "asientos",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    transaccionId: uuid("transaccion_id")
      .notNull()
      .references(() => transacciones.id),
    cuenta: tipoCuenta("cuenta").notNull(),
    participanteId: uuid("participante_id").references(() => participantes.id),
    prestamoId: uuid("prestamo_id").references(() => prestamos.id),
    clienteId: uuid("cliente_id").references(() => clientes.id),
    moneda: moneda("moneda").notNull(),
    monto: numeric("monto", { precision: 20, scale: 8 }).notNull(), // + débito / − crédito
  },
  (t) => [
    index("asientos_tx_idx").on(t.transaccionId),
    index("asientos_cuenta_idx").on(t.cuenta, t.participanteId, t.prestamoId, t.clienteId),
    check("monto_no_cero", sql`${t.monto} <> 0`),
    check(
      "referencia_segun_cuenta",
      sql`(${t.cuenta} not in ('capital','ganancia') or ${t.participanteId} is not null)
      and (${t.cuenta} <> 'cartera' or ${t.prestamoId} is not null)
      and (${t.cuenta} <> 'saldo_favor' or ${t.clienteId} is not null)`,
    ),
    check(
      "moneda_segun_cuenta",
      sql`(${t.cuenta} <> 'caja_efectivo_ars' or ${t.moneda} = 'ARS')
      and (${t.cuenta} not in ('caja_usdt','cartera','capital','ganancia') or ${t.moneda} = 'USDT')`,
    ),
  ],
);

/* ───────────── Anulaciones y auditoría ───────────── */

/** Marca de anulación para filas operativas (pagos, cargos, conversiones, préstamos). */
export const anulaciones = pgTable(
  "anulaciones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entidad: text("entidad").notNull(), // nombre de tabla
    entidadId: uuid("entidad_id").notNull(),
    transaccionId: uuid("transaccion_id").references(() => transacciones.id),
    motivo: text("motivo").notNull(),
    ...alta(),
  },
  (t) => [unique("anulacion_unica").on(t.entidad, t.entidadId)],
);

/** Escrita solo por trigger. usuario y motivo vía set_config('app.usuario_id' / 'app.motivo'). */
export const auditoria = pgTable(
  "auditoria",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
    usuarioId: uuid("usuario_id"),
    tabla: text("tabla").notNull(),
    registroId: text("registro_id"),
    accion: text("accion").notNull(),
    antes: jsonb("antes"),
    despues: jsonb("despues"),
    motivo: text("motivo"),
  },
  (t) => [index("auditoria_registro_idx").on(t.tabla, t.registroId)],
);
