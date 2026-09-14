ALTER TABLE "cf_kristina_memory" ADD COLUMN "memory_type" text DEFAULT 'episode' NOT NULL;--> statement-breakpoint
ALTER TABLE "cf_kristina_memory" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "cf_kristina_memory" ADD COLUMN "confidence" integer DEFAULT 70 NOT NULL;--> statement-breakpoint
ALTER TABLE "cf_kristina_memory" ADD COLUMN "source_type" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "cf_kristina_memory" ADD COLUMN "last_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "cf_kristina_memory" ADD COLUMN "valid_until" timestamp;--> statement-breakpoint
ALTER TABLE "cf_kristina_memory" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "cf_kristina_memory" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "cf_kristina_memory" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "cf_kristina_memory" ADD COLUMN "local_user_id" text;--> statement-breakpoint
CREATE INDEX "memory_status_idx" ON "cf_kristina_memory" USING btree ("status");--> statement-breakpoint
CREATE INDEX "memory_type_idx" ON "cf_kristina_memory" USING btree ("memory_type");--> statement-breakpoint
CREATE INDEX "memory_content_hash_idx" ON "cf_kristina_memory" USING btree ("content_hash");--> statement-breakpoint
UPDATE "cf_kristina_memory"
SET "content_hash" = encode(sha256(convert_to("content", 'UTF8')), 'hex');--> statement-breakpoint
UPDATE "cf_kristina_memory"
SET "embedding_model" = 'nomic-embed-text:latest'
WHERE "embedding_model" IS NULL;--> statement-breakpoint
UPDATE "cf_kristina_memory"
SET "status" = 'legacy_local_only'
WHERE "user_id" IS NOT NULL
  AND "vault_id" IS NULL
  AND "status" = 'active';
