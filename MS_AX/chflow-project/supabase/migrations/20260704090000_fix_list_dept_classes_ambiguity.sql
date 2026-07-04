-- list_dept_classes_full: RETURNS TABLE 변수(class_no 등)와 컬럼 충돌로
-- "column reference class_no is ambiguous" 런타임 에러 발생 → 전 참조 한정자 부여.
-- (영향: 예배안내 안내반 자동생성 실패, 반 관리 페이지 목록 실패)

drop function if exists public.list_dept_classes_full(uuid);
create function public.list_dept_classes_full(p_dept_id uuid)
returns table (
  class_no text,
  grade_year smallint,
  label text,
  teacher_id uuid,
  teacher_name text,
  teacher_member_id uuid,
  is_placeholder boolean,
  student_count bigint,
  sort_order int,
  in_registry boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_edu_member_or_admin(p_dept_id) then
    raise exception '접근 권한이 없습니다';
  end if;

  return query
  -- 레지스트리 반
  select
    c.class_no,
    c.grade_year,
    c.label,
    c.teacher_id,
    et.name as teacher_name,
    et.member_id as teacher_member_id,
    (c.teacher_id is not null and et.member_id is null) as is_placeholder,
    coalesce(sc.cnt, 0) as student_count,
    c.sort_order,
    true as in_registry
  from public.edu_classes c
  left join public.edu_teachers et on et.id = c.teacher_id
  left join (
    select st.class_no as cls, count(*) as cnt
    from public.edu_students st
    where st.department_id = p_dept_id and st.is_active = true
      and coalesce(trim(st.class_no), '') <> ''
    group by st.class_no
  ) sc on sc.cls = c.class_no
  where c.department_id = p_dept_id

  union all

  -- 레지스트리에 없는 학생기반 반 (안전망)
  select
    s.class_no,
    max(s.grade_year) as grade_year,
    null::text as label,
    (array_agg(s.teacher_id) filter (where s.teacher_id is not null))[1] as teacher_id,
    (array_agg(et2.name) filter (where et2.name is not null))[1] as teacher_name,
    (array_agg(et2.member_id) filter (where et2.member_id is not null))[1] as teacher_member_id,
    false as is_placeholder,
    count(*) as student_count,
    9999 as sort_order,
    false as in_registry
  from public.edu_students s
  left join public.edu_teachers et2 on et2.id = s.teacher_id
  where s.department_id = p_dept_id and s.is_active = true
    and coalesce(trim(s.class_no), '') <> ''
    and not exists (
      select 1 from public.edu_classes c2
      where c2.department_id = p_dept_id and c2.class_no = s.class_no
    )
  group by s.class_no

  -- RETURNS TABLE 변수와의 충돌을 피하려 위치 기반 정렬 (2=grade_year, 9=sort_order, 1=class_no)
  order by 2 nulls last, 9, 1;
end;
$$;
grant execute on function public.list_dept_classes_full(uuid) to authenticated;

-- 초등1부 1-1반 담임 레지스트리 정정: 실제 담임은 이분선 선생님
-- (edu_students.teacher_id 의 최성헌 임시 배정은 담임메뉴 테스트용이므로 유지)
update public.edu_classes c
set teacher_id = t.id
from public.departments d, public.edu_teachers t
where d.category = '교육사역국' and d.name = '초등1부'
  and c.department_id = d.id and c.class_no = '1-1'
  and t.department_id = d.id and t.name = '이분선' and t.is_active = true;
