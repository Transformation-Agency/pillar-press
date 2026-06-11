-- Stage 0 SaaS foundation for hosted King's Press.
-- Desktop/local-first does not read or write these tables.

CREATE TABLE IF NOT EXISTS "plans" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "stripe_price_id" text UNIQUE,
  "monthly_price_cents" integer DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'usd' NOT NULL,
  "trial_days" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plans_stripe_price_idx" ON "plans" USING btree ("stripe_price_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plans_active_idx" ON "plans" USING btree ("active");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "entitlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" text NOT NULL REFERENCES "plans"("id") ON DELETE cascade,
  "max_campaigns" integer DEFAULT 1 NOT NULL,
  "monthly_llm_credits" integer DEFAULT 0 NOT NULL,
  "monthly_media_generations" integer DEFAULT 0 NOT NULL,
  "monthly_gather_runs" integer DEFAULT 0 NOT NULL,
  "storage_quota_gb" integer DEFAULT 1 NOT NULL,
  "allowed_providers" jsonb DEFAULT '["byok"]'::jsonb NOT NULL,
  "can_use_managed_keys" boolean DEFAULT false NOT NULL,
  "max_concurrent_jobs" integer DEFAULT 1 NOT NULL,
  "export_enabled" boolean DEFAULT true NOT NULL,
  "drive_enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "entitlements_plan_unique" UNIQUE("plan_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entitlements_plan_idx" ON "entitlements" USING btree ("plan_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "billing_customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "stripe_customer_id" text NOT NULL UNIQUE,
  "billing_email" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_customers_workspace_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_customers_workspace_idx" ON "billing_customers" USING btree ("workspace_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "plan_id" text NOT NULL REFERENCES "plans"("id"),
  "stripe_customer_id" text,
  "stripe_subscription_id" text UNIQUE,
  "stripe_price_id" text,
  "status" text DEFAULT 'trialing' NOT NULL,
  "trial_start" timestamp with time zone,
  "trial_end" timestamp with time zone,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "canceled_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_workspace_idx" ON "subscriptions" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_status_idx" ON "subscriptions" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_stripe_subscription_idx" ON "subscriptions" USING btree ("stripe_subscription_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "user_id" text,
  "campaign_id" text,
  "piece_id" text,
  "idempotency_key" text NOT NULL,
  "task" text NOT NULL,
  "feature" text NOT NULL,
  "provider" text,
  "model" text,
  "status" text DEFAULT 'reserved' NOT NULL,
  "estimated_credits" integer DEFAULT 0 NOT NULL,
  "actual_credits" integer DEFAULT 0 NOT NULL,
  "input_tokens" integer,
  "output_tokens" integer,
  "estimated_cost_usd" numeric(12, 6),
  "actual_cost_usd" numeric(12, 6),
  "provider_request_id" text,
  "error_code" text,
  "error_message" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "usage_events_workspace_idempotency_unique" UNIQUE("workspace_id","idempotency_key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_workspace_idx" ON "usage_events" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_workspace_task_idx" ON "usage_events" USING btree ("workspace_id","task");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_status_idx" ON "usage_events" USING btree ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "usage_rollups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "llm_credits_used" integer DEFAULT 0 NOT NULL,
  "media_generations_used" integer DEFAULT 0 NOT NULL,
  "gather_runs_used" integer DEFAULT 0 NOT NULL,
  "storage_bytes_used" numeric(20, 0) DEFAULT 0 NOT NULL,
  "cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "usage_rollups_workspace_period_unique" UNIQUE("workspace_id","period_start","period_end")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_rollups_workspace_idx" ON "usage_rollups" USING btree ("workspace_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "trial_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "user_id" text,
  "event" text NOT NULL,
  "plan_id" text REFERENCES "plans"("id"),
  "trial_start" timestamp with time zone,
  "trial_end" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trial_events_workspace_idx" ON "trial_events" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trial_events_event_idx" ON "trial_events" USING btree ("event");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE cascade,
  "actor_type" text NOT NULL,
  "actor_id" text,
  "action" text NOT NULL,
  "target_type" text,
  "target_id" text,
  "ip_hash" text,
  "user_agent" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_workspace_idx" ON "audit_events" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_action_idx" ON "audit_events" USING btree ("action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_created_idx" ON "audit_events" USING btree ("created_at");
--> statement-breakpoint

INSERT INTO "plans" ("id", "name", "description", "monthly_price_cents", "trial_days", "sort_order", "meta")
VALUES
  ('trial', 'Free Trial', 'Seven-day evaluation with managed credits and tight limits.', 0, 7, 0, '{"public":false}'::jsonb),
  ('starter', 'Starter', 'Personal writing desk with capped monthly AI, Gather, media, and storage.', 1900, 0, 10, '{"public":true}'::jsonb),
  ('pro', 'Pro', 'Higher limits for active publishing workflows and priority processing.', 4900, 0, 20, '{"public":true}'::jsonb),
  ('team', 'Team', 'Shared workspace plan reserved for phase two.', 9900, 0, 30, '{"public":false,"phase":2}'::jsonb)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "monthly_price_cents" = EXCLUDED."monthly_price_cents",
  "trial_days" = EXCLUDED."trial_days",
  "sort_order" = EXCLUDED."sort_order",
  "meta" = EXCLUDED."meta",
  "updated_at" = now();
--> statement-breakpoint

INSERT INTO "entitlements" (
  "plan_id",
  "max_campaigns",
  "monthly_llm_credits",
  "monthly_media_generations",
  "monthly_gather_runs",
  "storage_quota_gb",
  "allowed_providers",
  "can_use_managed_keys",
  "max_concurrent_jobs",
  "export_enabled",
  "drive_enabled"
)
VALUES
  ('trial', 2, 250, 5, 10, 1, '["managed","byok"]'::jsonb, true, 1, true, false),
  ('starter', 10, 2000, 40, 100, 5, '["managed","byok"]'::jsonb, true, 2, true, true),
  ('pro', 50, 10000, 250, 500, 25, '["managed","byok"]'::jsonb, true, 5, true, true),
  ('team', 250, 50000, 1000, 2500, 100, '["managed","byok"]'::jsonb, true, 15, true, true)
ON CONFLICT ("plan_id") DO UPDATE SET
  "max_campaigns" = EXCLUDED."max_campaigns",
  "monthly_llm_credits" = EXCLUDED."monthly_llm_credits",
  "monthly_media_generations" = EXCLUDED."monthly_media_generations",
  "monthly_gather_runs" = EXCLUDED."monthly_gather_runs",
  "storage_quota_gb" = EXCLUDED."storage_quota_gb",
  "allowed_providers" = EXCLUDED."allowed_providers",
  "can_use_managed_keys" = EXCLUDED."can_use_managed_keys",
  "max_concurrent_jobs" = EXCLUDED."max_concurrent_jobs",
  "export_enabled" = EXCLUDED."export_enabled",
  "drive_enabled" = EXCLUDED."drive_enabled",
  "updated_at" = now();
