PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chat_presence (
  user_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('waiting')),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_presence_state_updated
  ON chat_presence(state, updated_at DESC);

