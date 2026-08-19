ALTER TABLE chat_profiles ADD COLUMN gender TEXT NOT NULL DEFAULT '공개 안 함';
ALTER TABLE chat_profiles ADD COLUMN age_band TEXT NOT NULL DEFAULT '공개 안 함';
ALTER TABLE chat_profiles ADD COLUMN region TEXT NOT NULL DEFAULT '공개 안 함';
ALTER TABLE chat_profiles ADD COLUMN job TEXT NOT NULL DEFAULT '공개 안 함';
ALTER TABLE chat_profiles ADD COLUMN introduction TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_profiles ADD COLUMN photo_key TEXT;
ALTER TABLE chat_profiles ADD COLUMN photo_content_type TEXT;
ALTER TABLE chat_profiles ADD COLUMN is_discoverable INTEGER NOT NULL DEFAULT 1;
ALTER TABLE chat_profiles ADD COLUMN is_test_profile INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_profiles ADD COLUMN created_by TEXT;

ALTER TABLE random_matches ADD COLUMN target_user_id TEXT;
ALTER TABLE random_matches ADD COLUMN mode TEXT NOT NULL DEFAULT 'managed';
ALTER TABLE random_matches ADD COLUMN last_message_at TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_profiles_discoverable
  ON chat_profiles(is_discoverable, is_test_profile, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_random_matches_target
  ON random_matches(target_user_id, status, last_message_at DESC);

PRAGMA optimize;
