CREATE TABLE "cf_kristina_vault_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"item_id" uuid,
	"type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"details" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf_kristina_vault_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"mime_type" text,
	"size_bytes" integer,
	"storage_key" text,
	"sha256" text,
	"source" text NOT NULL,
	"created_by_user_id" text,
	"tags" text[] DEFAULT '{}',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf_kristina_vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"global_user_id" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"onboarding_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "cf_kristina_memory" ADD COLUMN "vault_id" uuid;--> statement-breakpoint
ALTER TABLE "cf_kristina_vault_events" ADD CONSTRAINT "cf_kristina_vault_events_vault_id_cf_kristina_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."cf_kristina_vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cf_kristina_vault_items" ADD CONSTRAINT "cf_kristina_vault_items_vault_id_cf_kristina_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."cf_kristina_vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vault_events_vault_id_idx" ON "cf_kristina_vault_events" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "vault_events_type_idx" ON "cf_kristina_vault_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "vault_events_created_at_idx" ON "cf_kristina_vault_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "vault_items_vault_id_idx" ON "cf_kristina_vault_items" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "vault_items_kind_idx" ON "cf_kristina_vault_items" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "vault_items_created_at_idx" ON "cf_kristina_vault_items" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vaults_global_user_id_idx" ON "cf_kristina_vaults" USING btree ("global_user_id");--> statement-breakpoint
CREATE INDEX "vaults_status_idx" ON "cf_kristina_vaults" USING btree ("status");--> statement-breakpoint
CREATE INDEX "memory_vault_id_idx" ON "cf_kristina_memory" USING btree ("vault_id");