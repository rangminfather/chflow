-- Bible core data model and RPCs.
-- Runtime reads should come from Supabase; R2 can later hold static chapter JSON/offline packs.

create extension if not exists pg_trgm with schema extensions;
create table if not exists public.bible_versions (
  code text primary key,
  name_ko text not null,
  name_en text,
  language_code text not null default 'ko',
  source_url text,
  copyright_note text,
  is_public_domain boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.bible_books (
  book_id smallint primary key,
  osis_code text not null unique,
  testament text not null check (testament in ('OT', 'NT')),
  book_order smallint not null unique,
  name_ko text not null,
  name_en text not null,
  chapters smallint not null check (chapters > 0),
  short_names text[] not null default '{}'
);
create table if not exists public.bible_book_aliases (
  alias text primary key,
  book_id smallint not null references public.bible_books(book_id) on delete cascade
);
create table if not exists public.bible_verses (
  version_code text not null references public.bible_versions(code) on delete cascade,
  book_id smallint not null references public.bible_books(book_id) on delete cascade,
  chapter smallint not null check (chapter > 0),
  verse smallint not null check (verse > 0),
  text text not null,
  created_at timestamptz not null default now(),
  primary key (version_code, book_id, chapter, verse)
);
create index if not exists idx_bible_verses_chapter
  on public.bible_verses (version_code, book_id, chapter, verse);
create index if not exists idx_bible_verses_text_trgm
  on public.bible_verses using gin (text extensions.gin_trgm_ops);
create table if not exists public.user_bible_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version_code text not null references public.bible_versions(code) on delete cascade,
  book_id smallint not null references public.bible_books(book_id) on delete cascade,
  chapter smallint not null,
  verse smallint,
  label text,
  created_at timestamptz not null default now(),
  unique (user_id, version_code, book_id, chapter, verse)
);
create table if not exists public.user_bible_highlights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version_code text not null references public.bible_versions(code) on delete cascade,
  book_id smallint not null references public.bible_books(book_id) on delete cascade,
  chapter smallint not null,
  verse smallint not null,
  color text not null default 'yellow',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, version_code, book_id, chapter, verse)
);
create table if not exists public.user_bible_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version_code text not null references public.bible_versions(code) on delete cascade,
  book_id smallint not null references public.bible_books(book_id) on delete cascade,
  chapter smallint not null,
  verse smallint,
  note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.user_bible_reading_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  version_code text not null references public.bible_versions(code) on delete cascade,
  book_id smallint not null references public.bible_books(book_id) on delete cascade,
  chapter smallint not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, version_code)
);
alter table public.bible_versions enable row level security;
alter table public.bible_books enable row level security;
alter table public.bible_book_aliases enable row level security;
alter table public.bible_verses enable row level security;
alter table public.user_bible_bookmarks enable row level security;
alter table public.user_bible_highlights enable row level security;
alter table public.user_bible_notes enable row level security;
alter table public.user_bible_reading_progress enable row level security;
drop policy if exists "bible_versions_read_authenticated" on public.bible_versions;
create policy "bible_versions_read_authenticated"
  on public.bible_versions for select
  to authenticated
  using (is_active = true);
drop policy if exists "bible_books_read_authenticated" on public.bible_books;
create policy "bible_books_read_authenticated"
  on public.bible_books for select
  to authenticated
  using (true);
drop policy if exists "bible_book_aliases_read_authenticated" on public.bible_book_aliases;
create policy "bible_book_aliases_read_authenticated"
  on public.bible_book_aliases for select
  to authenticated
  using (true);
drop policy if exists "bible_verses_read_authenticated" on public.bible_verses;
create policy "bible_verses_read_authenticated"
  on public.bible_verses for select
  to authenticated
  using (exists (
    select 1
    from public.bible_versions v
    where v.code = bible_verses.version_code
      and v.is_active = true
  ));
drop policy if exists "user_bible_bookmarks_own" on public.user_bible_bookmarks;
create policy "user_bible_bookmarks_own"
  on public.user_bible_bookmarks for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
drop policy if exists "user_bible_highlights_own" on public.user_bible_highlights;
create policy "user_bible_highlights_own"
  on public.user_bible_highlights for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
drop policy if exists "user_bible_notes_own" on public.user_bible_notes;
create policy "user_bible_notes_own"
  on public.user_bible_notes for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
drop policy if exists "user_bible_reading_progress_own" on public.user_bible_reading_progress;
create policy "user_bible_reading_progress_own"
  on public.user_bible_reading_progress for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
grant select on public.bible_versions, public.bible_books, public.bible_book_aliases, public.bible_verses to authenticated;
grant select, insert, update, delete on public.user_bible_bookmarks, public.user_bible_highlights, public.user_bible_notes, public.user_bible_reading_progress to authenticated;
grant all on public.bible_versions, public.bible_books, public.bible_book_aliases, public.bible_verses to service_role;
grant all on public.user_bible_bookmarks, public.user_bible_highlights, public.user_bible_notes, public.user_bible_reading_progress to service_role;
insert into public.bible_versions (code, name_ko, name_en, language_code, source_url, copyright_note, is_public_domain)
values (
  'KRV',
  '개역한글',
  'Korean Revised Version',
  'ko',
  'https://bolls.life/',
  '개역한글 본문. 저작재산권 보호기간은 지났으나 출처 표기와 본문 동일성 유지를 권장.',
  true
)
on conflict (code) do update
  set name_ko = excluded.name_ko,
      name_en = excluded.name_en,
      language_code = excluded.language_code,
      source_url = excluded.source_url,
      copyright_note = excluded.copyright_note,
      is_public_domain = excluded.is_public_domain,
      is_active = true;
insert into public.bible_books (book_id, osis_code, testament, book_order, name_ko, name_en, chapters, short_names)
values
  (1, 'GEN', 'OT', 1, '창세기', 'Genesis', 50, array['창','창세']),
  (2, 'EXO', 'OT', 2, '출애굽기', 'Exodus', 40, array['출','출애굽']),
  (3, 'LEV', 'OT', 3, '레위기', 'Leviticus', 27, array['레','레위']),
  (4, 'NUM', 'OT', 4, '민수기', 'Numbers', 36, array['민','민수']),
  (5, 'DEU', 'OT', 5, '신명기', 'Deuteronomy', 34, array['신','신명']),
  (6, 'JOS', 'OT', 6, '여호수아', 'Joshua', 24, array['수','여호수아기']),
  (7, 'JDG', 'OT', 7, '사사기', 'Judges', 21, array['삿','사사']),
  (8, 'RUT', 'OT', 8, '룻기', 'Ruth', 4, array['룻']),
  (9, '1SA', 'OT', 9, '사무엘상', '1 Samuel', 31, array['삼상','사무엘상']),
  (10, '2SA', 'OT', 10, '사무엘하', '2 Samuel', 24, array['삼하','사무엘하']),
  (11, '1KI', 'OT', 11, '열왕기상', '1 Kings', 22, array['왕상','열왕상']),
  (12, '2KI', 'OT', 12, '열왕기하', '2 Kings', 25, array['왕하','열왕하']),
  (13, '1CH', 'OT', 13, '역대상', '1 Chronicles', 29, array['대상','역대상']),
  (14, '2CH', 'OT', 14, '역대하', '2 Chronicles', 36, array['대하','역대하']),
  (15, 'EZR', 'OT', 15, '에스라', 'Ezra', 10, array['스','에스라기']),
  (16, 'NEH', 'OT', 16, '느헤미야', 'Nehemiah', 13, array['느','느헤미야기']),
  (17, 'EST', 'OT', 17, '에스더', 'Esther', 10, array['에','에스더기']),
  (18, 'JOB', 'OT', 18, '욥기', 'Job', 42, array['욥']),
  (19, 'PSA', 'OT', 19, '시편', 'Psalms', 150, array['시']),
  (20, 'PRO', 'OT', 20, '잠언', 'Proverbs', 31, array['잠']),
  (21, 'ECC', 'OT', 21, '전도서', 'Ecclesiastes', 12, array['전']),
  (22, 'SNG', 'OT', 22, '아가', 'Song of Songs', 8, array['아']),
  (23, 'ISA', 'OT', 23, '이사야', 'Isaiah', 66, array['사']),
  (24, 'JER', 'OT', 24, '예레미야', 'Jeremiah', 52, array['렘']),
  (25, 'LAM', 'OT', 25, '예레미야애가', 'Lamentations', 5, array['애','예레미야 애가']),
  (26, 'EZK', 'OT', 26, '에스겔', 'Ezekiel', 48, array['겔']),
  (27, 'DAN', 'OT', 27, '다니엘', 'Daniel', 12, array['단']),
  (28, 'HOS', 'OT', 28, '호세아', 'Hosea', 14, array['호']),
  (29, 'JOL', 'OT', 29, '요엘', 'Joel', 3, array['욜']),
  (30, 'AMO', 'OT', 30, '아모스', 'Amos', 9, array['암']),
  (31, 'OBA', 'OT', 31, '오바댜', 'Obadiah', 1, array['옵']),
  (32, 'JON', 'OT', 32, '요나', 'Jonah', 4, array['욘']),
  (33, 'MIC', 'OT', 33, '미가', 'Micah', 7, array['미']),
  (34, 'NAM', 'OT', 34, '나훔', 'Nahum', 3, array['나']),
  (35, 'HAB', 'OT', 35, '하박국', 'Habakkuk', 3, array['합']),
  (36, 'ZEP', 'OT', 36, '스바냐', 'Zephaniah', 3, array['습']),
  (37, 'HAG', 'OT', 37, '학개', 'Haggai', 2, array['학']),
  (38, 'ZEC', 'OT', 38, '스가랴', 'Zechariah', 14, array['슥']),
  (39, 'MAL', 'OT', 39, '말라기', 'Malachi', 4, array['말']),
  (40, 'MAT', 'NT', 40, '마태복음', 'Matthew', 28, array['마','마태','마태복음서']),
  (41, 'MRK', 'NT', 41, '마가복음', 'Mark', 16, array['막','마가','마가복음서']),
  (42, 'LUK', 'NT', 42, '누가복음', 'Luke', 24, array['눅','누가','누가복음서']),
  (43, 'JHN', 'NT', 43, '요한복음', 'John', 21, array['요','요한','요한복음서']),
  (44, 'ACT', 'NT', 44, '사도행전', 'Acts', 28, array['행']),
  (45, 'ROM', 'NT', 45, '로마서', 'Romans', 16, array['롬']),
  (46, '1CO', 'NT', 46, '고린도전서', '1 Corinthians', 16, array['고전']),
  (47, '2CO', 'NT', 47, '고린도후서', '2 Corinthians', 13, array['고후']),
  (48, 'GAL', 'NT', 48, '갈라디아서', 'Galatians', 6, array['갈']),
  (49, 'EPH', 'NT', 49, '에베소서', 'Ephesians', 6, array['엡']),
  (50, 'PHP', 'NT', 50, '빌립보서', 'Philippians', 4, array['빌']),
  (51, 'COL', 'NT', 51, '골로새서', 'Colossians', 4, array['골']),
  (52, '1TH', 'NT', 52, '데살로니가전서', '1 Thessalonians', 5, array['살전']),
  (53, '2TH', 'NT', 53, '데살로니가후서', '2 Thessalonians', 3, array['살후']),
  (54, '1TI', 'NT', 54, '디모데전서', '1 Timothy', 6, array['딤전']),
  (55, '2TI', 'NT', 55, '디모데후서', '2 Timothy', 4, array['딤후']),
  (56, 'TIT', 'NT', 56, '디도서', 'Titus', 3, array['딛']),
  (57, 'PHM', 'NT', 57, '빌레몬서', 'Philemon', 1, array['몬']),
  (58, 'HEB', 'NT', 58, '히브리서', 'Hebrews', 13, array['히']),
  (59, 'JAS', 'NT', 59, '야고보서', 'James', 5, array['약']),
  (60, '1PE', 'NT', 60, '베드로전서', '1 Peter', 5, array['벧전']),
  (61, '2PE', 'NT', 61, '베드로후서', '2 Peter', 3, array['벧후']),
  (62, '1JN', 'NT', 62, '요한일서', '1 John', 5, array['요일','요한1서']),
  (63, '2JN', 'NT', 63, '요한이서', '2 John', 1, array['요이','요한2서']),
  (64, '3JN', 'NT', 64, '요한삼서', '3 John', 1, array['요삼','요한3서']),
  (65, 'JUD', 'NT', 65, '유다서', 'Jude', 1, array['유']),
  (66, 'REV', 'NT', 66, '요한계시록', 'Revelation', 22, array['계','계시록'])
on conflict (book_id) do update
  set osis_code = excluded.osis_code,
      testament = excluded.testament,
      book_order = excluded.book_order,
      name_ko = excluded.name_ko,
      name_en = excluded.name_en,
      chapters = excluded.chapters,
      short_names = excluded.short_names;
insert into public.bible_book_aliases (alias, book_id)
select distinct alias, book_id
from (
  select book_id, unnest(array_append(short_names, name_ko)) as alias
  from public.bible_books
) s
where alias <> ''
on conflict (alias) do update set book_id = excluded.book_id;
create or replace function public.list_bible_versions()
returns table (
  code text,
  name_ko text,
  name_en text,
  language_code text,
  copyright_note text,
  is_public_domain boolean
)
language sql stable security definer set search_path = public
as $$
  select v.code, v.name_ko, v.name_en, v.language_code, v.copyright_note, v.is_public_domain
  from public.bible_versions v
  where v.is_active = true
  order by v.code;
$$;
grant execute on function public.list_bible_versions() to authenticated;
create or replace function public.list_bible_books()
returns table (
  book_id smallint,
  osis_code text,
  testament text,
  book_order smallint,
  name_ko text,
  name_en text,
  chapters smallint,
  short_names text[]
)
language sql stable security definer set search_path = public
as $$
  select b.book_id, b.osis_code, b.testament, b.book_order, b.name_ko, b.name_en, b.chapters, b.short_names
  from public.bible_books b
  order by b.book_order;
$$;
grant execute on function public.list_bible_books() to authenticated;
create or replace function public.get_bible_chapter(
  p_version text,
  p_book_id smallint,
  p_chapter smallint
)
returns table (
  version_code text,
  book_id smallint,
  book_name text,
  osis_code text,
  chapter smallint,
  verse smallint,
  text text
)
language sql stable security definer set search_path = public
as $$
  select v.version_code, v.book_id, b.name_ko, b.osis_code, v.chapter, v.verse, v.text
  from public.bible_verses v
  join public.bible_books b on b.book_id = v.book_id
  join public.bible_versions bv on bv.code = v.version_code and bv.is_active = true
  where v.version_code = upper(coalesce(nullif(trim(p_version), ''), 'KRV'))
    and v.book_id = p_book_id
    and v.chapter = p_chapter
  order by v.verse;
$$;
grant execute on function public.get_bible_chapter(text, smallint, smallint) to authenticated;
create or replace function public.get_bible_passage(
  p_version text,
  p_book_id smallint,
  p_chapter_start smallint,
  p_verse_start smallint default null,
  p_chapter_end smallint default null,
  p_verse_end smallint default null
)
returns table (
  version_code text,
  book_id smallint,
  book_name text,
  osis_code text,
  chapter smallint,
  verse smallint,
  text text
)
language sql stable security definer set search_path = public
as $$
  with bounds as (
    select
      upper(coalesce(nullif(trim(p_version), ''), 'KRV')) as version_code,
      p_book_id as book_id,
      p_chapter_start as chapter_start,
      coalesce(p_verse_start, 1::smallint) as verse_start,
      coalesce(p_chapter_end, p_chapter_start) as chapter_end,
      p_verse_end as verse_end
  )
  select v.version_code, v.book_id, b.name_ko, b.osis_code, v.chapter, v.verse, v.text
  from bounds x
  join public.bible_verses v
    on v.version_code = x.version_code
   and v.book_id = x.book_id
  join public.bible_books b on b.book_id = v.book_id
  join public.bible_versions bv on bv.code = v.version_code and bv.is_active = true
  where (
      (v.chapter > x.chapter_start or (v.chapter = x.chapter_start and v.verse >= x.verse_start))
      and
      (v.chapter < x.chapter_end or (v.chapter = x.chapter_end and (x.verse_end is null or v.verse <= x.verse_end)))
    )
  order by v.chapter, v.verse;
$$;
grant execute on function public.get_bible_passage(text, smallint, smallint, smallint, smallint, smallint) to authenticated;
create or replace function public.parse_bible_reference(p_ref text)
returns table (
  book_id smallint,
  book_name text,
  osis_code text,
  chapter_start smallint,
  verse_start smallint,
  chapter_end smallint,
  verse_end smallint,
  normalized_label text
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_input text := regexp_replace(coalesce(p_ref, ''), '\s+', '', 'g');
  v_alias text;
  v_rest text;
  v_match text[];
  v_book_id smallint;
begin
  v_input := replace(replace(v_input, '：', ':'), '–', '-');
  v_input := replace(v_input, '—', '-');

  select a.book_id, a.alias
    into v_book_id, v_alias
  from public.bible_book_aliases a
  where v_input like a.alias || '%'
  order by length(a.alias) desc
  limit 1;

  if v_book_id is null then
    raise exception '성경 권 이름을 찾을 수 없습니다: %', p_ref;
  end if;

  book_id := v_book_id;

  select b.name_ko, b.osis_code
    into book_name, osis_code
  from public.bible_books b
  where b.book_id = v_book_id;

  v_rest := substring(v_input from length(v_alias) + 1);

  v_match := regexp_match(v_rest, '^([0-9]+):([0-9]+)-([0-9]+):([0-9]+)$');
  if v_match is not null then
    chapter_start := v_match[1]::smallint;
    verse_start := v_match[2]::smallint;
    chapter_end := v_match[3]::smallint;
    verse_end := v_match[4]::smallint;
  else
    v_match := regexp_match(v_rest, '^([0-9]+):([0-9]+)-([0-9]+)$');
    if v_match is not null then
      chapter_start := v_match[1]::smallint;
      verse_start := v_match[2]::smallint;
      chapter_end := chapter_start;
      verse_end := v_match[3]::smallint;
    else
      v_match := regexp_match(v_rest, '^([0-9]+):([0-9]+)$');
      if v_match is not null then
        chapter_start := v_match[1]::smallint;
        verse_start := v_match[2]::smallint;
        chapter_end := chapter_start;
        verse_end := verse_start;
      else
        v_match := regexp_match(v_rest, '^([0-9]+)$');
        if v_match is not null then
          chapter_start := v_match[1]::smallint;
          verse_start := null;
          chapter_end := chapter_start;
          verse_end := null;
        else
          raise exception '성경 구절 형식을 해석할 수 없습니다: %', p_ref;
        end if;
      end if;
    end if;
  end if;

  normalized_label := book_name || ' ' || chapter_start::text ||
    case
      when verse_start is null then ''
      when chapter_end <> chapter_start then ':' || verse_start::text || '-' || chapter_end::text || ':' || verse_end::text
      when verse_end is distinct from verse_start then ':' || verse_start::text || '-' || verse_end::text
      else ':' || verse_start::text
    end;

  return next;
end;
$$;
grant execute on function public.parse_bible_reference(text) to authenticated;
create or replace function public.get_bible_reference(
  p_ref text,
  p_version text default 'KRV'
)
returns table (
  version_code text,
  book_id smallint,
  book_name text,
  osis_code text,
  chapter smallint,
  verse smallint,
  text text,
  normalized_label text
)
language sql stable security definer set search_path = public
as $$
  with parsed as (
    select *
    from public.parse_bible_reference(p_ref)
  )
  select psg.version_code, psg.book_id, psg.book_name, psg.osis_code,
         psg.chapter, psg.verse, psg.text, p.normalized_label
  from parsed p
  join public.get_bible_passage(
    p_version,
    p.book_id,
    p.chapter_start,
    p.verse_start,
    p.chapter_end,
    p.verse_end
  ) psg on true;
$$;
grant execute on function public.get_bible_reference(text, text) to authenticated;
create or replace function public.search_bible(
  p_query text,
  p_version text default 'KRV',
  p_book_id smallint default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  version_code text,
  book_id smallint,
  book_name text,
  osis_code text,
  chapter smallint,
  verse smallint,
  text text,
  label text
)
language sql stable security definer set search_path = public
as $$
  with q as (
    select
      nullif(trim(coalesce(p_query, '')), '') as text,
      upper(coalesce(nullif(trim(p_version), ''), 'KRV')) as version_code,
      greatest(1, least(coalesce(p_limit, 50), 100)) as lim,
      greatest(0, coalesce(p_offset, 0)) as off
  )
  select v.version_code, v.book_id, b.name_ko, b.osis_code, v.chapter, v.verse, v.text,
         b.name_ko || ' ' || v.chapter::text || ':' || v.verse::text as label
  from q
  join public.bible_verses v on v.version_code = q.version_code
  join public.bible_books b on b.book_id = v.book_id
  join public.bible_versions bv on bv.code = v.version_code and bv.is_active = true
  where q.text is not null
    and (p_book_id is null or v.book_id = p_book_id)
    and v.text ilike '%' || q.text || '%'
  order by b.book_order, v.chapter, v.verse
  limit (select lim from q)
  offset (select off from q);
$$;
grant execute on function public.search_bible(text, text, smallint, int, int) to authenticated;
create or replace function public.save_bible_reading_progress(
  p_version text,
  p_book_id smallint,
  p_chapter smallint
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;

  insert into public.user_bible_reading_progress (user_id, version_code, book_id, chapter, updated_at)
  values (auth.uid(), upper(coalesce(nullif(trim(p_version), ''), 'KRV')), p_book_id, p_chapter, now())
  on conflict (user_id, version_code) do update
    set book_id = excluded.book_id,
        chapter = excluded.chapter,
        updated_at = now();
end;
$$;
grant execute on function public.save_bible_reading_progress(text, smallint, smallint) to authenticated;
