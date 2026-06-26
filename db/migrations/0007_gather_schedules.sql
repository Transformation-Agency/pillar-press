-- Hosted Gather schedules.
-- Desktop/local-first keeps using the SQLite gather_schedules table.

CREATE TABLE IF NOT EXISTS "gather_schedules" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "user_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "campaign_id" text NOT NULL,
  "cadence" text NOT NULL,
  "run_at" text,
  "time_of_day" text,
  "day_of_week" integer,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_run_at" text,
  "last_status" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "gather_schedules_cadence_check" CHECK ("cadence" IN ('once', 'daily', 'weekly'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gather_schedules_campaign_idx" ON "gather_schedules" USING btree ("workspace_id","campaign_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gather_schedules_due_idx" ON "gather_schedules" USING btree ("workspace_id","user_id","enabled");
