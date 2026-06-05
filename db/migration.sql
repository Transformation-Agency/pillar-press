-- Migration: media_jobs (Hedra / ElevenLabs media generation jobs)
-- Apply with your existing migration tooling (drizzle-kit, etc.).

CREATE TABLE IF NOT EXISTS media_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id               text NOT NULL,
  workspace_id          text,
  campaign_id           text,
  source_content_id     text,

  hedra_generation_id   text,
  hedra_asset_id        text,
  eleven_audio_asset_id text,

  type                  text NOT NULL CHECK (type IN ('image','video','avatar_video','audio')),
  prompt                text,
  model_id              text NOT NULL,
  model_name            text,
  voice_id              text,
  aspect_ratio          text,
  resolution            text,
  duration              integer,

  status                text NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued','processing','completed','failed','canceled')),
  progress              integer DEFAULT 0,

  output_url            text,
  download_url          text,
  thumbnail_url         text,

  credits_estimate      real,
  credits_actual        real,
  error_message         text,
  meta                  jsonb,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz
);

CREATE INDEX IF NOT EXISTS media_jobs_user_idx    ON media_jobs (user_id);
CREATE INDEX IF NOT EXISTS media_jobs_content_idx ON media_jobs (source_content_id);
CREATE INDEX IF NOT EXISTS media_jobs_gen_idx     ON media_jobs (hedra_generation_id);
