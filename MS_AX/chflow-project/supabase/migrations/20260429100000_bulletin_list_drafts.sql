-- 부서 별 임시저장된 draft 목록 조회 (최근 20개)
-- 사용자가 다른 날짜로 작성중이던 거 이어서 작업하려고 고를 수 있게.

create or replace function bulletin_list_drafts(p_dept_id uuid)
returns table (
  issue_date     date,
  issue_number   text,
  last_edited_by uuid,
  last_edited_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_edu_member_or_admin(p_dept_id) then
    raise exception 'permission denied';
  end if;
  return query
    select b.issue_date, b.issue_number, b.last_edited_by, b.last_edited_at
    from bulletin_drafts b
    where b.department_id = p_dept_id
    order by b.issue_date desc
    limit 20;
end;
$$;

grant execute on function bulletin_list_drafts(uuid) to authenticated;
