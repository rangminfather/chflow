-- Verified and reviewable scripture readings for a specific church bulletin.
create table if not exists public.bulletin_scripture_readings (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid not null references public.bulletins(id) on delete cascade,
  service_type text not null check (service_type in (
    'sunday_morning', 'sunday_afternoon', 'wednesday_morning', 'wednesday_evening'
  )),
  book_id smallint references public.bible_books(book_id),
  chapter_start smallint,
  verse_start smallint,
  chapter_end smallint,
  verse_end smallint,
  raw_reference text not null default '',
  normalized_label text,
  source text not null check (source in ('manual', 'pdf_text', 'ocr')),
  confidence numeric(4,3) not null default 0 check (confidence >= 0 and confidence <= 1),
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  sort_order smallint not null default 0 check (sort_order >= 0),
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bulletin_id, service_type, sort_order)
);

create index if not exists bulletin_scripture_readings_verified_idx
  on public.bulletin_scripture_readings (bulletin_id, service_type, sort_order)
  where status = 'verified';

alter table public.bulletin_scripture_readings enable row level security;

create policy "bulletin scripture readings verified read"
  on public.bulletin_scripture_readings for select to authenticated
  using (status = 'verified');

create policy "bulletin scripture readings staff read"
  on public.bulletin_scripture_readings for select to authenticated
  using (public.get_user_role() in ('admin', 'office', 'pastor'));

create policy "bulletin scripture readings staff write"
  on public.bulletin_scripture_readings for all to authenticated
  using (public.get_user_role() in ('admin', 'office', 'pastor'))
  with check (public.get_user_role() in ('admin', 'office', 'pastor'));
