CREATE TABLE "media_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"campaign_id" text,
	"source_content_id" text,
	"hedra_generation_id" text,
	"hedra_asset_id" text,
	"eleven_audio_asset_id" text,
	"type" text NOT NULL,
	"prompt" text,
	"model_id" text NOT NULL,
	"model_name" text,
	"voice_id" text,
	"aspect_ratio" text,
	"resolution" text,
	"duration" integer,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0,
	"output_url" text,
	"download_url" text,
	"thumbnail_url" text,
	"credits_estimate" real,
	"credits_actual" real,
	"error_message" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "media_jobs_user_idx" ON "media_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "media_jobs_content_idx" ON "media_jobs" USING btree ("source_content_id");--> statement-breakpoint
CREATE INDEX "media_jobs_gen_idx" ON "media_jobs" USING btree ("hedra_generation_id");