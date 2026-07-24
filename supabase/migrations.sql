-- Run this in the Supabase SQL editor before starting the app.

-- ── Videos table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS videos (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id        TEXT        NOT NULL,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  niche         TEXT,
  hook          TEXT,
  voice         TEXT,
  caption_style TEXT,
  video_url     TEXT,
  status        TEXT        DEFAULT 'queued',
  error         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS videos_user_id_idx ON videos (user_id);
CREATE INDEX IF NOT EXISTS videos_job_id_idx  ON videos (job_id);

-- ── User profiles table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  id                     UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan                   TEXT    DEFAULT 'free',
  videos_used_this_month INTEGER DEFAULT 0,
  last_reset_date        DATE    DEFAULT CURRENT_DATE
);

-- ── Atomic increment function ─────────────────────────────────
CREATE OR REPLACE FUNCTION increment_video_count(p_user_id UUID)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
AS $$
  UPDATE user_profiles
  SET videos_used_this_month = videos_used_this_month + 1
  WHERE id = p_user_id;
$$;

-- ── Row-level security ────────────────────────────────────────
-- Backend uses the service role key so RLS is bypassed.
-- Enable RLS for safety but service role bypasses it.
ALTER TABLE videos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
