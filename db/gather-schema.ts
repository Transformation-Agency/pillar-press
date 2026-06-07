/** Drizzle schema for Gather: sources + persisted items. Follows the media_jobs style. */
import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";

// "upload" = a document the user uploaded (not fetched by a connector).
export const gatherKind = ["rss", "web", "database", "journal", "x", "youtube", "upload"] as const;

export const gatherSources = pgTable(
  "gather_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    campaignId: text("campaign_id").notNull(),
    kind: text("kind", { enum: gatherKind }).notNull(),
    config: text("config").notNull().default(""), // url or query
    label: text("label"),
    enabled: boolean("enabled").notNull().default(true),
    lastRun: timestamp("last_run", { withTimezone: true }),
    lastCount: integer("last_count"),
    // Latest per-source research brief (one current brief per source), persisted
    // so it survives reloads. Cleared when the user dismisses or sends it to Weave.
    summary: text("summary"),
    summaryAt: timestamp("summary_at", { withTimezone: true }),
    summaryItemCount: integer("summary_item_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byCampaign: index("gather_sources_campaign_idx").on(t.campaignId, t.userId) }),
);

export const gatherItems = pgTable(
  "gather_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    campaignId: text("campaign_id").notNull(),
    sourceId: uuid("source_id"),
    kind: text("kind", { enum: gatherKind }).notNull(),
    title: text("title").notNull(),
    source: text("source"),
    author: text("author"),
    url: text("url"),
    publishedAt: text("published_at"),
    snippet: text("snippet"),
    transcript: text("transcript"),
    raw: jsonb("raw"),
    selected: boolean("selected").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCampaign: index("gather_items_campaign_idx").on(t.campaignId, t.userId),
    // de-dupe target: (campaign_id, url)
    byUrl: index("gather_items_url_idx").on(t.campaignId, t.url),
  }),
);

export type GatherSource = typeof gatherSources.$inferSelect;
export type GatherItemRow = typeof gatherItems.$inferSelect;
