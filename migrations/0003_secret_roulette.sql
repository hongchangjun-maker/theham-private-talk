PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chat_profiles (
  user_id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone_last4_hash TEXT NOT NULL,
  phone_last4_salt TEXT NOT NULL,
  phone_last4_iterations INTEGER NOT NULL,
  avatar_id TEXT NOT NULL,
  adult_confirmed_at TEXT NOT NULL,
  terms_accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS random_matches (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL UNIQUE,
  requester_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'operator' CHECK (kind IN ('operator', 'ai')),
  desired_nickname TEXT NOT NULL DEFAULT '',
  desired_gender TEXT NOT NULL DEFAULT '상관없음',
  desired_region TEXT NOT NULL DEFAULT '상관없음',
  desired_age_band TEXT NOT NULL DEFAULT '상관없음',
  desired_job TEXT NOT NULL DEFAULT '상관없음',
  persona_nickname TEXT NOT NULL,
  persona_gender TEXT NOT NULL,
  persona_region TEXT NOT NULL,
  persona_age_band TEXT NOT NULL,
  persona_job TEXT NOT NULL,
  persona_avatar_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended', 'blocked')),
  created_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (operator_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS random_matches_requester_idx
  ON random_matches(requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS random_matches_operator_idx
  ON random_matches(operator_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  FOREIGN KEY (reporter_id) REFERENCES users(id),
  FOREIGN KEY (match_id) REFERENCES random_matches(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS chat_reports_status_idx ON chat_reports(status, created_at DESC);
