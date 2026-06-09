/**
 * Drizzle schema for Hedra/Eleven media jobs.
 *
 * Integrates with King's Press's existing content: a job optionally belongs to
 * a piece (sourceContentId) and a campaign, and always to a user/workspace for
 * authorization. Prefer this single small table over broad schema changes — it
 * is the "media asset / job" record the UI lists and the poller updates.
 */
import { pgTable, uuid, text, integer, real, timestamp, jsonb, index, unique } from "drizzle-orm/pg-core";

// Gather (research connectors) tables live in their own file; re-export them so
// the Drizzle schema barrel (and drizzle-kit migrations) include them.
export * from "./gather-schema";
// Per-campaign image-style profiles + feedback history.
export * from "./style-schema";

export const mediaJobStatus = ["queued", "processing", "completed", "failed", "canceled"] as const;
export const mediaJobType = ["image", "video", "avatar_video", "audio"] as const;

export const membershipRole = ["author", "assistant"] as const;
export const pieceStatus = ["Draft", "Reviewed", "Revised", "Approved", "Formatted"] as const;

export const mediaJobs = pgTable(
  "media_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // ownership / authorization
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id"),
    campaignId: text("campaign_id"),
    // link to a King's Press article/post/campaign item
    sourceContentId: text("source_content_id"),

    // provider references
    hedraGenerationId: text("hedra_generation_id"),
    hedraAssetId: text("hedra_asset_id"),
    elevenAudioAssetId: text("eleven_audio_asset_id"),

    // request
    type: text("type", { enum: mediaJobType }).notNull(),
    prompt: text("prompt"),
    modelId: text("model_id").notNull(),
    modelName: text("model_name"),
    voiceId: text("voice_id"),
    aspectRatio: text("aspect_ratio"),
    resolution: text("resolution"),
    duration: integer("duration"),

    // lifecycle
    status: text("status", { enum: mediaJobStatus }).notNull().default("queued"),
    progress: integer("progress").default(0),

    // outputs (note: Hedra URLs may be temporary/signed — refresh from status
    // rather than treating these as permanent)
    outputUrl: text("output_url"),
    downloadUrl: text("download_url"),
    thumbnailUrl: text("thumbnail_url"),

    // accounting + errors
    creditsEstimate: real("credits_estimate"),
    creditsActual: real("credits_actual"),
    errorMessage: text("error_message"),
    meta: jsonb("meta"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    byUser: index("media_jobs_user_idx").on(t.userId),
    byContent: index("media_jobs_content_idx").on(t.sourceContentId),
    byGen: index("media_jobs_gen_idx").on(t.hedraGenerationId),
  }),
);

export type MediaJob = typeof mediaJobs.$inferSelect;
export type NewMediaJob = typeof mediaJobs.$inferInsert;

/* ============================================================
   Core King's Press tables — campaigns, references, pieces,
   settings, memberships, workspaces. All scoped by
   workspace/user/campaign for authorization.
   ============================================================ */

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role", { enum: membershipRole }).notNull().default("author"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorkspace: index("memberships_workspace_idx").on(t.workspaceId),
    byUser: index("memberships_user_idx").on(t.userId),
    uniqWorkspaceUser: unique("memberships_workspace_user_unique").on(t.workspaceId, t.userId),
  }),
);

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorkspace: index("campaigns_workspace_idx").on(t.workspaceId),
    uniqWorkspaceSlug: unique("campaigns_workspace_slug_unique").on(t.workspaceId, t.slug),
  }),
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

export const references = pgTable(
  "references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .unique()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    // doc = SEED_REFERENCES shape:
    // { strategy, audiences, registers, voiceRules, redLines, selfVision, gateSpec }
    doc: jsonb("doc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export type Reference = typeof references.$inferSelect;
export type NewReference = typeof references.$inferInsert;

export const pieces = pgTable(
  "pieces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: pieceStatus }).notNull().default("Draft"),
    original: text("original").notNull().default(""),
    // packet = gate results keyed by gate id (nullable)
    packet: jsonb("packet"),
    // revision = { text, changelog: [{change,finding,note}] } (nullable)
    revision: jsonb("revision"),
    // outputs = { [platformId]: OutputObject } (nullable)
    outputs: jsonb("outputs"),
    // outputOrder = string[] platform ids in generation order
    outputOrder: jsonb("output_order"),
    // author guidance for the revision: overall creative direction + per-gate
    // commentary ({ [gateId]: note }), both fed into the reviser prompt.
    direction: text("direction"),
    gateNotes: jsonb("gate_notes").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCampaign: index("pieces_campaign_idx").on(t.campaignId),
    byUser: index("pieces_user_idx").on(t.userId),
  }),
);

export type Piece = typeof pieces.$inferSelect;
export type NewPiece = typeof pieces.$inferInsert;

export const settings = pgTable(
  "settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    driveFolderId: text("drive_folder_id"),
    // server-side OAuth refresh token (treated as a secret)
    driveRefreshToken: text("drive_refresh_token"),
    // non-secret UI prefs (theme, active campaign, tweaks)
    prefs: jsonb("prefs"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("settings_user_idx").on(t.userId),
    byWorkspace: index("settings_workspace_idx").on(t.workspaceId),
  }),
);

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
