CREATE TYPE "public"."concepto_imputacion" AS ENUM('capital', 'interes', 'mora', 'saldo_favor');--> statement-breakpoint
CREATE TYPE "public"."estado_cliente" AS ENUM('activo', 'bloqueado', 'inactivo');--> statement-breakpoint
CREATE TYPE "public"."estado_prestamo" AS ENUM('vigente', 'cancelado', 'castigado', 'refinanciado');--> statement-breakpoint
CREATE TYPE "public"."frecuencia" AS ENUM('dia', 'semana', 'quincena', 'mes');--> statement-breakpoint
CREATE TYPE "public"."moneda" AS ENUM('USDT', 'ARS');--> statement-breakpoint
CREATE TYPE "public"."rol_usuario" AS ENUM('admin', 'operador', 'lectura');--> statement-breakpoint
CREATE TYPE "public"."tipo_cargo" AS ENUM('mora', 'descuento', 'ajuste');--> statement-breakpoint
CREATE TYPE "public"."tipo_cuenta" AS ENUM('caja_usdt', 'caja_efectivo_ars', 'puente_cambio', 'cartera', 'capital', 'ganancia', 'saldo_favor', 'apertura');--> statement-breakpoint
CREATE TYPE "public"."tipo_pago" AS ENUM('transferencia', 'efectivo');--> statement-breakpoint
CREATE TYPE "public"."tipo_participante" AS ENUM('sociedad', 'socio', 'fondeador');--> statement-breakpoint
CREATE TYPE "public"."tipo_transaccion" AS ENUM('apertura', 'aporte', 'desembolso', 'cobro', 'conversion', 'reconocimiento_ganancia', 'perdida', 'aplicacion_saldo_favor', 'retiro', 'anulacion');--> statement-breakpoint
CREATE TABLE "anulaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" uuid NOT NULL,
	"transaccion_id" uuid,
	"motivo" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid NOT NULL,
	CONSTRAINT "anulacion_unica" UNIQUE("entidad","entidad_id")
);
--> statement-breakpoint
CREATE TABLE "asientos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaccion_id" uuid NOT NULL,
	"cuenta" "tipo_cuenta" NOT NULL,
	"participante_id" uuid,
	"prestamo_id" uuid,
	"cliente_id" uuid,
	"moneda" "moneda" NOT NULL,
	"monto" numeric(20, 8) NOT NULL,
	CONSTRAINT "monto_no_cero" CHECK ("asientos"."monto" <> 0),
	CONSTRAINT "referencia_segun_cuenta" CHECK (("asientos"."cuenta" not in ('capital','ganancia') or "asientos"."participante_id" is not null)
      and ("asientos"."cuenta" <> 'cartera' or "asientos"."prestamo_id" is not null)
      and ("asientos"."cuenta" <> 'saldo_favor' or "asientos"."cliente_id" is not null)),
	CONSTRAINT "moneda_segun_cuenta" CHECK (("asientos"."cuenta" <> 'caja_efectivo_ars' or "asientos"."moneda" = 'ARS')
      and ("asientos"."cuenta" not in ('caja_usdt','cartera','capital','ganancia') or "asientos"."moneda" = 'USDT'))
);
--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" uuid,
	"tabla" text NOT NULL,
	"registro_id" text,
	"accion" text NOT NULL,
	"antes" jsonb,
	"despues" jsonb,
	"motivo" text
);
--> statement-breakpoint
CREATE TABLE "cargos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prestamo_id" uuid NOT NULL,
	"cuota_id" uuid,
	"fecha" date NOT NULL,
	"tipo" "tipo_cargo" NOT NULL,
	"ars" numeric(20, 2) NOT NULL,
	"motivo" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid NOT NULL,
	CONSTRAINT "signo_cargo" CHECK ("cargos"."ars" <> 0 and (
        ("cargos"."tipo" = 'mora' and "cargos"."ars" > 0) or
        ("cargos"."tipo" = 'descuento' and "cargos"."ars" < 0) or
        "cargos"."tipo" = 'ajuste'))
);
--> statement-breakpoint
CREATE TABLE "clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"documento" text,
	"telefono" text,
	"email" text,
	"direccion" text,
	"actividad" text,
	"referencias" text,
	"estado" "estado_cliente" DEFAULT 'activo' NOT NULL,
	"notas" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversion_lotes" (
	"conversion_id" uuid NOT NULL,
	"pago_id" uuid NOT NULL,
	"ars" numeric(20, 2) NOT NULL,
	CONSTRAINT "conversion_lotes_conversion_id_pago_id_pk" PRIMARY KEY("conversion_id","pago_id"),
	CONSTRAINT "lote_pos" CHECK ("conversion_lotes"."ars" > 0)
);
--> statement-breakpoint
CREATE TABLE "conversiones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fecha" date NOT NULL,
	"ars" numeric(20, 2) NOT NULL,
	"tc" numeric(20, 6) NOT NULL,
	"usdt_resultante" numeric(20, 8) NOT NULL,
	"notas" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid NOT NULL,
	CONSTRAINT "conversion_pos" CHECK ("conversiones"."ars" > 0 and "conversiones"."tc" > 0),
	CONSTRAINT "usdt_conversion_ok" CHECK ("conversiones"."usdt_resultante" = round("conversiones"."ars" / "conversiones"."tc", 8))
);
--> statement-breakpoint
CREATE TABLE "cuotas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prestamo_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"vencimiento" date NOT NULL,
	"ars_capital" numeric(20, 2) NOT NULL,
	"ars_interes" numeric(20, 2) NOT NULL,
	CONSTRAINT "cuota_unica" UNIQUE("prestamo_id","numero"),
	CONSTRAINT "cuota_montos" CHECK ("cuotas"."ars_capital" >= 0 and "cuotas"."ars_interes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "imputaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pago_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"prestamo_id" uuid,
	"cuota_id" uuid,
	"concepto" "concepto_imputacion" NOT NULL,
	"ars" numeric(20, 2) NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid NOT NULL,
	CONSTRAINT "prestamo_segun_concepto" CHECK (("imputaciones"."concepto" = 'saldo_favor') = ("imputaciones"."prestamo_id" is null)),
	CONSTRAINT "signo_imputacion" CHECK ("imputaciones"."ars" <> 0 and ("imputaciones"."concepto" = 'saldo_favor' or "imputaciones"."ars" > 0)),
	CONSTRAINT "cuota_requiere_prestamo" CHECK ("imputaciones"."cuota_id" is null or "imputaciones"."prestamo_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "pagos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"ars" numeric(20, 2) NOT NULL,
	"tipo" "tipo_pago" NOT NULL,
	"tc_salida" numeric(20, 6),
	"metodo" text,
	"comprobante_url" text,
	"notas" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid NOT NULL,
	CONSTRAINT "pago_pos" CHECK ("pagos"."ars" > 0),
	CONSTRAINT "tc_segun_tipo" CHECK (("pagos"."tipo" = 'transferencia' and "pagos"."tc_salida" > 0) or
          ("pagos"."tipo" = 'efectivo' and "pagos"."tc_salida" is null))
);
--> statement-breakpoint
CREATE TABLE "participantes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"tipo" "tipo_participante" NOT NULL,
	"pct_sociedad" numeric(9, 4),
	"usuario_id" uuid,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "socio_tiene_pct" CHECK ("participantes"."tipo" <> 'socio' or "participantes"."pct_sociedad" is not null)
);
--> statement-breakpoint
CREATE TABLE "prestamo_participaciones" (
	"prestamo_id" uuid NOT NULL,
	"participante_id" uuid NOT NULL,
	"pct_capital" numeric(9, 4) NOT NULL,
	"pct_ganancia" numeric(9, 4) NOT NULL,
	CONSTRAINT "prestamo_participaciones_prestamo_id_participante_id_pk" PRIMARY KEY("prestamo_id","participante_id"),
	CONSTRAINT "pct_capital_rango" CHECK ("prestamo_participaciones"."pct_capital" > 0 and "prestamo_participaciones"."pct_capital" <= 100),
	CONSTRAINT "pct_ganancia_rango" CHECK ("prestamo_participaciones"."pct_ganancia" >= 0 and "prestamo_participaciones"."pct_ganancia" <= 100)
);
--> statement-breakpoint
CREATE TABLE "prestamos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" serial NOT NULL,
	"cliente_id" uuid NOT NULL,
	"proveedor_id" uuid,
	"fecha_desembolso" date NOT NULL,
	"ars_capital" numeric(20, 2) NOT NULL,
	"tc_entrada" numeric(20, 6) NOT NULL,
	"tasa_mensual_pct" numeric(9, 4) NOT NULL,
	"tasa_total_pct" numeric(9, 4) NOT NULL,
	"frecuencia" "frecuencia" NOT NULL,
	"n_cuotas" integer NOT NULL,
	"vencimiento_final" date NOT NULL,
	"usdt_prestado" numeric(20, 8) NOT NULL,
	"ars_interes_pactado" numeric(20, 2) NOT NULL,
	"estado" "estado_prestamo" DEFAULT 'vigente' NOT NULL,
	"fecha_cierre" date,
	"notas" text,
	"refinanciado_desde_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid NOT NULL,
	CONSTRAINT "prestamos_numero_unique" UNIQUE("numero"),
	CONSTRAINT "ars_capital_pos" CHECK ("prestamos"."ars_capital" > 0),
	CONSTRAINT "tc_entrada_pos" CHECK ("prestamos"."tc_entrada" > 0),
	CONSTRAINT "n_cuotas_pos" CHECK ("prestamos"."n_cuotas" > 0),
	CONSTRAINT "tasas_no_neg" CHECK ("prestamos"."tasa_mensual_pct" >= 0 and "prestamos"."tasa_total_pct" >= 0),
	CONSTRAINT "usdt_prestado_ok" CHECK ("prestamos"."usdt_prestado" = round("prestamos"."ars_capital" / "prestamos"."tc_entrada", 8)),
	CONSTRAINT "interes_pactado_ok" CHECK ("prestamos"."ars_interes_pactado" = round("prestamos"."ars_capital" * "prestamos"."tasa_total_pct" / 100, 2)),
	CONSTRAINT "cierre_coherente" CHECK (("prestamos"."estado" = 'vigente') = ("prestamos"."fecha_cierre" is null))
);
--> statement-breakpoint
CREATE TABLE "proveedores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"contacto" text,
	"notas" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transacciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fecha" date NOT NULL,
	"tipo" "tipo_transaccion" NOT NULL,
	"descripcion" text,
	"prestamo_id" uuid,
	"pago_id" uuid,
	"conversion_id" uuid,
	"anula_transaccion_id" uuid,
	"motivo" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_por" uuid NOT NULL,
	CONSTRAINT "transacciones_anula_transaccion_id_unique" UNIQUE("anula_transaccion_id"),
	CONSTRAINT "anulacion_con_motivo" CHECK ("transacciones"."tipo" <> 'anulacion' or ("transacciones"."anula_transaccion_id" is not null and "transacciones"."motivo" is not null))
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nombre" text NOT NULL,
	"rol" "rol_usuario" DEFAULT 'admin' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "anulaciones" ADD CONSTRAINT "anulaciones_transaccion_id_transacciones_id_fk" FOREIGN KEY ("transaccion_id") REFERENCES "public"."transacciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anulaciones" ADD CONSTRAINT "anulaciones_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asientos" ADD CONSTRAINT "asientos_transaccion_id_transacciones_id_fk" FOREIGN KEY ("transaccion_id") REFERENCES "public"."transacciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asientos" ADD CONSTRAINT "asientos_participante_id_participantes_id_fk" FOREIGN KEY ("participante_id") REFERENCES "public"."participantes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asientos" ADD CONSTRAINT "asientos_prestamo_id_prestamos_id_fk" FOREIGN KEY ("prestamo_id") REFERENCES "public"."prestamos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asientos" ADD CONSTRAINT "asientos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_prestamo_id_prestamos_id_fk" FOREIGN KEY ("prestamo_id") REFERENCES "public"."prestamos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_cuota_id_cuotas_id_fk" FOREIGN KEY ("cuota_id") REFERENCES "public"."cuotas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_lotes" ADD CONSTRAINT "conversion_lotes_conversion_id_conversiones_id_fk" FOREIGN KEY ("conversion_id") REFERENCES "public"."conversiones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_lotes" ADD CONSTRAINT "conversion_lotes_pago_id_pagos_id_fk" FOREIGN KEY ("pago_id") REFERENCES "public"."pagos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversiones" ADD CONSTRAINT "conversiones_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cuotas" ADD CONSTRAINT "cuotas_prestamo_id_prestamos_id_fk" FOREIGN KEY ("prestamo_id") REFERENCES "public"."prestamos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imputaciones" ADD CONSTRAINT "imputaciones_pago_id_pagos_id_fk" FOREIGN KEY ("pago_id") REFERENCES "public"."pagos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imputaciones" ADD CONSTRAINT "imputaciones_prestamo_id_prestamos_id_fk" FOREIGN KEY ("prestamo_id") REFERENCES "public"."prestamos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imputaciones" ADD CONSTRAINT "imputaciones_cuota_id_cuotas_id_fk" FOREIGN KEY ("cuota_id") REFERENCES "public"."cuotas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imputaciones" ADD CONSTRAINT "imputaciones_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participantes" ADD CONSTRAINT "participantes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prestamo_participaciones" ADD CONSTRAINT "prestamo_participaciones_prestamo_id_prestamos_id_fk" FOREIGN KEY ("prestamo_id") REFERENCES "public"."prestamos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prestamo_participaciones" ADD CONSTRAINT "prestamo_participaciones_participante_id_participantes_id_fk" FOREIGN KEY ("participante_id") REFERENCES "public"."participantes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prestamos" ADD CONSTRAINT "prestamos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prestamos" ADD CONSTRAINT "prestamos_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prestamos" ADD CONSTRAINT "prestamos_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prestamos" ADD CONSTRAINT "prestamos_refinanciado_desde_id_prestamos_id_fk" FOREIGN KEY ("refinanciado_desde_id") REFERENCES "public"."prestamos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transacciones" ADD CONSTRAINT "transacciones_prestamo_id_prestamos_id_fk" FOREIGN KEY ("prestamo_id") REFERENCES "public"."prestamos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transacciones" ADD CONSTRAINT "transacciones_pago_id_pagos_id_fk" FOREIGN KEY ("pago_id") REFERENCES "public"."pagos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transacciones" ADD CONSTRAINT "transacciones_conversion_id_conversiones_id_fk" FOREIGN KEY ("conversion_id") REFERENCES "public"."conversiones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transacciones" ADD CONSTRAINT "transacciones_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transacciones" ADD CONSTRAINT "transacciones_anula_transaccion_id_transacciones_id_fk" FOREIGN KEY ("anula_transaccion_id") REFERENCES "public"."transacciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asientos_tx_idx" ON "asientos" USING btree ("transaccion_id");--> statement-breakpoint
CREATE INDEX "asientos_cuenta_idx" ON "asientos" USING btree ("cuenta","participante_id","prestamo_id","cliente_id");--> statement-breakpoint
CREATE INDEX "auditoria_registro_idx" ON "auditoria" USING btree ("tabla","registro_id");--> statement-breakpoint
CREATE INDEX "cargos_prestamo_idx" ON "cargos" USING btree ("prestamo_id");--> statement-breakpoint
CREATE INDEX "clientes_nombre_idx" ON "clientes" USING btree ("nombre");--> statement-breakpoint
CREATE UNIQUE INDEX "clientes_documento_uq" ON "clientes" USING btree ("documento") WHERE "clientes"."documento" is not null;--> statement-breakpoint
CREATE INDEX "lotes_pago_idx" ON "conversion_lotes" USING btree ("pago_id");--> statement-breakpoint
CREATE INDEX "cuotas_vencimiento_idx" ON "cuotas" USING btree ("vencimiento");--> statement-breakpoint
CREATE INDEX "imputaciones_pago_idx" ON "imputaciones" USING btree ("pago_id");--> statement-breakpoint
CREATE INDEX "imputaciones_prestamo_idx" ON "imputaciones" USING btree ("prestamo_id");--> statement-breakpoint
CREATE INDEX "pagos_cliente_idx" ON "pagos" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "pagos_fecha_idx" ON "pagos" USING btree ("fecha");--> statement-breakpoint
CREATE UNIQUE INDEX "una_sola_sociedad" ON "participantes" USING btree ("tipo") WHERE "participantes"."tipo" = 'sociedad';--> statement-breakpoint
CREATE INDEX "prestamos_cliente_idx" ON "prestamos" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "prestamos_estado_idx" ON "prestamos" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "tx_fecha_idx" ON "transacciones" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "tx_prestamo_idx" ON "transacciones" USING btree ("prestamo_id");