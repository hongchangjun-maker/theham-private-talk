alter table public.profiles enable row level security;
alter table public.invitation_codes enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.blocked_users enable row level security;
alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;
alter table public.message_reactions enable row level security;
alter table public.uploaded_files enable row level security;
alter table public.meeting_rooms enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.meeting_invites enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.audit_logs enable row level security;
alter table public.system_settings enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (
  select 1 from public.profiles
  where id = auth.uid()
    and account_status = 'active'
    and role in ('super_admin','admin','member_admin','chat_admin','meeting_admin','content_admin','read_only_admin')
) $$;

create or replace function public.is_room_member(target_room uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (
  select 1 from public.chat_room_members
  where room_id = target_room and user_id = auth.uid() and removed_at is null
) $$;

create or replace function public.can_manage_room(target_room uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.is_admin() or exists (
  select 1 from public.chat_room_members
  where room_id = target_room and user_id = auth.uid() and removed_at is null and member_role in ('owner','manager')
) $$;

create policy profiles_read_active on public.profiles for select to authenticated
  using (account_status = 'active' or id = auth.uid() or public.is_admin());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy friend_requests_parties on public.friend_requests for select to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid() or public.is_admin());
create policy friend_requests_create on public.friend_requests for insert to authenticated
  with check (sender_id = auth.uid());
create policy friend_requests_update_receiver on public.friend_requests for update to authenticated
  using (receiver_id = auth.uid()) with check (receiver_id = auth.uid());

create policy friendships_parties on public.friendships for select to authenticated
  using (user_a_id = auth.uid() or user_b_id = auth.uid() or public.is_admin());
create policy blocks_owner on public.blocked_users for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

create policy rooms_member_read on public.chat_rooms for select to authenticated
  using (public.is_room_member(id) or public.is_admin());
create policy rooms_create on public.chat_rooms for insert to authenticated
  with check (owner_id = auth.uid() and exists(select 1 from public.profiles p where p.id = auth.uid() and p.account_status = 'active' and p.can_create_room));
create policy rooms_manage on public.chat_rooms for update to authenticated
  using (public.can_manage_room(id)) with check (public.can_manage_room(id));

create policy room_members_read on public.chat_room_members for select to authenticated
  using (public.is_room_member(room_id) or public.is_admin());
create policy room_members_manage on public.chat_room_members for all to authenticated
  using (public.can_manage_room(room_id)) with check (public.can_manage_room(room_id));

create policy messages_member_read on public.messages for select to authenticated
  using (public.is_room_member(room_id));
create policy messages_member_create on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_room_member(room_id) and exists(select 1 from public.chat_rooms r where r.id = room_id and r.closed_at is null and not r.is_locked));
create policy messages_owner_update on public.messages for update to authenticated
  using (sender_id = auth.uid() or public.can_manage_room(room_id))
  with check (sender_id = auth.uid() or public.can_manage_room(room_id));

create policy reads_room_member on public.message_reads for select to authenticated
  using (exists(select 1 from public.messages m where m.id = message_id and public.is_room_member(m.room_id)));
create policy reads_self_create on public.message_reads for insert to authenticated with check (user_id = auth.uid());
create policy reactions_room_member on public.message_reactions for select to authenticated
  using (exists(select 1 from public.messages m where m.id = message_id and public.is_room_member(m.room_id)));
create policy reactions_self_write on public.message_reactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy files_room_member_read on public.uploaded_files for select to authenticated
  using ((room_id is not null and public.is_room_member(room_id)) or uploader_id = auth.uid() or public.is_admin());
create policy files_member_create on public.uploaded_files for insert to authenticated
  with check (uploader_id = auth.uid() and (room_id is null or public.is_room_member(room_id)));

create policy meetings_member_read on public.meeting_rooms for select to authenticated
  using (host_id = auth.uid() or (chat_room_id is not null and public.is_room_member(chat_room_id)) or public.is_admin());
create policy meetings_create on public.meeting_rooms for insert to authenticated
  with check (host_id = auth.uid() and exists(select 1 from public.profiles p where p.id = auth.uid() and p.account_status = 'active' and p.can_create_meeting));
create policy meetings_host_manage on public.meeting_rooms for update to authenticated
  using (host_id = auth.uid() or public.is_admin()) with check (host_id = auth.uid() or public.is_admin());
create policy participants_meeting_read on public.meeting_participants for select to authenticated
  using (exists(select 1 from public.meeting_rooms m where m.id = meeting_id and (m.host_id = auth.uid() or (m.chat_room_id is not null and public.is_room_member(m.chat_room_id)) or public.is_admin())));

create policy notifications_owner on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_owner_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy reports_owner_read on public.reports for select to authenticated using (reporter_id = auth.uid() or public.is_admin());
create policy reports_create on public.reports for insert to authenticated with check (reporter_id = auth.uid());

create policy admin_invites on public.invitation_codes for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_meeting_invites on public.meeting_invites for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_audit_read on public.audit_logs for select to authenticated using (public.is_admin());
create policy admin_settings_read on public.system_settings for select to authenticated using (public.is_admin() and not is_secret);
create policy admin_settings_write on public.system_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;
revoke all on public.system_settings from anon;

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_reads;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.notifications;
