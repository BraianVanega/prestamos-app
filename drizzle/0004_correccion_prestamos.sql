ALTER TYPE "public"."estado_prestamo" ADD VALUE 'anulado';--> statement-breakpoint
ALTER TABLE "prestamos" ADD COLUMN "corrige_a_id" uuid;--> statement-breakpoint
ALTER TABLE "prestamos" ADD CONSTRAINT "prestamos_corrige_a_id_prestamos_id_fk" FOREIGN KEY ("corrige_a_id") REFERENCES "public"."prestamos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prestamos" ADD CONSTRAINT "prestamos_corrige_a_unico" UNIQUE("corrige_a_id");