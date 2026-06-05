/**
 * Drizzle schema for Hedra/Eleven media jobs.
 *
 * Integrates with Pillar Press's existing content: a job optionally belongs to
 * a piece (sourceContentId) and a campaign, and always to a user/workspace for
 * authorization. Prefer this single small table over broad schema changes — it
 * is the "media asset / job" record the UI lists and the poller updates.
 */
import { pgTable, uuid, text, integer, real, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const mediaJobStatus = ["queued", "processing", "completed", "failed", "canceled"] as const;
export const mediaJobType = ["image", "video", "avatar_video", "audio"] as const;

export const mediaJobs = pgTable(
  "media_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // ownership / authorization
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id"),
    campaignId: text("campaign_id"),
    // link to a Pillar Press article/post/campaign item
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
