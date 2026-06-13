-- Editable user manual content.
-- The app still falls back to public/manual/shots/manifest.json when this row is absent.

create table if not exists public.manual_content (
  id text primary key,
  content jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.manual_content enable row level security;

drop policy if exists "manual_content_read_public" on public.manual_content;
create policy "manual_content_read_public"
  on public.manual_content for select
  using (true);

drop policy if exists "manual_content_write_admin" on public.manual_content;
create policy "manual_content_write_admin"
  on public.manual_content for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'office', 'pastor')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'office', 'pastor')
    )
  );

grant select on public.manual_content to anon;
grant select, insert, update, delete on public.manual_content to authenticated;
grant all on public.manual_content to service_role;
