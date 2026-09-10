-- =============================================================
-- 교육일지 반별 집계 — "요람 미연결" 과 "성별 미등록" 을 나눈다
--
-- [문제] 교사 성별은 edu_teachers 자체에 없고 요람(members)에서 읽는다.
--     edu_teachers.member_id → members.gender
--     없으면 edu_teachers.user_id → members.app_user_id → members.gender
--   그런데 교사 명단을 이름만 적어 만든 경우 두 연결이 모두 비어 있다.
--   그 경우도 지금까지 missing_teacher_gender 로 묶여 화면에 "성별 미등록"
--   이라고 떴다. 사실과 다르다 — 요람에는 성별이 등록돼 있는데 교사 레코드가
--   그 사람을 가리키지 못하는 것이다.
--   (실제 사례: 초등1부 2-1반 정다영 교사. edu_teachers.member_id·user_id 가
--    둘 다 null 이고, 요람에는 "정다영 / 서리집사(여) / gender=F" 로 있다.
--    같은 이름이 3명이라 자동 연결도 위험하다.)
--
-- [조치] 두 가지를 갈라 돌려준다.
--     unlinked_teachers      : 요람·앱계정 어디에도 연결되지 않은 교사
--     missing_teacher_gender : 연결은 됐는데 그 요람에 성별이 없는 교사
--   화면이 원인에 맞는 안내를 띄울 수 있게 된다.
--   학생 쪽(missing_student_gender)은 edu_students.gender 를 직접 보므로 그대로 둔다.
-- =============================================================

drop function if exists public.edu_journal_class_rollup(uuid, date);
create function public.edu_journal_class_rollup(p_dept_id uuid, p_date date)
returns table (
  class_no text,
  enrolled int,
  attend int,
  absent int,
  lead int,
  memory int,
  lesson int,
  bible int,
  checked int,
  missing_teacher_gender text[],
  missing_student_gender text[],
  unlinked_teachers text[]
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_edu_member_or_admin(p_dept_id) then
    raise exception '접근 권한이 없습니다';
  end if;

  return query
  with roster as (
    select s.id, s.name, s.class_no, s.teacher_id, coalesce(m.gender, s.gender) as gender
    from public.edu_students s
    left join public.members m on m.id = s.member_id
    where s.department_id = p_dept_id
      and s.is_active = true
  ),
  classes as (
    select x.class_no, x.sort_order
    from (
      select c.class_no, c.sort_order
      from public.edu_classes c
      where c.department_id = p_dept_id
      union
      select r.class_no, 999
      from roster r
      where r.class_no is not null
    ) x
    group by x.class_no, x.sort_order
  ),
  reg as (
    select r.class_no,
      count(*)::int as enrolled,
      coalesce(array_agg(r.name order by r.name) filter (where r.gender not in ('M', 'F') or r.gender is null), array[]::text[]) as missing_gender
    from roster r
    group by r.class_no
  ),
  att as (
    select r.class_no,
      count(a.id)::int as checked,
      count(*) filter (where a.attend_status in ('출', '인'))::int as attend,
      count(*) filter (where a.attend_status = '결')::int as absent,
      count(*) filter (where a.had_lesson)::int as lesson,
      count(*) filter (where a.had_bible)::int as bible
    from roster r
    left join public.edu_student_attendance a
      on a.student_id = r.id and a.attend_date = p_date
    group by r.class_no
  ),
  tal as (
    select r.class_no,
      count(*) filter (where t.pts_evangelism > 0)::int as lead,
      count(*) filter (where t.pts_memory > 0)::int as memory
    from roster r
    join public.edu_talent_records t
      on t.student_id = r.id and t.record_date = p_date
    group by r.class_no
  ),
  class_teacher_links as (
    select c.class_no, c.teacher_id
    from public.edu_classes c
    where c.department_id = p_dept_id and c.teacher_id is not null
    union
    select c.class_no, c.assistant_teacher_id
    from public.edu_classes c
    where c.department_id = p_dept_id and c.assistant_teacher_id is not null
    union
    select r.class_no, r.teacher_id from roster r where r.teacher_id is not null
  ),
  teacher_state as (
    select link.class_no,
      t.name,
      (t.member_id is null and t.user_id is null) as unlinked,
      coalesce(m.gender, user_member.gender) as gender
    from class_teacher_links link
    join public.edu_teachers t on t.id = link.teacher_id and t.is_active = true
    left join public.members m on m.id = t.member_id
    left join lateral (
      select linked.gender from public.members linked
      where linked.app_user_id = t.user_id
      limit 1
    ) user_member on true
  ),
  teacher_missing as (
    select ts.class_no,
      -- 연결은 됐는데 요람에 성별이 없는 경우만 "성별 미등록"
      coalesce(array_agg(ts.name order by ts.name) filter (
        where not ts.unlinked and (ts.gender is null or ts.gender not in ('M', 'F'))
      ), array[]::text[]) as missing_gender_names,
      -- 요람·앱계정 어디에도 안 붙은 경우
      coalesce(array_agg(ts.name order by ts.name) filter (
        where ts.unlinked
      ), array[]::text[]) as unlinked_names
    from teacher_state ts
    group by ts.class_no
  )
  select c.class_no,
    coalesce(reg.enrolled, 0),
    coalesce(att.attend, 0),
    coalesce(att.absent, 0),
    coalesce(tal.lead, 0),
    coalesce(tal.memory, 0),
    coalesce(att.lesson, 0),
    coalesce(att.bible, 0),
    coalesce(att.checked, 0),
    coalesce(teacher_missing.missing_gender_names, array[]::text[]),
    coalesce(reg.missing_gender, array[]::text[]),
    coalesce(teacher_missing.unlinked_names, array[]::text[])
  from classes c
  left join reg on reg.class_no = c.class_no
  left join att on att.class_no = c.class_no
  left join tal on tal.class_no = c.class_no
  left join teacher_missing on teacher_missing.class_no = c.class_no
  order by c.sort_order, c.class_no;
end;
$$;
grant execute on function public.edu_journal_class_rollup(uuid, date) to authenticated;
