CREATE TABLE "style_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" text NOT NULL,
	"media_job_id" uuid,
	"rating" integer,
	"knobs" jsonb,
	"working" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" text NOT NULL,
	"user_id" text NOT NULL,
	"knobs" jsonb DEFAULT '{"palette":"warm","mood":"neutral","finish":"photographic","detail":"balanced"}'::jsonb NOT NULL,
	"directive" text DEFAULT '' NOT NULL,
	"rounds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "style_profiles_campaign_id_unique" UNIQUE("campaign_id")
);
