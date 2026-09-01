-- RSVP 는 "그 목장에 실제로 속한 성도" 만 넣을 수 있어야 한다.
--
-- 발견 경위(2026-09-01 검증): pasture_set_rsvp 가 pasture_can_view() 로만 막고 있었다.
-- pasture_can_view 는 admin·office·pastor 에게 전체 열람을 허용하므로, 관리자가 소속이 아닌
-- 목장의 일정에 응답하면 그 목장 roster 에 없는 member_id 로 응답 행이 생긴다.
-- 참석 집계의 분모는 해당 목장 성인 roster 라서, 이런 행은 어느 칸에도 안 잡히면서
-- 테이블에는 남아 통계를 어긋나게 한다.
--
-- 열람 권한(pasture_can_view)은 그대로 두고, 쓰기에만 소속 조건을 추가한다.
-- 관리자는 계속 모든 목장을 볼 수 있지만 남의 목장에 자기 참석을 넣지는 못한다.

create or replace function public.pasture_set_rsvp(p_schedule_id uuid, p_response text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid := public.pasture_my_member_id();
  v_pid    uuid;
begin
  select pasture_id into v_pid from public.pasture_schedules where id = p_schedule_id;
  if v_pid is null then raise exception '일정을 찾을 수 없습니다'; end if;
  if v_member is null then raise exception '연결된 성도 정보가 없습니다'; end if;
  if p_response not in ('attend','undecided','absent') then
    raise exception '알 수 없는 응답입니다: %', p_response;
  end if;

  -- 소속 확인: 내 성도행이 이 일정의 목장에 실제로 붙어 있어야 한다.
  -- (열람은 pasture_can_view 로 넓게 허용하되, 응답은 소속으로 좁힌다)
  if not exists (
    select 1
      from public.members m
      join public.households h on h.id = m.household_id
     where m.id = v_member
       and h.pasture_id = v_pid
  ) then
    raise exception '이 목장에 소속되어 있지 않아 응답할 수 없습니다';
  end if;

  insert into public.pasture_schedule_rsvps (schedule_id, member_id, response, entered_by)
  values (p_schedule_id, v_member, p_response, auth.uid())
  on conflict (schedule_id, member_id)
  do update set response = excluded.response,
                entered_by = excluded.entered_by,
                responded_at = now();
end;
$$;

revoke all on function public.pasture_set_rsvp(uuid, text) from public, anon;
grant execute on function public.pasture_set_rsvp(uuid, text) to authenticated;
