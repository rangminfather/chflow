-- Cached main church bulletin PDFs fetched from ums.or.kr.

alter table public.bulletins
  add column if not exists source_board text default 'jubo',
  add column if not exists source_no integer,
  add column if not exists pdf_path text,
  add column if not exists fetched_at timestamptz;

create unique index if not exists bulletins_source_board_no_uidx
  on public.bulletins (source_board, source_no);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bulletins', 'bulletins', false, 52428800, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "bulletins_storage_read_authenticated" on storage.objects;
create policy "bulletins_storage_read_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'bulletins');

drop policy if exists "bulletins_storage_admin_write" on storage.objects;
create policy "bulletins_storage_admin_write"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'bulletins'
    and public.get_user_role() in ('admin','office')
  )
  with check (
    bucket_id = 'bulletins'
    and public.get_user_role() in ('admin','office')
  );
