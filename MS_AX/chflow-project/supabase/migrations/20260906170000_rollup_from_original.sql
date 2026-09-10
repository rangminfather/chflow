-- =============================================================
-- edu_journal_class_rollup 재수정 — 원본 함수에 최소 변경만 얹는다
--
-- 20260906160000 / 20260906164000 에서 함수를 손으로 옮겨 적다가 두 번 깨뜨렸다.
--   1) 달란트 CTE 에 없는 테이블·컬럼을 적어 실행 자체가 실패
--   2) classes CTE 의 group by 를 (class_no, sort_order) 로 바꿔
--      edu_classes 행과 roster 행이 각각 남아 **반이 두 배로** 나왔다
--      (초등1부 9개 반 → 18줄)
--
-- 이번에는 원본(20260906120000)의 함수 본문을 그대로 가져와
-- 세 군데만 고쳤다.
--   · 반환 컬럼에 unlinked_teachers 추가
--   · teacher_missing CTE 를 teacher_state 로 나눠 "요람 미연결" 과
--     "성별 미등록" 을 구분
--   · 최종 select 에 unlinked_names 추가
-- 나머지 CTE(roster/classes/reg/att/tal)는 원본 그대로다.
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
      and coalesce(trim(s.class_no), '') <> ''
  ),
  classes as (
    select u.class_no, min(u.sort_order) as sort_order
    from (
      select c.class_no, c.sort_order
      from public.edu_classes c
      where c.department_id = p_dept_id
      union all
      select distinct r.class_no, 9999 as sort_order
      from roster r
    ) u
    group by u.class_no
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
