-- 임시저장 draft 삭제 RPC

create or replace function bulletin_delete_draft(
  p_dept_id    uuid,
  p_issue_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_edu_member_or_admin(p_dept_id) then
    raise exception 'permission denied';
  end if;
  delete from bulletin_drafts
  where department_id = p_dept_id and issue_date = p_issue_date;
end;
$$;

grant execute on function bulletin_delete_draft(uuid, date) to authenticated;
