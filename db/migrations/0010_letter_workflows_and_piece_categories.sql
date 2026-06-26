-- Category-aware editorial workflows and saved-recipient letter drafting.
-- Desktop uses db/local-sqlite-schema.sql; this keeps hosted Postgres in step.

ALTER TABLE "pieces" ADD COLUMN IF NOT EXISTS "category" text DEFAULT 'article' NOT NULL;
--> statement-breakpoint
ALTER TABLE "pieces" ADD COLUMN IF NOT EXISTS "category_context" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "letter_recipients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "workspace_id" uuid NOT NULL,
  "display_name" text NOT NULL,
  "sort_name" text,
  "organization" text,
  "role" text,
  "relationship" text,
  "default_salutation" text,
  "default_signoff" text,
  "default_tone" text,
  "notes" text,
  "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "letter_recipients_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "letter_workflows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "piece_id" uuid,
  "recipient_id" uuid,
  "recipient_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "purpose" text DEFAULT '' NOT NULL,
  "desired_outcome" text,
  "occasion" text,
  "tone" text,
  "constraints" text,
  "source_context" text,
  "uploads" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "dictation_transcript" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "letter_workflows_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "letter_workflows_campaign_id_campaigns_id_fk"
    FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade,
  CONSTRAINT "letter_workflows_piece_id_pieces_id_fk"
    FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE set null,
  CONSTRAINT "letter_workflows_recipient_id_letter_recipients_id_fk"
    FOREIGN KEY ("recipient_id") REFERENCES "public"."letter_recipients"("id") ON DELETE set null
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "letter_recipients_workspace_idx"
  ON "letter_recipients" USING btree ("workspace_id", "user_id", "display_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "letter_workflows_campaign_idx"
  ON "letter_workflows" USING btree ("campaign_id", "user_id", "updated_at");
