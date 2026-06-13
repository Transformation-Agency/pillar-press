import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_KNOBS, type StyleKnobs } from "@/db/style-schema";
import { EMPTY_REFERENCES, slug } from "@/lib/seed-data";
import { localDatabasePath } from "@/lib/local/paths";

export const LOCAL_USER_ID = "local-owner";
export const LOCAL_WORKSPACE_ID = "local-workspace";

let singleton: Database.Database | null = null;

function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function schemaSql(): string {
  return readFileSync(join(process.cwd(), "db", "local-sqlite-schema.sql"), "utf8");
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row: any) => row.name === column);
}

function addColumn(db: Database.Database, table: string, column: string, definition: string): void {
  if (!hasColumn(db, table, column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

function migrateLooseColumns(db: Database.Database): void {
  // Keeps early desktop-dev databases usable after local schema expansion.
  addColumn(db, "pieces", "user_id", "TEXT NOT NULL DEFAULT 'local-owner'");
  addColumn(db, "gather_sources", "user_id", "TEXT NOT NULL DEFAULT 'local-owner'");
  addColumn(db, "gather_items", "user_id", "TEXT NOT NULL DEFAULT 'local-owner'");
  addColumn(db, "gather_schedules", "user_id", "TEXT NOT NULL DEFAULT 'local-owner'");
  addColumn(db, "gather_schedules", "time_of_day", "TEXT");
  addColumn(db, "gather_schedules", "day_of_week", "INTEGER");
  addColumn(db, "media_jobs", "user_id", "TEXT NOT NULL DEFAULT 'local-owner'");
  addColumn(db, "media_jobs", "workspace_id", "TEXT");
  addColumn(db, "media_jobs", "hedra_generation_id", "TEXT");
  addColumn(db, "media_jobs", "hedra_asset_id", "TEXT");
  addColumn(db, "media_jobs", "eleven_audio_asset_id", "TEXT");
  addColumn(db, "media_jobs", "voice_id", "TEXT");
  addColumn(db, "media_jobs", "aspect_ratio", "TEXT");
  addColumn(db, "media_jobs", "resolution", "TEXT");
  addColumn(db, "media_jobs", "duration", "INTEGER");
  addColumn(db, "media_jobs", "output_url", "TEXT");
  addColumn(db, "media_jobs", "download_url", "TEXT");
  addColumn(db, "media_jobs", "thumbnail_url", "TEXT");
  addColumn(db, "media_jobs", "credits_estimate", "REAL");
  addColumn(db, "media_jobs", "credits_actual", "REAL");
  addColumn(db, "campaigns", "meta_json", "TEXT");
  addColumn(db, "settings", "user_id", "TEXT");
  addColumn(db, "settings", "workspace_id", "TEXT");
  addColumn(db, "settings", "drive_folder_id", "TEXT");
  addColumn(db, "settings", "drive_refresh_token", "TEXT");
}

export function localDb(): Database.Database {
  if (singleton) return singleton;
  const dbPath = localDatabasePath();
  mkdirSync(dirname(dbPath), { recursive: true });
  singleton = new Database(dbPath);
  singleton.pragma("journal_mode = WAL");
  singleton.pragma("foreign_keys = ON");
  singleton.exec(schemaSql());
  migrateLooseColumns(singleton);
  return singleton;
}

export interface LocalWorkspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalCampaign {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalReference {
  id: string;
  campaignId: string;
  doc: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface LocalStyleProfile {
  id: string;
  campaignId: string;
  userId: string;
  knobs: StyleKnobs;
  directive: string;
  rounds: number;
  updatedAt: string;
}

export interface LocalStyleFeedback {
  id: string;
  campaignId: string;
  mediaJobId: string | null;
  rating: number | null;
  knobs: StyleKnobs | null;
  working: string | null;
  notes: string | null;
  createdAt: string;
}

export interface LocalPiece {
  id: string;
  campaignId: string;
  userId: string;
  title: string;
  status: "Draft" | "Reviewed" | "Revised" | "Approved" | "Formatted";
  original: string;
  packet: unknown | null;
  revision: unknown | null;
  outputs: unknown | null;
  outputOrder: unknown | null;
  direction: string | null;
  gateNotes: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface LocalGatherSource {
  id: string;
  userId: string;
  campaignId: string;
  kind: "rss" | "web" | "database" | "journal" | "x" | "youtube" | "upload";
  config: string;
  label: string | null;
  enabled: boolean;
  lastRun: string | null;
  lastCount: number | null;
  summary: string | null;
  summaryAt: string | null;
  summaryItemCount: number | null;
  createdAt: string;
}

export interface LocalGatherItem {
  id: string;
  userId: string;
  campaignId: string;
  sourceId: string | null;
  kind: "rss" | "web" | "database" | "journal" | "x" | "youtube" | "upload";
  title: string;
  source: string | null;
  author: string | null;
  url: string | null;
  publishedAt: string | null;
  date: string | null;
  snippet: string | null;
  transcript: string | null;
  raw: unknown | null;
  selected: boolean;
  createdAt: string;
}

export interface LocalGatherSchedule {
  id: string;
  userId: string;
  campaignId: string;
  cadence: "once" | "daily" | "weekly";
  runAt: string | null;
  timeOfDay: string | null;
  dayOfWeek: number | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalSetting {
  id: string;
  userId: string | null;
  workspaceId: string | null;
  driveFolderId: string | null;
  driveRefreshToken: string | null;
  prefs: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface LocalDeskSession {
  id: string;
  userId: string;
  workspaceId: string;
  activeId: string | null;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface LocalMediaJob {
  id: string;
  userId: string;
  workspaceId: string | null;
  campaignId: string | null;
  sourceContentId: string | null;
  pieceId: string | null;
  hedraGenerationId: string | null;
  hedraAssetId: string | null;
  elevenAudioAssetId: string | null;
  type: "image" | "video" | "avatar_video" | "audio";
  prompt: string | null;
  modelId: string;
  modelName: string | null;
  voiceId: string | null;
  aspectRatio: string | null;
  resolution: string | null;
  duration: number | null;
  status: "queued" | "processing" | "completed" | "failed" | "canceled";
  progress: number | null;
  outputUrl: string | null;
  downloadUrl: string | null;
  thumbnailUrl: string | null;
  creditsEstimate: number | null;
  creditsActual: number | null;
  errorMessage: string | null;
  meta: unknown | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

function rowCampaign(row: any): LocalCampaign {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    name: row.name,
    meta: parseJson<Record<string, unknown> | null>(row.meta_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowReference(row: any): LocalReference {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    doc: parseJson<Record<string, unknown>>(row.doc_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowStyleProfile(row: any): LocalStyleProfile {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    userId: row.user_id,
    knobs: parseJson<StyleKnobs>(row.knobs_json, DEFAULT_KNOBS),
    directive: row.directive ?? "",
    rounds: row.rounds == null ? 0 : Number(row.rounds),
    updatedAt: row.updated_at,
  };
}

function rowStyleFeedback(row: any): LocalStyleFeedback {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    mediaJobId: row.media_job_id,
    rating: row.rating == null ? null : Number(row.rating),
    knobs: parseJson<StyleKnobs | null>(row.knobs_json, null),
    working: row.working,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function rowPiece(row: any): LocalPiece {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    userId: row.user_id,
    title: row.title,
    status: row.status,
    original: row.original ?? "",
    packet: parseJson(row.packet_json, null),
    revision: parseJson(row.revision_json, null),
    outputs: parseJson(row.outputs_json, null),
    outputOrder: parseJson(row.output_order_json, null),
    direction: row.direction,
    gateNotes: parseJson<Record<string, string>>(row.gate_notes_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowSource(row: any): LocalGatherSource {
  return {
    id: row.id,
    userId: row.user_id,
    campaignId: row.campaign_id,
    kind: row.kind,
    config: row.config ?? "",
    label: row.label,
    enabled: Boolean(row.enabled),
    lastRun: row.last_run,
    lastCount: row.last_count == null ? null : Number(row.last_count),
    summary: row.summary,
    summaryAt: row.summary_at,
    summaryItemCount: row.summary_item_count == null ? null : Number(row.summary_item_count),
    createdAt: row.created_at,
  };
}

function rowItem(row: any): LocalGatherItem {
  return {
    id: row.id,
    userId: row.user_id,
    campaignId: row.campaign_id,
    sourceId: row.source_id,
    kind: row.kind,
    title: row.title,
    source: row.source,
    author: row.author,
    url: row.url,
    publishedAt: row.published_at,
    date: row.published_at,
    snippet: row.snippet,
    transcript: row.transcript,
    raw: parseJson(row.raw_json, null),
    selected: Boolean(row.selected),
    createdAt: row.created_at,
  };
}

function rowSchedule(row: any): LocalGatherSchedule {
  return {
    id: row.id,
    userId: row.user_id,
    campaignId: row.campaign_id,
    cadence: row.cadence,
    runAt: row.run_at,
    timeOfDay: row.time_of_day,
    dayOfWeek: row.day_of_week == null ? null : Number(row.day_of_week),
    enabled: Boolean(row.enabled),
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowSetting(row: any): LocalSetting {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    driveFolderId: row.drive_folder_id,
    driveRefreshToken: row.drive_refresh_token,
    prefs: parseJson<Record<string, unknown>>(row.prefs_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowDeskSession(row: any): LocalDeskSession {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    activeId: row.active_id,
    state: parseJson<Record<string, unknown>>(row.state_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowMediaJob(row: any): LocalMediaJob {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    campaignId: row.campaign_id,
    sourceContentId: row.source_content_id,
    pieceId: row.source_content_id,
    hedraGenerationId: row.hedra_generation_id,
    hedraAssetId: row.hedra_asset_id,
    elevenAudioAssetId: row.eleven_audio_asset_id,
    type: row.type,
    prompt: row.prompt,
    modelId: row.model_id,
    modelName: row.model_name,
    voiceId: row.voice_id,
    aspectRatio: row.aspect_ratio,
    resolution: row.resolution,
    duration: row.duration == null ? null : Number(row.duration),
    status: row.status,
    progress: row.progress == null ? null : Number(row.progress),
    outputUrl: row.output_url,
    downloadUrl: row.download_url,
    thumbnailUrl: row.thumbnail_url,
    creditsEstimate: row.credits_estimate == null ? null : Number(row.credits_estimate),
    creditsActual: row.credits_actual == null ? null : Number(row.credits_actual),
    errorMessage: row.error_message,
    meta: parseJson(row.meta_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function ensureLocalWorkspace(userId = LOCAL_USER_ID): string {
  const db = localDb();
  const tx = db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO local_users (id, display_name) VALUES (?, ?)").run(userId, "Owner");
    db.prepare("INSERT OR IGNORE INTO workspaces (id, name) VALUES (?, ?)").run(LOCAL_WORKSPACE_ID, "My Workspace");
    db.prepare(
      "INSERT OR IGNORE INTO memberships (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)",
    ).run("local-membership", LOCAL_WORKSPACE_ID, userId, "author");

  });
  tx();
  return LOCAL_WORKSPACE_ID;
}

export function listLocalCampaigns(workspaceId = LOCAL_WORKSPACE_ID): LocalCampaign[] {
  ensureLocalWorkspace();
  return localDb()
    .prepare("SELECT * FROM campaigns WHERE workspace_id = ? ORDER BY created_at ASC")
    .all(workspaceId)
    .map(rowCampaign);
}

export function getLocalCampaign(id: string, workspaceId = LOCAL_WORKSPACE_ID): LocalCampaign | null {
  ensureLocalWorkspace();
  const row = localDb()
    .prepare("SELECT * FROM campaigns WHERE id = ? AND workspace_id = ?")
    .get(id, workspaceId);
  return row ? rowCampaign(row) : null;
}

export function createLocalCampaign(input: { id?: string; name: string; workspaceId?: string; meta?: Record<string, unknown> | null }): LocalCampaign {
  const workspaceId = input.workspaceId || LOCAL_WORKSPACE_ID;
  ensureLocalWorkspace();
  const db = localDb();
  const base = slug(input.name) || "campaign";
  let candidate = base;
  let i = 2;
  while (db.prepare("SELECT id FROM campaigns WHERE workspace_id = ? AND slug = ?").get(workspaceId, candidate)) {
    candidate = `${base}-${i++}`;
  }
  const campaignId = input.id || randomUUID();
  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO campaigns (id, workspace_id, slug, name, meta_json, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
    ).run(campaignId, workspaceId, candidate, input.name, input.meta ? JSON.stringify(input.meta) : null);
    db.prepare(
      "INSERT INTO references_doc (id, campaign_id, doc_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
    ).run(randomUUID(), campaignId, JSON.stringify(EMPTY_REFERENCES));
  });
  tx();
  return getLocalCampaign(campaignId, workspaceId)!;
}

export function renameLocalCampaign(id: string, name: string, workspaceId = LOCAL_WORKSPACE_ID): LocalCampaign | null {
  ensureLocalWorkspace();
  const result = localDb()
    .prepare("UPDATE campaigns SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?")
    .run(name, id, workspaceId);
  if (!result.changes) return null;
  return getLocalCampaign(id, workspaceId);
}

export function getLocalReferences(campaignId: string, workspaceId = LOCAL_WORKSPACE_ID): LocalReference | null {
  if (!getLocalCampaign(campaignId, workspaceId)) return null;
  const row = localDb().prepare("SELECT * FROM references_doc WHERE campaign_id = ?").get(campaignId);
  return row ? rowReference(row) : null;
}

export function updateLocalReferences(
  campaignId: string,
  input: { doc?: Record<string, unknown>; patch?: Record<string, unknown> },
  workspaceId = LOCAL_WORKSPACE_ID,
): LocalReference | null {
  const existing = getLocalReferences(campaignId, workspaceId);
  if (!existing) return null;
  const next = input.doc !== undefined ? input.doc : { ...existing.doc, ...(input.patch || {}) };
  localDb()
    .prepare("UPDATE references_doc SET doc_json = ?, updated_at = CURRENT_TIMESTAMP WHERE campaign_id = ?")
    .run(JSON.stringify(next), campaignId);
  return getLocalReferences(campaignId, workspaceId);
}

export function getLocalStyleProfile(campaignId: string, workspaceId = LOCAL_WORKSPACE_ID): LocalStyleProfile | null {
  if (!getLocalCampaign(campaignId, workspaceId)) return null;
  const row = localDb().prepare("SELECT * FROM style_profiles WHERE campaign_id = ?").get(campaignId);
  return row ? rowStyleProfile(row) : null;
}

export function upsertLocalStyleProfile(
  input: {
    campaignId: string;
    userId: string;
    knobs: StyleKnobs;
    directive: string;
    rounds: number;
  },
  workspaceId = LOCAL_WORKSPACE_ID,
): LocalStyleProfile | null {
  if (!getLocalCampaign(input.campaignId, workspaceId)) return null;
  const profileId = id("style");
  localDb()
    .prepare(
      `INSERT INTO style_profiles (
        id, campaign_id, user_id, knobs_json, directive, rounds, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(campaign_id) DO UPDATE SET
        user_id = excluded.user_id,
        knobs_json = excluded.knobs_json,
        directive = excluded.directive,
        rounds = excluded.rounds,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .run(profileId, input.campaignId, input.userId, JSON.stringify(input.knobs), input.directive, input.rounds);
  return getLocalStyleProfile(input.campaignId, workspaceId);
}

export function createLocalStyleFeedback(
  input: {
    campaignId: string;
    mediaJobId?: string | null;
    rating?: number | null;
    knobs?: StyleKnobs | null;
    working?: string | null;
    notes?: string | null;
  },
  workspaceId = LOCAL_WORKSPACE_ID,
): LocalStyleFeedback | null {
  if (!getLocalCampaign(input.campaignId, workspaceId)) return null;
  const feedbackId = id("style_feedback");
  localDb()
    .prepare(
      `INSERT INTO style_feedback (
        id, campaign_id, media_job_id, rating, knobs_json, working, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      feedbackId,
      input.campaignId,
      input.mediaJobId ?? null,
      input.rating ?? null,
      input.knobs ? JSON.stringify(input.knobs) : null,
      input.working ?? null,
      input.notes ?? null,
    );
  const row = localDb().prepare("SELECT * FROM style_feedback WHERE id = ?").get(feedbackId);
  return row ? rowStyleFeedback(row) : null;
}

export function listLocalStyleFeedback(campaignId: string, workspaceId = LOCAL_WORKSPACE_ID): LocalStyleFeedback[] | null {
  if (!getLocalCampaign(campaignId, workspaceId)) return null;
  return localDb()
    .prepare("SELECT * FROM style_feedback WHERE campaign_id = ? ORDER BY created_at ASC")
    .all(campaignId)
    .map(rowStyleFeedback);
}

export function listLocalPieces(campaignId: string, workspaceId = LOCAL_WORKSPACE_ID): LocalPiece[] | null {
  if (!getLocalCampaign(campaignId, workspaceId)) return null;
  return localDb()
    .prepare("SELECT * FROM pieces WHERE campaign_id = ? ORDER BY created_at DESC")
    .all(campaignId)
    .map(rowPiece);
}

export function createLocalPiece(
  input: { id?: string; campaignId: string; userId: string; title: string; original?: string },
  workspaceId = LOCAL_WORKSPACE_ID,
): LocalPiece | null {
  if (!getLocalCampaign(input.campaignId, workspaceId)) return null;
  const pieceId = input.id || randomUUID();
  localDb()
    .prepare(
      `INSERT INTO pieces (
        id, campaign_id, user_id, title, status, original, gate_notes_json, updated_at
      ) VALUES (?, ?, ?, ?, 'Draft', ?, '{}', CURRENT_TIMESTAMP)`,
    )
    .run(pieceId, input.campaignId, input.userId, input.title, input.original ?? "");
  return getLocalPiece(pieceId, input.userId, workspaceId);
}

export function getLocalPiece(id: string, userId: string, workspaceId = LOCAL_WORKSPACE_ID): LocalPiece | null {
  ensureLocalWorkspace(userId);
  const row = localDb()
    .prepare(
      `SELECT p.*
       FROM pieces p
       JOIN campaigns c ON c.id = p.campaign_id
       WHERE p.id = ? AND p.user_id = ? AND c.workspace_id = ?`,
    )
    .get(id, userId, workspaceId);
  return row ? rowPiece(row) : null;
}

export function updateLocalPiece(
  id: string,
  userId: string,
  patch: Partial<Pick<LocalPiece, "title" | "original" | "status" | "direction" | "packet" | "revision" | "outputs" | "outputOrder">> & { gateNotes?: Record<string, string> },
  workspaceId = LOCAL_WORKSPACE_ID,
): LocalPiece | null {
  const existing = getLocalPiece(id, userId, workspaceId);
  if (!existing) return null;
  const gateNotes = patch.gateNotes !== undefined ? patch.gateNotes : existing.gateNotes;
  localDb()
    .prepare(
      `UPDATE pieces
       SET title = ?,
           original = ?,
           status = ?,
           direction = ?,
           packet_json = ?,
           revision_json = ?,
           outputs_json = ?,
           output_order_json = ?,
           gate_notes_json = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      patch.title ?? existing.title,
      patch.original ?? existing.original,
      patch.status ?? existing.status,
      patch.direction ?? existing.direction,
      JSON.stringify(patch.packet !== undefined ? patch.packet : existing.packet),
      JSON.stringify(patch.revision !== undefined ? patch.revision : existing.revision),
      JSON.stringify(patch.outputs !== undefined ? patch.outputs : existing.outputs),
      JSON.stringify(patch.outputOrder !== undefined ? patch.outputOrder : existing.outputOrder),
      JSON.stringify(gateNotes),
      id,
      userId,
    );
  return getLocalPiece(id, userId, workspaceId);
}

export function deleteLocalPiece(id: string, userId: string, workspaceId = LOCAL_WORKSPACE_ID): boolean {
  const existing = getLocalPiece(id, userId, workspaceId);
  if (!existing) return false;
  const result = localDb().prepare("DELETE FROM pieces WHERE id = ? AND user_id = ?").run(id, userId);
  return result.changes > 0;
}

export function listLocalGatherSources(campaignId: string, userId = LOCAL_USER_ID, workspaceId = LOCAL_WORKSPACE_ID): LocalGatherSource[] | null {
  if (!getLocalCampaign(campaignId, workspaceId)) return null;
  return localDb()
    .prepare("SELECT * FROM gather_sources WHERE campaign_id = ? AND user_id = ? ORDER BY created_at DESC")
    .all(campaignId, userId)
    .map(rowSource);
}

export function getLocalGatherSource(id: string, userId = LOCAL_USER_ID): LocalGatherSource | null {
  ensureLocalWorkspace(userId);
  const row = localDb().prepare("SELECT * FROM gather_sources WHERE id = ? AND user_id = ?").get(id, userId);
  return row ? rowSource(row) : null;
}

export function createLocalGatherSource(
  input: {
    id?: string;
    campaignId: string;
    kind: LocalGatherSource["kind"];
    config?: string;
    label?: string | null;
    enabled?: boolean;
  },
  userId = LOCAL_USER_ID,
  workspaceId = LOCAL_WORKSPACE_ID,
): LocalGatherSource | null {
  if (!getLocalCampaign(input.campaignId, workspaceId)) return null;
  const sourceId = input.id || randomUUID();
  localDb()
    .prepare(
      `INSERT INTO gather_sources (
        id, user_id, campaign_id, kind, config, label, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sourceId,
      userId,
      input.campaignId,
      input.kind,
      input.config ?? "",
      input.label ?? null,
      input.enabled === false ? 0 : 1,
    );
  return getLocalGatherSource(sourceId, userId);
}

export function updateLocalGatherSource(
  id: string,
  userId: string,
  patch: Partial<Pick<LocalGatherSource, "config" | "label" | "enabled" | "lastRun" | "lastCount" | "summary" | "summaryAt" | "summaryItemCount">>,
): LocalGatherSource | null {
  const existing = getLocalGatherSource(id, userId);
  if (!existing) return null;
  localDb()
    .prepare(
      `UPDATE gather_sources
       SET config = ?,
           label = ?,
           enabled = ?,
           last_run = ?,
           last_count = ?,
           summary = ?,
           summary_at = ?,
           summary_item_count = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      patch.config ?? existing.config,
      patch.label !== undefined ? patch.label : existing.label,
      patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
      patch.lastRun !== undefined ? patch.lastRun : existing.lastRun,
      patch.lastCount !== undefined ? patch.lastCount : existing.lastCount,
      patch.summary !== undefined ? patch.summary : existing.summary,
      patch.summaryAt !== undefined ? patch.summaryAt : existing.summaryAt,
      patch.summaryItemCount !== undefined ? patch.summaryItemCount : existing.summaryItemCount,
      id,
      userId,
    );
  return getLocalGatherSource(id, userId);
}

export function deleteLocalGatherSource(id: string, userId = LOCAL_USER_ID): boolean {
  ensureLocalWorkspace(userId);
  const result = localDb().prepare("DELETE FROM gather_sources WHERE id = ? AND user_id = ?").run(id, userId);
  return result.changes > 0;
}

export function listLocalGatherItems(campaignId: string, userId = LOCAL_USER_ID, workspaceId = LOCAL_WORKSPACE_ID): LocalGatherItem[] | null {
  if (!getLocalCampaign(campaignId, workspaceId)) return null;
  return localDb()
    .prepare("SELECT * FROM gather_items WHERE campaign_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 300")
    .all(campaignId, userId)
    .map(rowItem);
}

export function createLocalGatherItem(
  input: {
    id?: string;
    campaignId: string;
    sourceId?: string | null;
    kind: LocalGatherItem["kind"];
    title: string;
    source?: string | null;
    author?: string | null;
    url?: string | null;
    publishedAt?: string | null;
    snippet?: string | null;
    transcript?: string | null;
    raw?: unknown | null;
  },
  userId = LOCAL_USER_ID,
  workspaceId = LOCAL_WORKSPACE_ID,
): LocalGatherItem | null {
  if (!getLocalCampaign(input.campaignId, workspaceId)) return null;
  const itemId = input.id || randomUUID();
  localDb()
    .prepare(
      `INSERT INTO gather_items (
        id, user_id, campaign_id, source_id, kind, title, source, author, url,
        published_at, snippet, transcript, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      itemId,
      userId,
      input.campaignId,
      input.sourceId ?? null,
      input.kind,
      input.title,
      input.source ?? null,
      input.author ?? null,
      input.url ?? null,
      input.publishedAt ?? null,
      input.snippet ?? null,
      input.transcript ?? null,
      input.raw === undefined || input.raw === null ? null : JSON.stringify(input.raw),
    );
  const row = localDb().prepare("SELECT * FROM gather_items WHERE id = ? AND user_id = ?").get(itemId, userId);
  return row ? rowItem(row) : null;
}

export function deleteLocalGatherItem(id: string, userId = LOCAL_USER_ID): boolean {
  ensureLocalWorkspace(userId);
  const result = localDb().prepare("DELETE FROM gather_items WHERE id = ? AND user_id = ?").run(id, userId);
  return result.changes > 0;
}

export function deleteLocalGatherItemsForCampaign(campaignId: string, userId = LOCAL_USER_ID): number {
  ensureLocalWorkspace(userId);
  const result = localDb().prepare("DELETE FROM gather_items WHERE campaign_id = ? AND user_id = ?").run(campaignId, userId);
  return result.changes;
}

export function existingLocalGatherItemUrls(campaignId: string, userId = LOCAL_USER_ID): Set<string> {
  ensureLocalWorkspace(userId);
  return new Set(
    (localDb().prepare("SELECT url FROM gather_items WHERE campaign_id = ? AND user_id = ?").all(campaignId, userId) as any[])
      .map((row) => row.url ?? "")
      .filter(Boolean),
  );
}

export function listLocalGatherSchedules(campaignId: string, userId = LOCAL_USER_ID): LocalGatherSchedule[] {
  ensureLocalWorkspace(userId);
  return localDb()
    .prepare("SELECT * FROM gather_schedules WHERE campaign_id = ? AND user_id = ? ORDER BY created_at ASC")
    .all(campaignId, userId)
    .map(rowSchedule);
}

export function listEnabledLocalGatherSchedules(userId = LOCAL_USER_ID): LocalGatherSchedule[] {
  ensureLocalWorkspace(userId);
  return localDb()
    .prepare("SELECT * FROM gather_schedules WHERE user_id = ? AND enabled = 1 ORDER BY created_at ASC")
    .all(userId)
    .map(rowSchedule);
}

export interface SaveLocalGatherScheduleInput {
  id?: string;
  campaignId: string;
  cadence: "once" | "daily" | "weekly";
  runAt?: string | null;
  timeOfDay?: string | null;
  dayOfWeek?: number | null;
  enabled?: boolean;
}

export function saveLocalGatherSchedule(
  input: SaveLocalGatherScheduleInput,
  userId = LOCAL_USER_ID,
): LocalGatherSchedule {
  ensureLocalWorkspace(userId);
  const scheduleId = input.id || id("sched");
  const enabled = input.enabled === false ? 0 : 1;
  localDb()
    .prepare(
      `INSERT INTO gather_schedules (
        id, user_id, campaign_id, cadence, run_at, time_of_day, day_of_week, enabled, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        campaign_id = excluded.campaign_id,
        cadence = excluded.cadence,
        run_at = excluded.run_at,
        time_of_day = excluded.time_of_day,
        day_of_week = excluded.day_of_week,
        enabled = excluded.enabled,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .run(
      scheduleId,
      userId,
      input.campaignId,
      input.cadence,
      input.runAt ?? null,
      input.timeOfDay ?? null,
      input.dayOfWeek ?? null,
      enabled,
    );
  const row = localDb().prepare("SELECT * FROM gather_schedules WHERE id = ? AND user_id = ?").get(scheduleId, userId);
  return rowSchedule(row);
}

export function deleteLocalGatherSchedule(id: string, userId = LOCAL_USER_ID): boolean {
  ensureLocalWorkspace(userId);
  const result = localDb().prepare("DELETE FROM gather_schedules WHERE id = ? AND user_id = ?").run(id, userId);
  return result.changes > 0;
}

export function markLocalGatherScheduleRun(
  id: string,
  status: string,
  userId = LOCAL_USER_ID,
  disable = false,
): void {
  localDb()
    .prepare(
      `UPDATE gather_schedules
       SET last_run_at = CURRENT_TIMESTAMP,
           last_status = ?,
           enabled = CASE WHEN ? THEN 0 ELSE enabled END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    )
    .run(status, disable ? 1 : 0, id, userId);
}

export function getOrCreateLocalSettings(
  userId = LOCAL_USER_ID,
  workspaceId = LOCAL_WORKSPACE_ID,
): LocalSetting {
  ensureLocalWorkspace(userId);
  const db = localDb();
  const existing = db
    .prepare("SELECT * FROM settings WHERE user_id = ? AND workspace_id = ? LIMIT 1")
    .get(userId, workspaceId);
  if (existing) return rowSetting(existing);

  const settingsId = randomUUID();
  db.prepare(
    `INSERT INTO settings (id, user_id, workspace_id, prefs_json, updated_at)
     VALUES (?, ?, ?, '{}', CURRENT_TIMESTAMP)`,
  ).run(settingsId, userId, workspaceId);
  return rowSetting(db.prepare("SELECT * FROM settings WHERE id = ?").get(settingsId));
}

export function updateLocalSettings(
  userId: string,
  workspaceId: string,
  patch: { driveFolderId?: string | null; driveRefreshToken?: string | null; prefs?: Record<string, unknown> },
): LocalSetting {
  const existing = getOrCreateLocalSettings(userId, workspaceId);
  localDb()
    .prepare(
      `UPDATE settings
       SET drive_folder_id = ?, drive_refresh_token = ?, prefs_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .run(
      patch.driveFolderId !== undefined ? patch.driveFolderId : existing.driveFolderId,
      patch.driveRefreshToken !== undefined ? patch.driveRefreshToken : existing.driveRefreshToken,
      JSON.stringify(patch.prefs !== undefined ? patch.prefs : existing.prefs),
      existing.id,
    );
  return rowSetting(localDb().prepare("SELECT * FROM settings WHERE id = ?").get(existing.id));
}

export function getLocalDeskSession(
  userId = LOCAL_USER_ID,
  workspaceId = LOCAL_WORKSPACE_ID,
): LocalDeskSession {
  ensureLocalWorkspace(userId);
  const db = localDb();
  const existing = db
    .prepare("SELECT * FROM desk_sessions WHERE user_id = ? AND workspace_id = ? LIMIT 1")
    .get(userId, workspaceId);
  if (existing) return rowDeskSession(existing);

  const sessionId = randomUUID();
  db.prepare(
    `INSERT INTO desk_sessions (id, user_id, workspace_id, state_json, updated_at)
     VALUES (?, ?, ?, '{}', CURRENT_TIMESTAMP)`,
  ).run(sessionId, userId, workspaceId);
  return rowDeskSession(db.prepare("SELECT * FROM desk_sessions WHERE id = ?").get(sessionId));
}

export function updateLocalDeskSession(
  userId: string,
  workspaceId: string,
  input: { activeId?: string | null; state: Record<string, unknown> },
): LocalDeskSession {
  const existing = getLocalDeskSession(userId, workspaceId);
  localDb()
    .prepare(
      `UPDATE desk_sessions
       SET active_id = ?, state_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .run(
      input.activeId !== undefined ? input.activeId : existing.activeId,
      JSON.stringify(input.state),
      existing.id,
    );
  return rowDeskSession(localDb().prepare("SELECT * FROM desk_sessions WHERE id = ?").get(existing.id));
}

export function listLocalMediaJobs(
  userId = LOCAL_USER_ID,
  pieceId?: string | null,
): LocalMediaJob[] {
  ensureLocalWorkspace(userId);
  const sql = pieceId
    ? "SELECT * FROM media_jobs WHERE user_id = ? AND source_content_id = ? ORDER BY created_at DESC LIMIT 200"
    : "SELECT * FROM media_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 200";
  const rows = pieceId
    ? localDb().prepare(sql).all(userId, pieceId)
    : localDb().prepare(sql).all(userId);
  return rows.map(rowMediaJob);
}

export function getLocalMediaJob(id: string, userId = LOCAL_USER_ID): LocalMediaJob | null {
  ensureLocalWorkspace(userId);
  const row = localDb().prepare("SELECT * FROM media_jobs WHERE id = ? AND user_id = ?").get(id, userId);
  return row ? rowMediaJob(row) : null;
}

export function createLocalMediaJob(
  input: Partial<LocalMediaJob> & Pick<LocalMediaJob, "userId" | "type" | "modelId">,
): LocalMediaJob {
  ensureLocalWorkspace(input.userId);
  const mediaId = input.id || randomUUID();
  localDb()
    .prepare(
      `INSERT INTO media_jobs (
        id, user_id, workspace_id, campaign_id, source_content_id,
        hedra_generation_id, hedra_asset_id, eleven_audio_asset_id,
        type, prompt, model_id, model_name, voice_id, aspect_ratio, resolution,
        duration, status, progress, output_url, download_url, thumbnail_url,
        credits_estimate, credits_actual, error_message, meta_json, completed_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .run(
      mediaId,
      input.userId,
      input.workspaceId ?? null,
      input.campaignId ?? null,
      input.sourceContentId ?? input.pieceId ?? null,
      input.hedraGenerationId ?? null,
      input.hedraAssetId ?? null,
      input.elevenAudioAssetId ?? null,
      input.type,
      input.prompt ?? null,
      input.modelId,
      input.modelName ?? null,
      input.voiceId ?? null,
      input.aspectRatio ?? null,
      input.resolution ?? null,
      input.duration ?? null,
      input.status ?? "queued",
      input.progress ?? 0,
      input.outputUrl ?? null,
      input.downloadUrl ?? null,
      input.thumbnailUrl ?? null,
      input.creditsEstimate ?? null,
      input.creditsActual ?? null,
      input.errorMessage ?? null,
      input.meta === undefined || input.meta === null ? null : JSON.stringify(input.meta),
      input.completedAt ?? null,
    );
  return getLocalMediaJob(mediaId, input.userId)!;
}

export function updateLocalMediaJob(
  id: string,
  userId: string,
  patch: Partial<LocalMediaJob>,
): LocalMediaJob | null {
  const existing = getLocalMediaJob(id, userId);
  if (!existing) return null;
  localDb()
    .prepare(
      `UPDATE media_jobs
       SET source_content_id = ?,
           status = ?,
           progress = ?,
           output_url = ?,
           download_url = ?,
           thumbnail_url = ?,
           hedra_asset_id = ?,
           error_message = ?,
           credits_actual = ?,
           meta_json = ?,
           completed_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      patch.sourceContentId !== undefined ? patch.sourceContentId : patch.pieceId !== undefined ? patch.pieceId : existing.sourceContentId,
      patch.status ?? existing.status,
      patch.progress ?? existing.progress,
      patch.outputUrl !== undefined ? patch.outputUrl : existing.outputUrl,
      patch.downloadUrl !== undefined ? patch.downloadUrl : existing.downloadUrl,
      patch.thumbnailUrl !== undefined ? patch.thumbnailUrl : existing.thumbnailUrl,
      patch.hedraAssetId !== undefined ? patch.hedraAssetId : existing.hedraAssetId,
      patch.errorMessage !== undefined ? patch.errorMessage : existing.errorMessage,
      patch.creditsActual !== undefined ? patch.creditsActual : existing.creditsActual,
      patch.meta !== undefined ? JSON.stringify(patch.meta) : JSON.stringify(existing.meta),
      patch.completedAt !== undefined ? patch.completedAt : existing.completedAt,
      id,
      userId,
    );
  return getLocalMediaJob(id, userId);
}

export function deleteLocalMediaJob(id: string, userId = LOCAL_USER_ID): boolean {
  ensureLocalWorkspace(userId);
  const result = localDb().prepare("DELETE FROM media_jobs WHERE id = ? AND user_id = ?").run(id, userId);
  return result.changes > 0;
}

export function localDatabaseExists(): boolean {
  return existsSync(localDatabasePath());
}

export function resetLocalDbForTests(): void {
  singleton?.close();
  singleton = null;
}
