CREATE TABLE "cf_kristina_vault_identity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"service_id" text NOT NULL,
	"external_user_id" text NOT NULL,
	"display_name" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cf_kristina_vault_identity_links" ADD CONSTRAINT "cf_kristina_vault_identity_links_vault_id_cf_kristina_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."cf_kristina_vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vault_identity_links_service_user_idx" ON "cf_kristina_vault_identity_links" USING btree ("service_id","external_user_id");--> statement-breakpoint
CREATE INDEX "vault_identity_links_vault_id_idx" ON "cf_kristina_vault_identity_links" USING btree ("vault_id");