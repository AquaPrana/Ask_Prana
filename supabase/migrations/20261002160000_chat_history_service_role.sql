-- The Ask Prana edge function uses the service role. These tables were
-- created without SELECT/INSERT/UPDATE/DELETE for that role, so conversation
-- history could not be saved or listed. The browser still has no access.

grant select, insert, update, delete on table public.chat_sessions to service_role;
grant select, insert, update, delete on table public.chat_messages to service_role;
