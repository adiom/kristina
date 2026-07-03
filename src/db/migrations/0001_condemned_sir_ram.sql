ALTER TABLE "cf_kristina_memory" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "cf_kristina_memory" ADD COLUMN "service" text;--> statement-breakpoint
CREATE INDEX "memory_space_id_idx" ON "cf_kristina_memory" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "memory_service_idx" ON "cf_kristina_memory" USING btree ("service");