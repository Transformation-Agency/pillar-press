-- Hosted background job foundation for long-running SaaS workflows.
-- Desktop/local-first does not read or write this table.

CREATE TABLE IF NOT EXISTS "background_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "user_id" text,
  "campaign_id" text,
  "piece_id" text,
  "kind" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "run_after" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_by" text,
  "locked_at" timestamp with time zone,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "idempotency_key" text,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_code" text,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_jobs_workspace_idx" ON "background_jobs" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_jobs_status_run_after_idx" ON "background_jobs" USING btree ("status", "run_after", "priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_jobs_workspace_status_idx" ON "background_jobs" USING btree ("workspace_id", "status", "run_after");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "background_jobs_workspace_idempotency_unique"
  ON "background_jobs" USING btree ("workspace_id", "idempotency_key");
