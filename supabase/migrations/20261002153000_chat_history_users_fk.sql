-- Ask Prana conversations belong to public.users, the account created after
-- MSG91 verification. chat_sessions previously referenced the unused
-- app_users table, so a logged-in user could not own a conversation.
-- Auth sessions stay in public.user_sessions. This does not create
-- ask_prana_sessions and does not use Supabase Auth.

alter table public.chat_messages drop constraint if exists chat_messages_user_id_fkey;
alter table public.chat_sessions drop constraint if exists chat_sessions_user_id_fkey;

alter table public.chat_sessions
  add constraint chat_sessions_user_id_fkey
  foreign key (user_id) references public.users(id) on delete cascade;

alter table public.chat_messages
  add constraint chat_messages_user_id_fkey
  foreign key (user_id) references public.users(id) on delete cascade;

notify pgrst, 'reload schema';
