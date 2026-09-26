-- 주보 성경봉독 자동 추출(Gemini 이미지 판독) 지원.
--
-- 1) 주일 칸을 1부/2부/3부/오후로 나눈다. 주보에 따라 1부·2·3부·오후 본문이
--    모두 다른 주가 있어(2026-09-20) '주일 오전' 한 칸으로는 표현할 수 없다.
--    기존 sunday_morning 행은 1·2·3부로 복제하고 지운다. 제약에는 배포 전
--    구버전 코드가 잠시 쓸 수 있도록 sunday_morning 을 남겨 둔다.
-- 2) source 에 'ai' 추가.
-- 3) 주보별 자동 추출 상태(재시도 횟수·모델 원본 응답·알림 여부)를 기록하는 표.

alter table public.bulletin_scripture_readings
  drop constraint if exists bulletin_scripture_readings_service_type_check;
alter table public.bulletin_scripture_readings
  add constraint bulletin_scripture_readings_service_type_check check (service_type in (
    'sunday_1', 'sunday_2', 'sunday_3', 'sunday_afternoon',
    'wednesday_morning', 'wednesday_evening',
    'sunday_morning'
  ));

alter table public.bulletin_scripture_readings
  drop constraint if exists bulletin_scripture_readings_source_check;
alter table public.bulletin_scripture_readings
  add constraint bulletin_scripture_readings_source_check
  check (source in ('manual', 'pdf_text', 'ocr', 'ai'));

insert into public.bulletin_scripture_readings (
  bulletin_id, service_type, book_id, chapter_start, verse_start, chapter_end, verse_end,
  raw_reference, normalized_label, source, confidence, status, sort_order,
  verified_at, verified_by, created_at, updated_at
)
select r.bulletin_id, slot.service_type, r.book_id, r.chapter_start, r.verse_start, r.chapter_end, r.verse_end,
       r.raw_reference, r.normalized_label, r.source, r.confidence, r.status, r.sort_order,
       r.verified_at, r.verified_by, r.created_at, now()
from public.bulletin_scripture_readings r
cross join (values ('sunday_1'), ('sunday_2'), ('sunday_3')) as slot(service_type)
where r.service_type = 'sunday_morning'
on conflict (bulletin_id, service_type, sort_order) do nothing;

delete from public.bulletin_scripture_readings where service_type = 'sunday_morning';

create table if not exists public.bulletin_scripture_extractions (
  bulletin_id uuid primary key references public.bulletins(id) on delete cascade,
  status text not null default 'retry' check (status in ('retry', 'done', 'review', 'failed')),
  attempts smallint not null default 0 check (attempts >= 0),
  model_results jsonb not null default '{}'::jsonb,
  last_error text,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bulletin_scripture_extractions enable row level security;

create policy "bulletin scripture extractions staff read"
  on public.bulletin_scripture_extractions for select to authenticated
  using (public.get_user_role() in ('admin', 'office', 'pastor'));

-- 쓰기는 서버(service_role)만 한다.
grant select on table public.bulletin_scripture_extractions to authenticated;
grant all on table public.bulletin_scripture_extractions to service_role;
