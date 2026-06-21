PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS local_users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT 'Owner',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'author' CHECK (role IN ('author', 'assistant')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS references_doc (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
  doc_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS style_profiles (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  knobs_json TEXT NOT NULL DEFAULT '{}',
  directive TEXT NOT NULL DEFAULT '',
  rounds INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS style_feedback (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  media_job_id TEXT,
  rating INTEGER,
  knobs_json TEXT,
  working TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pieces (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft',
  original TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'article',
  category_context_json TEXT NOT NULL DEFAULT '{}',
  packet_json TEXT,
  revision_json TEXT,
  outputs_json TEXT,
  output_order_json TEXT,
  direction TEXT,
  gate_notes_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS letter_recipients (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  sort_name TEXT,
  organization TEXT,
  role TEXT,
  relationship TEXT,
  default_salutation TEXT,
  default_signoff TEXT,
  default_tone TEXT,
  notes TEXT,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS letter_workflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  piece_id TEXT REFERENCES pieces(id) ON DELETE SET NULL,
  recipient_id TEXT REFERENCES letter_recipients(id) ON DELETE SET NULL,
  recipient_snapshot_json TEXT NOT NULL DEFAULT '{}',
  purpose TEXT NOT NULL DEFAULT '',
  desired_outcome TEXT,
  occasion TEXT,
  tone TEXT,
  constraints TEXT,
  source_context TEXT,
  uploads_json TEXT NOT NULL DEFAULT '[]',
  dictation_transcript TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gather_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '',
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run TEXT,
  last_count INTEGER,
  summary TEXT,
  summary_at TEXT,
  summary_item_count INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gather_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES gather_sources(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT,
  author TEXT,
  url TEXT,
  published_at TEXT,
  snippet TEXT,
  transcript TEXT,
  raw_json TEXT,
  selected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gather_schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('once', 'daily', 'weekly')),
  run_at TEXT,
  time_of_day TEXT,
  day_of_week INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  source_content_id TEXT,
  hedra_generation_id TEXT,
  hedra_asset_id TEXT,
  eleven_audio_asset_id TEXT,
  type TEXT NOT NULL,
  prompt TEXT,
  model_id TEXT NOT NULL,
  model_name TEXT,
  voice_id TEXT,
  aspect_ratio TEXT,
  resolution TEXT,
  duration INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER DEFAULT 0,
  output_url TEXT,
  download_url TEXT,
  thumbnail_url TEXT,
  credits_estimate REAL,
  credits_actual REAL,
  error_message TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS desk_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  active_id TEXT,
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  workspace_id TEXT,
  drive_folder_id TEXT,
  drive_refresh_token TEXT,
  prefs_json TEXT NOT NULL DEFAULT '{}',
  llm_provider TEXT NOT NULL DEFAULT 'ollama',
  llm_model TEXT,
  local_storage_path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS campaigns_workspace_idx ON campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);
CREATE INDEX IF NOT EXISTS memberships_workspace_idx ON memberships(workspace_id);
CREATE INDEX IF NOT EXISTS style_feedback_campaign_idx ON style_feedback(campaign_id);
CREATE INDEX IF NOT EXISTS pieces_campaign_idx ON pieces(campaign_id);
CREATE INDEX IF NOT EXISTS letter_recipients_workspace_idx ON letter_recipients(workspace_id, user_id, display_name);
CREATE INDEX IF NOT EXISTS letter_workflows_campaign_idx ON letter_workflows(campaign_id, user_id, updated_at);
CREATE INDEX IF NOT EXISTS gather_sources_campaign_idx ON gather_sources(campaign_id);
CREATE INDEX IF NOT EXISTS gather_items_campaign_idx ON gather_items(campaign_id);
CREATE INDEX IF NOT EXISTS gather_items_url_idx ON gather_items(campaign_id, url);
CREATE INDEX IF NOT EXISTS gather_schedules_campaign_idx ON gather_schedules(campaign_id, user_id, enabled);
CREATE INDEX IF NOT EXISTS desk_sessions_workspace_idx ON desk_sessions(workspace_id, user_id);
