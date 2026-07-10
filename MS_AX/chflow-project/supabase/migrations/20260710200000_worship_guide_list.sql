-- ─────────────────────────────────────────────────────────────────
-- 예배안내 저장본 목록 조회 — 지난 주 안내와 비교·열람용
--  - message 가 있는 저장본만 (로테이션 앵커 시드처럼 message 없는 행은 제외)
--  - 접근: worship_guide_get 과 동일 (dept_mgmt_grade_ok 'dept/worship-guide')
-- ─────────────────────────────────────────────────────────────────

drop function if exists public.worship_guide_list(uuid, int);
create function public.worship_guide_list(p_dept_id uuid, p_limit int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_items jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if not public.dept_mgmt_grade_ok(p_dept_id, 'dept/worship-guide') then
    raise exception '예배안내 접근 권한이 없습니다 (전도사·부장만 가능)';
  end if;

  select coalesce(jsonb_agg(to_jsonb(g) order by g.sunday_date desc), '[]'::jsonb)
  into v_items
  from (
    select w.sunday_date, w.fields, w.message, w.updated_at
    from public.dept_worship_guides w
    where w.department_id = p_dept_id
      and w.message is not null
      and length(trim(w.message)) > 0
    order by w.sunday_date desc
    limit greatest(1, least(coalesce(p_limit, 30), 100))
  ) g;

  return v_items;
end;
$$;
grant execute on function public.worship_guide_list(uuid, int) to authenticated;
