ALTER TABLE chat_profiles ADD COLUMN phone_number_hash TEXT;
ALTER TABLE chat_profiles ADD COLUMN login_key_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_profiles_phone_number_hash
  ON chat_profiles(phone_number_hash)
  WHERE phone_number_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_profiles_login_key_hash
  ON chat_profiles(login_key_hash)
  WHERE login_key_hash IS NOT NULL;

PRAGMA optimize;
