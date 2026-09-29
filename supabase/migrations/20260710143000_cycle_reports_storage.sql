-- Storage bucket for cycle report PDFs
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;

-- Authenticated users can read/write their own report files
drop policy if exists "Users can upload own reports" on storage.objects;
create policy "Users can upload own reports"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'reports'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update own reports" on storage.objects;
create policy "Users can update own reports"
on storage.objects for update
to authenticated
using (
  bucket_id = 'reports'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'reports'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can read own reports" on storage.objects;
create policy "Users can read own reports"
on storage.objects for select
to authenticated
using (
  bucket_id = 'reports'
  and (storage.foldername(name))[1] = auth.uid()::text
);
