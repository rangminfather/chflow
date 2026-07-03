-- ─────────────────────────────────────────────────────────────────
-- 예배안내 (worship guide) — 주일 예배 안내 메시지 생성·공유
--  - 주차별 생성/수정본 저장 (안내·기도 로테이션 앵커 역할 겸용)
--  - 접근: dept_mgmt_grade_ok(dept, 'dept/worship-guide') — 기본 0~1 (전도사·교육사·부장)
--  - fields jsonb 예:
--      { "guideClass":"1-3", "guideNext":"1-2",
--        "prayerClass":"3-3", "prayerNext":"3-1", "prayerFixed":false }
--    guideNext/prayerNext = "다음 주 로테이션 반" (순서 스왑 예외를 명시적으로 담는다)
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.dept_worship_guides (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  sunday_date date not null,
  fields jsonb not null default '{}'::jsonb,
  message text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, sunday_date)
);

-- RPC 전용 접근 (정책 없음 = deny-by-default)
alter table public.dept_worship_guides enable row level security;

-- ───────────────────────── 조회: 해당 주 + 직전 저장분(로테이션 앵커) ─────────────────────────
drop function if exists public.worship_guide_get(uuid, date);
create function public.worship_guide_get(p_dept_id uuid, p_sunday date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_current jsonb;
  v_prev jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if not public.dept_mgmt_grade_ok(p_dept_id, 'dept/worship-guide') then
    raise exception '예배안내 접근 권한이 없습니다 (전도사·부장만 가능)';
  end if;

  select to_jsonb(g) into v_current
  from (
    select w.sunday_date, w.fields, w.message, w.updated_at
    from public.dept_worship_guides w
    where w.department_id = p_dept_id and w.sunday_date = p_sunday
  ) g;

  select to_jsonb(g) into v_prev
  from (
    select w.sunday_date, w.fields, w.message
    from public.dept_worship_guides w
    where w.department_id = p_dept_id and w.sunday_date < p_sunday
    order by w.sunday_date desc
    limit 1
  ) g;

  return jsonb_build_object('current', v_current, 'prev', v_prev);
end;
$$;
grant execute on function public.worship_guide_get(uuid, date) to authenticated;

-- ───────────────────────── 저장 (upsert) ─────────────────────────
drop function if exists public.worship_guide_save(uuid, date, jsonb, text);
create function public.worship_guide_save(
  p_dept_id uuid,
  p_sunday date,
  p_fields jsonb,
  p_message text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if not public.dept_mgmt_grade_ok(p_dept_id, 'dept/worship-guide') then
    raise exception '예배안내 저장 권한이 없습니다 (전도사·부장만 가능)';
  end if;

  insert into public.dept_worship_guides
    (department_id, sunday_date, fields, message, updated_by, updated_at)
  values
    (p_dept_id, p_sunday, coalesce(p_fields, '{}'::jsonb), p_message, auth.uid(), now())
  on conflict (department_id, sunday_date) do update
    set fields = excluded.fields,
        message = excluded.message,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;
grant execute on function public.worship_guide_save(uuid, date, jsonb, text) to authenticated;

-- ───────────────────────── 초등1부 로테이션 앵커 시드 (2026-06-28) ─────────────────────────
-- 실제 순서 반영:
--  · 안내 = 1-3반 → 다음 1-2반 (3-2반은 안내 로테이션 제외)
--  · 기도 = 3-3반. 단 3-2반이 사정상 그 전주(6/21)에 먼저 했으므로 다음 어린이 기도는 3-1반.
--    (7/5 첫째주는 김정권 장로님 고정, 어린이 로테이션은 7/12 = 3-1반부터 재개)
insert into public.dept_worship_guides (department_id, sunday_date, fields, message)
select d.id, date '2026-06-28',
  jsonb_build_object(
    'guideClass', '1-3',
    'guideNext',  '1-2',
    'prayerClass', '3-3',
    'prayerNext',  '3-1',
    'prayerFixed', false,
    'seed', true
  ),
  null
from public.departments d
where d.category = '교육사역국' and d.name = '초등1부'
on conflict (department_id, sunday_date) do nothing;
