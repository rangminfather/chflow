-- ─────────────────────────────────────────────────────────────────
-- 20260914090000_worship_schedule_items.sql 의 list_worship_schedule() 이
-- auth.uid() 로그인 확인 없이 만들어져서, 같은 파일의 나머지 3개 함수
-- (create/update/delete)와 달리 비로그인 상태에서도 호출 가능했다.
-- 원래 의도("읽기: 로그인 사용자 전체")대로 로그인 확인을 추가한다.
-- ─────────────────────────────────────────────────────────────────

create or replace function public.list_worship_schedule()
returns table(id uuid, category text, time_text text, is_live boolean, sort_order integer)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;

  return query
  select w.id, w.category, w.time_text, w.is_live, w.sort_order
  from public.worship_schedule_items w
  order by w.sort_order asc, w.created_at asc;
end;
$$;
grant execute on function public.list_worship_schedule() to authenticated;
