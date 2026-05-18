alter table public.members
  add column if not exists home_phone text;

create index if not exists idx_members_home_phone
  on public.members (home_phone)
  where home_phone is not null;

create table if not exists public.member_phone_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'mdb_home_phone_cleanup',
  target_count integer not null default 0,
  moved_from_phone_count integer not null default 0,
  filled_from_mdb_count integer not null default 0,
  skipped_conflict_count integer not null default 0,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.member_phone_cleanup_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.member_phone_cleanup_runs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  staging_id bigint references public.staging_members_mdb(id) on delete set null,
  before_phone text,
  before_home_phone text,
  after_phone text,
  after_home_phone text,
  source_phone text,
  action text not null,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.member_phone_cleanup_runs enable row level security;
alter table public.member_phone_cleanup_items enable row level security;

drop policy if exists "Admins can read member phone cleanup runs" on public.member_phone_cleanup_runs;
create policy "Admins can read member phone cleanup runs"
  on public.member_phone_cleanup_runs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'office', 'pastor')
    )
  );

drop policy if exists "Admins can read member phone cleanup items" on public.member_phone_cleanup_items;
create policy "Admins can read member phone cleanup items"
  on public.member_phone_cleanup_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'office', 'pastor')
    )
  );

notify pgrst, 'reload schema';
