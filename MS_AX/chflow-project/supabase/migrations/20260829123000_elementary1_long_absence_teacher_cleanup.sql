-- 초등1부의 "장기결석" 값은 실제 담임이 아니라 과거 명단에서 생성된
-- 임시 교사 레코드다. 연결 학생은 정식 관리 상태로 전환하고 임시 교사를 제거한다.

do $$
declare
  v_department_id uuid;
  v_teacher_id uuid;
begin
  select d.id
    into v_department_id
  from public.departments d
  where d.name = '초등1부'
  limit 1;

  if v_department_id is null then
    raise exception '초등1부 부서를 찾을 수 없습니다';
  end if;

  select t.id
    into v_teacher_id
  from public.edu_teachers t
  where t.department_id = v_department_id
    and t.name = '장기결석'
    and t.member_id is null
    and t.user_id is null
  limit 1;

  if v_teacher_id is null then
    raise notice '초등1부 장기결석 임시 교사가 없어 정리를 건너뜁니다';
    return;
  end if;

  if exists (
    select 1
    from public.edu_classes c
    where c.teacher_id = v_teacher_id
       or c.assistant_teacher_id = v_teacher_id
  ) then
    raise exception '장기결석 임시 교사가 실제 반에 배정되어 있어 삭제할 수 없습니다';
  end if;

  if exists (
    select 1
    from public.edu_teacher_attendance a
    where a.teacher_id = v_teacher_id
  ) then
    raise exception '장기결석 임시 교사에 출결 기록이 있어 삭제할 수 없습니다';
  end if;

  update public.edu_students s
     set mgmt_status = '장기결석',
         teacher_id = null
   where s.department_id = v_department_id
     and s.teacher_id = v_teacher_id;

  delete from public.edu_teachers t
  where t.id = v_teacher_id
    and t.department_id = v_department_id
    and t.member_id is null
    and t.user_id is null;
end
$$;
