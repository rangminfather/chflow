-- ─────────────────────────────────────────────────────────────────
-- 예배안내 (worship schedule) — "예배" 메뉴(app/live)에 표시되는 전체 예배 시간표.
--   - 기존에는 lib/worshipSchedule.ts 의 WORSHIP_GUIDE_TEXT 상수로 하드코딩되어 있었다.
--   - 한 행 = 예배 한 회차(예: "주일예배" 카테고리의 "2부 오전 9:00").
--     같은 category 값을 가진 행들은 화면에서 한 그룹으로 묶여 표시된다.
--     "카테고리 열에 여러 회차 시간을 몰아넣지 않고, 회차마다 행을 하나씩 추가"하는 방식으로
--     회차별 실시간 체크를 독립적으로 관리한다 (열을 3,4,5...로 늘리지 않는다).
--   - 읽기: 로그인 사용자 전체 (기존 상수와 동일하게 전 성도에게 노출)
--   - 쓰기: profiles.role = 'admin' 또는 'office' (교역자·사무실) — home_menu_settings 와 동일한 관례
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.worship_schedule_items (
  id uuid primary key default gen_random_uuid(),
  category text not null,      -- 예배종류 (자유기재, 예: "새벽기도회" · "주일예배" · "수요예배" · "금요기도회")
  time_text text not null,     -- 예배시간 (자유기재, 예: "2부 오전 9:00" · "오후 1:40 (온세대연합예배)")
  is_live boolean not null default false,
  sort_order integer not null default 0,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_worship_schedule_items_sort on public.worship_schedule_items (sort_order);

-- RPC 전용 접근 (직접 테이블 정책 없음 = deny-by-default)
alter table public.worship_schedule_items enable row level security;

-- ───────────────────────── 읽기: 로그인 사용자 전체 ─────────────────────────
create or replace function public.list_worship_schedule()
returns table(id uuid, category text, time_text text, is_live boolean, sort_order integer)
language sql stable security definer set search_path = public
as $$
  select w.id, w.category, w.time_text, w.is_live, w.sort_order
  from public.worship_schedule_items w
  order by w.sort_order asc, w.created_at asc;
$$;
grant execute on function public.list_worship_schedule() to authenticated;

-- ───────────────────────── 추가 ─────────────────────────
create or replace function public.create_worship_schedule_item(
  p_category text,
  p_time_text text,
  p_is_live boolean default false
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_next_order integer;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if public.get_user_role() not in ('admin', 'office') then
    raise exception '예배안내 관리 권한이 없습니다 (관리자·사무실만 가능)';
  end if;
  if coalesce(trim(p_category), '') = '' or coalesce(trim(p_time_text), '') = '' then
    raise exception '예배종류와 예배시간을 입력하세요';
  end if;

  select coalesce(max(sort_order), 0) + 10 into v_next_order from public.worship_schedule_items;

  insert into public.worship_schedule_items (category, time_text, is_live, sort_order, updated_by)
  values (trim(p_category), trim(p_time_text), coalesce(p_is_live, false), v_next_order, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function public.create_worship_schedule_item(text, text, boolean) to authenticated;

-- ───────────────────────── 수정 ─────────────────────────
create or replace function public.update_worship_schedule_item(
  p_id uuid,
  p_category text,
  p_time_text text,
  p_is_live boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if public.get_user_role() not in ('admin', 'office') then
    raise exception '예배안내 관리 권한이 없습니다 (관리자·사무실만 가능)';
  end if;
  if coalesce(trim(p_category), '') = '' or coalesce(trim(p_time_text), '') = '' then
    raise exception '예배종류와 예배시간을 입력하세요';
  end if;

  update public.worship_schedule_items
  set category = trim(p_category),
      time_text = trim(p_time_text),
      is_live = coalesce(p_is_live, false),
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_id;

  if not found then raise exception '해당 예배 시간을 찾을 수 없습니다'; end if;
end;
$$;
grant execute on function public.update_worship_schedule_item(uuid, text, text, boolean) to authenticated;

-- ───────────────────────── 삭제 ─────────────────────────
create or replace function public.delete_worship_schedule_item(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if public.get_user_role() not in ('admin', 'office') then
    raise exception '예배안내 관리 권한이 없습니다 (관리자·사무실만 가능)';
  end if;

  delete from public.worship_schedule_items where id = p_id;
  if not found then raise exception '해당 예배 시간을 찾을 수 없습니다'; end if;
end;
$$;
grant execute on function public.delete_worship_schedule_item(uuid) to authenticated;

-- ───────────────────────── 시드: 기존 WORSHIP_GUIDE_TEXT 상수와 동일한 초기값 ─────────────────────────
insert into public.worship_schedule_items (category, time_text, is_live, sort_order)
values
  ('새벽기도회', '1부 오전 5:00', false, 10),
  ('새벽기도회', '2부 오전 6:00', false, 20),
  ('주일예배', '1부 오전 7:00', false, 30),
  ('주일예배', '2부 오전 9:00', true, 40),
  ('주일예배', '3부 오전 11:00', true, 50),
  ('주일예배', '4부 오후 1:40 (온세대연합예배)', true, 60),
  ('주일예배', '젊은이예배 오후 1:40', true, 70),
  ('수요예배', '1부 오전 10:00', true, 80),
  ('수요예배', '2부 오후 7:30', true, 90),
  ('금요기도회', '오후 11:00', false, 100)
on conflict do nothing;
