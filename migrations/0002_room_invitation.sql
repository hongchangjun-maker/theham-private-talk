ALTER TABLE invitations ADD COLUMN room_id TEXT REFERENCES rooms(id);

CREATE INDEX IF NOT EXISTS invitations_room_idx
  ON invitations(room_id, expires_at);
