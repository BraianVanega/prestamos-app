ALTER TABLE "prestamos" ADD COLUMN "mora_pct" numeric(9, 4) DEFAULT '20' NOT NULL;--> statement-breakpoint
ALTER TABLE "prestamos" ADD COLUMN "dias_gracia" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "prestamos" ADD CONSTRAINT "mora_no_neg" CHECK ("prestamos"."mora_pct" >= 0 and "prestamos"."dias_gracia" >= 0);