/**
 * Drizzle schema for Hedra/Eleven media jobs.
 *
 * Integrates with King's Press's existing content: a job optionally belongs to
 * a piece (sourceContentId) and a campaign, and always to a user/workspace for
 * authorization. Prefer this single small table over broad schema changes — it
 * is the "media asset / job" record the UI lists and the poller updates.
 */
import { pgTable, uuid, text, integer, real, timestamp, jsonb, index, unique, boolean, numeric } from "drizzle-orm/pg-core";

// Gather (research connectors) tables live in their own file; re-export them so
// the Drizzle schema barrel (and drizzle-kit migrations) include them.
export * from "./gather-schema";
// Per-campaign image-style profiles + feedback history.
export * from "./style-schema";

export const mediaJobStatus = ["queued", "processing", "completed", "failed", "canceled"] as const;
export const mediaJobType = ["image", "video", "avatar_video", "audio"] as const;

export const membershipRole = ["author", "assistant"] as const;
export const pieceStatus = ["Draft", "Reviewed", "Revised", "Approved", "Formatted"] as const;
export const subscriptionStatus = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;
export const usageEventStatus = ["reserved", "succeeded", "failed", "canceled"] as const;
export const usageEventTask = [
  "review",
  "revision",
  "outputs",
  "weave",
  "gather",
  "file_extract",
  "media_generation",
  "chat",
  "utility",
] as const;
export const auditEventActorType = ["user", "system", "stripe", "admin"] as const;

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

export const providerSecrets = pgTable(
  "provider_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    kind: text("kind").notNull().default("llm"),
    profileId: text("profile_id").notNull(),
    label: text("label"),
    provider: text("provider").notNull(),
    model: text("model"),
    baseUrl: text("base_url"),
    encryptedApiKey: text("encrypted_api_key"),
    hasApiKey: boolean("has_api_key").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    taskDefaults: jsonb("task_defaults").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorkspace: index("provider_secrets_workspace_idx").on(t.workspaceId),
    byUser: index("provider_secrets_user_idx").on(t.userId),
    uniqProfile: unique("provider_secrets_workspace_user_kind_profile_unique").on(t.workspaceId, t.userId, t.kind, t.profileId),
  }),
);

export type ProviderSecret = typeof providerSecrets.$inferSelect;
export type NewProviderSecret = typeof providerSecrets.$inferInsert;

/* ============================================================
   SaaS foundation tables — hosted web only.
   Desktop/local-first does not read or write these tables.
   ============================================================ */

export const plans = pgTable(
  "plans",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    stripePriceId: text("stripe_price_id").unique(),
    monthlyPriceCents: integer("monthly_price_cents").notNull().default(0),
    currency: text("currency").notNull().default("usd"),
    trialDays: integer("trial_days").notNull().default(0),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    meta: jsonb("meta").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStripePrice: index("plans_stripe_price_idx").on(t.stripePriceId),
    byActive: index("plans_active_idx").on(t.active),
  }),
);

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;

export const entitlements = pgTable(
  "entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    maxCampaigns: integer("max_campaigns").notNull().default(1),
    monthlyLlmCredits: integer("monthly_llm_credits").notNull().default(0),
    monthlyMediaGenerations: integer("monthly_media_generations").notNull().default(0),
    monthlyGatherRuns: integer("monthly_gather_runs").notNull().default(0),
    storageQuotaGb: integer("storage_quota_gb").notNull().default(1),
    allowedProviders: jsonb("allowed_providers").notNull().default(["byok"]),
    canUseManagedKeys: boolean("can_use_managed_keys").notNull().default(false),
    maxConcurrentJobs: integer("max_concurrent_jobs").notNull().default(1),
    exportEnabled: boolean("export_enabled").notNull().default(true),
    driveEnabled: boolean("drive_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPlan: index("entitlements_plan_idx").on(t.planId),
    uniqPlan: unique("entitlements_plan_unique").on(t.planId),
  }),
);

export type Entitlement = typeof entitlements.$inferSelect;
export type NewEntitlement = typeof entitlements.$inferInsert;
export type SubscriptionStatus = (typeof subscriptionStatus)[number];
export type UsageEventStatus = (typeof usageEventStatus)[number];
export type UsageEventTask = (typeof usageEventTask)[number];

export const billingCustomers = pgTable(
  "billing_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull().unique(),
    billingEmail: text("billing_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorkspace: index("billing_customers_workspace_idx").on(t.workspaceId),
    uniqWorkspace: unique("billing_customers_workspace_unique").on(t.workspaceId),
  }),
);

export type BillingCustomer = typeof billingCustomers.$inferSelect;
export type NewBillingCustomer = typeof billingCustomers.$inferInsert;

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    stripePriceId: text("stripe_price_id"),
    status: text("status", { enum: subscriptionStatus }).notNull().default("trialing"),
    trialStart: timestamp("trial_start", { withTimezone: true }),
    trialEnd: timestamp("trial_end", { withTimezone: true }),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorkspace: index("subscriptions_workspace_idx").on(t.workspaceId),
    byStatus: index("subscriptions_status_idx").on(t.status),
    byStripeSubscription: index("subscriptions_stripe_subscription_idx").on(t.stripeSubscriptionId),
  }),
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    campaignId: text("campaign_id"),
    pieceId: text("piece_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    task: text("task", { enum: usageEventTask }).notNull(),
    feature: text("feature").notNull(),
    provider: text("provider"),
    model: text("model"),
    status: text("status", { enum: usageEventStatus }).notNull().default("reserved"),
    estimatedCredits: integer("estimated_credits").notNull().default(0),
    actualCredits: integer("actual_credits").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }),
    actualCostUsd: numeric("actual_cost_usd", { precision: 12, scale: 6 }),
    providerRequestId: text("provider_request_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").notNull().default({}),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorkspace: index("usage_events_workspace_idx").on(t.workspaceId),
    byWorkspaceTask: index("usage_events_workspace_task_idx").on(t.workspaceId, t.task),
    byStatus: index("usage_events_status_idx").on(t.status),
    uniqIdempotency: unique("usage_events_workspace_idempotency_unique").on(t.workspaceId, t.idempotencyKey),
  }),
);

export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;

export const usageRollups = pgTable(
  "usage_rollups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    llmCreditsUsed: integer("llm_credits_used").notNull().default(0),
    mediaGenerationsUsed: integer("media_generations_used").notNull().default(0),
    gatherRunsUsed: integer("gather_runs_used").notNull().default(0),
    storageBytesUsed: numeric("storage_bytes_used", { precision: 20, scale: 0 }).notNull().default("0"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorkspace: index("usage_rollups_workspace_idx").on(t.workspaceId),
    uniqPeriod: unique("usage_rollups_workspace_period_unique").on(t.workspaceId, t.periodStart, t.periodEnd),
  }),
);

export type UsageRollup = typeof usageRollups.$inferSelect;
export type NewUsageRollup = typeof usageRollups.$inferInsert;

export const trialEvents = pgTable(
  "trial_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    event: text("event").notNull(),
    planId: text("plan_id").references(() => plans.id),
    trialStart: timestamp("trial_start", { withTimezone: true }),
    trialEnd: timestamp("trial_end", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorkspace: index("trial_events_workspace_idx").on(t.workspaceId),
    byEvent: index("trial_events_event_idx").on(t.event),
  }),
);

export type TrialEvent = typeof trialEvents.$inferSelect;
export type NewTrialEvent = typeof trialEvents.$inferInsert;

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    actorType: text("actor_type", { enum: auditEventActorType }).notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorkspace: index("audit_events_workspace_idx").on(t.workspaceId),
    byAction: index("audit_events_action_idx").on(t.action),
    byCreated: index("audit_events_created_idx").on(t.createdAt),
  }),
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
