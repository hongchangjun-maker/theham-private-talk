-- DEVELOPMENT ONLY. Never run automatically in production.
-- Create auth users through the Supabase Auth Admin API first, then replace the UUIDs below.
-- This file intentionally contains no passwords or production credentials.

insert into public.system_settings (setting_key, setting_value, is_secret)
values
  ('brand', '{"serviceName":"THEHAM PRIVATE TALK","primaryColor":"#21151B","accentColor":"#D71962"}', false),
  ('chat_policy', '{"retentionDays":365,"maxMembers":100,"disappearingMessages":false}', false),
  ('meeting_policy', '{"provider":"realtimekit","maxParticipants":12,"waitingRoom":true,"guestEnabled":false,"recordingEnabled":false}', false)
on conflict (setting_key) do nothing;
