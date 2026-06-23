-- Align verse-memory delete affordance with actual delete permission.
-- Before: can_delete = (grade <= 2 OR own post) — showed a delete button to grade 3~4
--         authors that the delete RPC then rejected (grade <= 2 only).
-- After:  can_delete = (grade <= 2) — matches create_dept_verse_memory and
--         delete_dept_verse_memory, which both require grade <= 2.

create or replace function public.list_dept_verse_memories(
  p_department_id uuid,
  p_year int default extract(year from current_date)::int
)
returns table (
  id uuid,
  memory_month date,
  title text,
  body text,
  attachments jsonb,
  author_name text,
  author_sub_role text,
  can_delete boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_grade smallint;
  v_dept_name text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;

  select d.name into v_dept_name
  from public.departments d
  where d.id = p_department_id and d.is_active = true;

  if v_dept_name is distinct from '초등1부' then
    raise exception '요절암송 게시판은 초등1부 전용입니다';
  end if;

  v_grade := public.get_user_grade(p_department_id);
  if v_grade is null or v_grade > 4 then
    raise exception '요절암송 자료를 볼 권한이 없습니다';
  end if;

  return query
  select
    vm.id,
    vm.memory_month,
    vm.title,
    vm.body,
    vm.attachments,
    pr.name,
    pr.sub_role,
    (v_grade <= 2),
    vm.created_at,
    vm.updated_at
  from public.dept_verse_memories vm
  left join public.profiles pr on pr.id = vm.author_id
  where vm.department_id = p_department_id
    and vm.deleted_at is null
    and extract(year from vm.memory_month)::int = coalesce(p_year, extract(year from current_date)::int)
  order by vm.memory_month desc, vm.created_at desc;
end;
$$;

grant execute on function public.list_dept_verse_memories(uuid, int) to authenticated;
