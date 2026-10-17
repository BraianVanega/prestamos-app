ALTER TABLE "prestamos" DROP CONSTRAINT "prestamos_numero_unique";--> statement-breakpoint
ALTER TABLE "prestamos" ALTER COLUMN "mora_pct" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "prestamos" ALTER COLUMN "dias_gracia" SET DEFAULT 0;--> statement-breakpoint
CREATE UNIQUE INDEX "prestamos_numero_vigente" ON "prestamos" USING btree ("numero") WHERE "prestamos"."estado" <> 'anulado';