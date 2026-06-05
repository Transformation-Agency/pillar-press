CREATE TABLE "gather_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"source_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"source" text,
	"author" text,
	"url" text,
	"published_at" text,
	"snippet" text,
	"transcript" text,
	"raw" jsonb,
	"selected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gather_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"kind" text NOT NULL,
	"config" text DEFAULT '' NOT NULL,
	"label" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run" timestamp with time zone,
	"last_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gather_items_campaign_idx" ON "gather_items" USING btree ("campaign_id","user_id");--> statement-breakpoint
CREATE INDEX "gather_items_url_idx" ON "gather_items" USING btree ("campaign_id","url");--> statement-breakpoint
CREATE INDEX "gather_sources_campaign_idx" ON "gather_sources" USING btree ("campaign_id","user_id");