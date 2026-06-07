-- Persist the per-source research brief so it survives reloads.
-- (Gather is managed by hand-written SQL — see 0002_gather.sql — not drizzle generate.)
ALTER TABLE "gather_sources" ADD COLUMN IF NOT EXISTS "summary" text;
ALTER TABLE "gather_sources" ADD COLUMN IF NOT EXISTS "summary_at" timestamp with time zone;
ALTER TABLE "gather_sources" ADD COLUMN IF NOT EXISTS "summary_item_count" integer;
