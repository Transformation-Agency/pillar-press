ALTER TABLE "pieces" ADD COLUMN "direction" text;--> statement-breakpoint
ALTER TABLE "pieces" ADD COLUMN "gate_notes" jsonb DEFAULT '{}'::jsonb NOT NULL;