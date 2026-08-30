-- 반 관리에서 지정한 정담임도 해당 반 학생의 출석·달란트를 수정할 수 있어야 한다.
-- 기존 함수는 학생의 오래된 teacher_id와 부담임만 검사해, 반 관리 연결 후에도 권한이 막힐 수 있었다.
create or replace function public.edu_can_edit_student(p_dept_id uuid, p_student_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_grade smallint;
begin
  v_grade := public.get_user_grade(p_dept_id);
  if v_grade <= 2 then
    return true;
  end if;

  if v_grade = 3 then
    return exists (
      select 1
      from public.edu_teachers t
      join public.edu_students s
        on s.department_id = t.department_id
       and s.id = p_student_id
      left join public.edu_classes c
        on c.department_id = s.department_id
       and c.class_no = s.class_no
      where t.department_id = p_dept_id
        and t.user_id = auth.uid()
        and t.is_active = true
        and s.is_active = true
        and (
          s.teacher_id = t.id
          or c.teacher_id = t.id
          or c.assistant_teacher_id = t.id
        )
    );
  end if;

  return false;
end;
$$;

grant execute on function public.edu_can_edit_student(uuid, uuid) to authenticated;

-- 초등1부 1-1반은 반 관리의 정담임이 이분선 선생님으로 바뀌었지만
-- 학생 2명의 기존 담임값이 이전 담임으로 남아 있어 현재 반 배정과 일치시키는 1회성 보정이다.
update public.edu_students s
set teacher_id = c.teacher_id
from public.edu_classes c
where c.department_id = '882ee0b6-af49-46bb-a077-682a9536cb76'::uuid
  and c.class_no = '1-1'
  and c.teacher_id = '58ecbbed-93c0-4b3e-b2b9-2a5f0eb832b4'::uuid
  and s.department_id = c.department_id
  and s.class_no = c.class_no
  and s.is_active = true
  and s.teacher_id is distinct from c.teacher_id;
