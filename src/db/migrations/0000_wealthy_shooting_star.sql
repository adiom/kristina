CREATE TABLE "cf_kristina_activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"context" jsonb,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "cf_kristina_diary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"reflection" text NOT NULL,
	"insights_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf_kristina_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"score" numeric(4, 2) DEFAULT '5.00' NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"source" text NOT NULL,
	"last_explored" timestamp,
	"score_below_threshold_since" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf_kristina_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text NOT NULL,
	"category" text NOT NULL,
	"importance" integer NOT NULL,
	"tags" text[] DEFAULT '{}',
	"user_id" uuid,
	"context" jsonb,
	"embedding" vector(768),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf_kristina_traits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"value" numeric(3, 2) DEFAULT '0.50' NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activity_log_timestamp_idx" ON "cf_kristina_activity_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "activity_log_type_idx" ON "cf_kristina_activity_log" USING btree ("type");--> statement-breakpoint
CREATE INDEX "diary_created_at_idx" ON "cf_kristina_diary" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "interests_score_idx" ON "cf_kristina_interests" USING btree ("score");--> statement-breakpoint
CREATE INDEX "interests_topic_idx" ON "cf_kristina_interests" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "memory_user_id_idx" ON "cf_kristina_memory" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memory_category_idx" ON "cf_kristina_memory" USING btree ("category");--> statement-breakpoint
CREATE INDEX "memory_created_at_idx" ON "cf_kristina_memory" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "traits_name_idx" ON "cf_kristina_traits" USING btree ("name");