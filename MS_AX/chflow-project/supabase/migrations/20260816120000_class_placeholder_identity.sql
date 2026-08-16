-- =============================================================
-- 반 목록의 placeholder 판정을 교사 identity 규칙과 통일한다.
--
--   수동 등록(placeholder) 교사 = member_id IS NULL AND user_id IS NULL
--
-- 기존 list_dept_classes_full 은 member_id IS NULL 단독으로 판정해서,
-- 성도 연결 없이 계정만 연결된 행(user_id 만 있는 행)을 '계정 미연결'로 잘못
-- 표시할 수 있었다. 정담임(is_placeholder)과 부담임(assistant_is_placeholder)
-- 모두 같은 규칙으로 맞춘다.
--
-- 이 migration 은 위 두 판정식만 바꾼다. 반 담임 정/부 기능의 나머지 로직
-- (반환 컬럼 구성·타입·UNION 분기·정렬·권한 검사·GRANT)은 20260816100000 의
-- 정의를 그대로 유지한다. 기존 migration 파일은 수정하지 않고, 소유자·기존
-- 권한이 보존되도록 DROP 없이 CREATE OR REPLACE 로 교체한다.
-- =============================================================

create or replace function public.list_dept_classes_full(p_dept_id uuid)
returns table (
  class_no text, grade_year smallint, label text,
  teacher_id uuid, teacher_name text, teacher_member_id uuid, is_placeholder boolean,
  assistant_teacher_id uuid, assistant_teacher_name text,
  assistant_teacher_member_id uuid, assistant_is_placeholder boolean,
  student_count bigint, sort_order int, in_registry boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_edu_member_or_admin(p_dept_id) then raise exception '접근 권한이 없습니다'; end if;
  return query
  select c.class_no, c.grade_year, c.label,
    c.teacher_id, pt.name, pt.member_id,
    (c.teacher_id is not null and pt.member_id is null and pt.user_id is null),
    c.assistant_teacher_id, at.name, at.member_id,
    (c.assistant_teacher_id is not null and at.member_id is null and at.user_id is null),
    coalesce(sc.cnt, 0), c.sort_order, true
  from public.edu_classes c
  left join public.edu_teachers pt on pt.id = c.teacher_id
  left join public.edu_teachers at on at.id = c.assistant_teacher_id
  left join (
    select st.class_no cls, count(*) cnt from public.edu_students st
    where st.department_id = p_dept_id and st.is_active = true and coalesce(trim(st.class_no), '') <> ''
    group by st.class_no
  ) sc on sc.cls = c.class_no
  where c.department_id = p_dept_id
  union all
  select s.class_no, max(s.grade_year), null::text,
    (array_agg(s.teacher_id) filter (where s.teacher_id is not null))[1],
    (array_agg(et.name) filter (where et.name is not null))[1],
    (array_agg(et.member_id) filter (where et.member_id is not null))[1], false,
    null::uuid, null::text, null::uuid, false,
    count(*), 9999, false
  from public.edu_students s
  left join public.edu_teachers et on et.id = s.teacher_id
  where s.department_id = p_dept_id and s.is_active = true and coalesce(trim(s.class_no), '') <> ''
    and not exists (select 1 from public.edu_classes c2 where c2.department_id = p_dept_id and c2.class_no = s.class_no)
  group by s.class_no
  order by 2 nulls last, 13, 1;
end;
$$;
grant execute on function public.list_dept_classes_full(uuid) to authenticated;
