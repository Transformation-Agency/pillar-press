CREATE TABLE IF NOT EXISTS "provider_secrets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "user_id" text,
  "kind" text DEFAULT 'llm' NOT NULL,
  "profile_id" text NOT NULL,
  "label" text,
  "provider" text NOT NULL,
  "model" text,
  "base_url" text,
  "encrypted_api_key" text,
  "has_api_key" boolean DEFAULT false NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "task_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "provider_secrets_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_secrets_workspace_idx" ON "provider_secrets" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_secrets_user_idx" ON "provider_secrets" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_secrets_workspace_user_kind_profile_unique"
  ON "provider_secrets" USING btree ("workspace_id", "user_id", "kind", "profile_id");
