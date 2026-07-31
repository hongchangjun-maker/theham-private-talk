create extension if not exists pgcrypto;

create type public.account_role as enum ('member','super_admin','admin','member_admin','chat_admin','meeting_admin','content_admin','read_only_admin');
create type public.account_status as enum ('pending','active','suspended','rejected','deleted');
create type public.request_status as enum ('pending','accepted','rejected','cancelled');
create type public.room_type as enum ('direct','group','notice','public','private','invite_only','admin');
create type public.member_role as enum ('owner','manager','member','guest');
create type public.meeting_status as enum ('scheduled','waiting','active','ended','cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text unique,
  display_name text not null check (char_length(display_name) between 1 and 80),
  profile_image text,
  organization text,
  position text,
  status_message text check (char_length(status_message) <= 240),
  presence_status text not null default 'offline' check (presence_status in ('online','away','meeting','offline','do_not_disturb')),
  last_seen_at timestamptz,
  role public.account_role not null default 'member',
  account_status public.account_status not null default 'pending',
  storage_limit_bytes bigint not null default 1073741824 check (storage_limit_bytes >= 0),
  can_create_room boolean not null default true,
  can_create_meeting boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invitation_codes (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email_domain text,
  expires_at timestamptz not null,
  max_uses integer not null default 1 check (max_uses > 0),
  use_count integer not null default 0 check (use_count >= 0),
  require_approval boolean not null default true,
  created_by uuid not null references public.profiles(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (sender_id, receiver_id),
  check (sender_id <> receiver_id)
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.profiles(id) on delete cascade,
  user_b_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_a_id <> user_b_id),
  unique (user_a_id, user_b_id)
);

create table public.blocked_users (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  room_type public.room_type not null,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 1000),
  room_image text,
  owner_id uuid not null references public.profiles(id),
  visibility text not null default 'private' check (visibility in ('private','public','invite_only')),
  password_hash text,
  max_members integer not null default 100 check (max_members between 2 and 5000),
  video_enabled boolean not null default true,
  file_enabled boolean not null default true,
  message_retention_days integer check (message_retention_days is null or message_retention_days > 0),
  is_locked boolean not null default false,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role public.member_role not null default 'member',
  notification_setting text not null default 'all' check (notification_setting in ('all','mentions','muted')),
  joined_at timestamptz not null default now(),
  last_read_message_id uuid,
  is_muted boolean not null default false,
  removed_at timestamptz,
  unique (room_id, user_id)
);

create table public.uploaded_files (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.profiles(id),
  room_id uuid references public.chat_rooms(id) on delete cascade,
  original_name text not null,
  storage_key text not null unique,
  mime_type text not null,
  file_size bigint not null check (file_size > 0),
  checksum_sha256 text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  deleted_at timestamptz
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  message_type text not null default 'text' check (message_type in ('text','image','file','audio','system')),
  content text check (content is null or char_length(content) <= 20000),
  reply_to_message_id uuid references public.messages(id) on delete set null,
  file_id uuid references public.uploaded_files(id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (content is not null or file_id is not null)
);

alter table public.chat_room_members add constraint chat_room_members_last_read_fk
  foreign key (last_read_message_id) references public.messages(id) on delete set null;

create table public.message_reads (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create table public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (char_length(reaction) between 1 and 16),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, reaction)
);

create table public.meeting_rooms (
  id uuid primary key default gen_random_uuid(),
  chat_room_id uuid references public.chat_rooms(id) on delete set null,
  provider text not null check (provider in ('realtimekit','livekit','jitsi')),
  provider_room_id text,
  title text not null check (char_length(title) between 1 and 160),
  description text,
  host_id uuid not null references public.profiles(id),
  status public.meeting_status not null default 'scheduled',
  password_hash text,
  waiting_room_enabled boolean not null default true,
  guest_enabled boolean not null default false,
  max_participants integer not null default 12 check (max_participants between 2 and 500),
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meeting_rooms(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  guest_name text,
  participant_role public.member_role not null default 'member',
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  check (user_id is not null or guest_name is not null)
);

create table public.meeting_invites (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meeting_rooms(id) on delete cascade,
  invite_token_hash text not null unique,
  expires_at timestamptz not null,
  max_uses integer not null default 1 check (max_uses > 0),
  use_count integer not null default 0 check (use_count >= 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null,
  related_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id),
  target_type text not null check (target_type in ('user','message','room','meeting','file')),
  target_id uuid not null,
  reason text not null,
  description text,
  status text not null default 'pending' check (status in ('pending','reviewing','resolved','rejected')),
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.system_settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null unique,
  setting_value jsonb not null,
  is_secret boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index profiles_status_idx on public.profiles(account_status, presence_status);
create index friend_requests_receiver_idx on public.friend_requests(receiver_id, status);
create index chat_room_members_user_idx on public.chat_room_members(user_id, removed_at);
create index messages_room_created_idx on public.messages(room_id, created_at desc) where deleted_at is null;
create index uploaded_files_room_idx on public.uploaded_files(room_id, created_at desc) where deleted_at is null;
create index meetings_schedule_idx on public.meeting_rooms(status, scheduled_at);
create index notifications_user_idx on public.notifications(user_id, is_read, created_at desc);
create index reports_status_idx on public.reports(status, created_at);
create index audit_logs_created_idx on public.audit_logs(created_at desc);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger rooms_touch before update on public.chat_rooms for each row execute function public.touch_updated_at();
