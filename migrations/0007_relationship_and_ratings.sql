ALTER TABLE random_matches ADD COLUMN relationship_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE random_matches ADD COLUMN relationship_level INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS chat_ratings (
  match_id TEXT NOT NULL,
  rater_id TEXT NOT NULL,
  rated_user_id TEXT,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (match_id, rater_id),
  FOREIGN KEY (match_id) REFERENCES random_matches(id) ON DELETE CASCADE,
  FOREIGN KEY (rater_id) REFERENCES users(id),
  FOREIGN KEY (rated_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_chat_ratings_rated_user
  ON chat_ratings(rated_user_id, updated_at DESC);

PRAGMA optimize;
