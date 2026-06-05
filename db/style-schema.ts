/**
 * Per-campaign learned image-style preferences.
 *  - style_profiles: one evolving profile per campaign (knobs + directive).
 *  - style_feedback: optional history of each rating round (auditable evolution).
 * Mirrors the media_jobs style. Re-exported from db/schema.ts.
 */
import { pgTable, uuid, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export type StyleKnobs = {
  palette: "warm" | "cool" | "muted" | "vivid" | "mono";
  mood: "bright" | "neutral" | "moody";
  finish: "photographic" | "illustrated" | "painterly" | "graphic";
  detail: "minimal" | "balanced" | "detailed";
};

export const DEFAULT_KNOBS: StyleKnobs = {
  palette: "warm",
  mood: "neutral",
  finish: "photographic",
  detail: "balanced",
};

export const styleProfiles = pgTable("style_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: text("campaign_id").notNull().unique(),
  userId: text("user_id").notNull(),
  knobs: jsonb("knobs").notNull().default(DEFAULT_KNOBS),
  directive: text("directive").notNull().default(""),
  rounds: integer("rounds").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const styleFeedback = pgTable("style_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: text("campaign_id").notNull(),
  mediaJobId: uuid("media_job_id"),
  rating: integer("rating"),
  knobs: jsonb("knobs"),
  working: text("working"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StyleProfile = typeof styleProfiles.$inferSelect;
export type StyleFeedbackRow = typeof styleFeedback.$inferSelect;
