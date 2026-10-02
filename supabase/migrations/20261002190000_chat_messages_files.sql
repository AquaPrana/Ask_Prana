alter table public.chat_messages
  add column if not exists message_type text not null default 'text',
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists mime_type text;

alter table public.chat_messages
  drop constraint if exists chat_messages_message_type_check;

alter table public.chat_messages
  add constraint chat_messages_message_type_check
  check (message_type in ('text', 'image', 'document', 'audio'));
