-- NOTE (added 2026-09-14 during migration-history reconciliation): applied
-- directly to production on 2026-09-09. This file backfills the local
-- migrations folder to match production; do not re-derive or "redo" this —
-- it is already live.

-- 교육일지 주일통계도 반별 집계와 동일하게 요람 미연결 교사와 성별 미등록을 구분한다.
drop function if exists public.edu_journal_sunday_rollup(uuid, date);

create function public.edu_journal_sunday_rollup(p_dept_id uuid, p_date date)
returns table (
  category text,
  male int,
  female int,
  total int,
  missing_gender_names text[],
  unlinked_teacher_names text[]
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_edu_member_or_admin(p_dept_id) then
    raise exception '접근 권한이 없습니다';
  end if;

  return query
  with teachers as (
    select t.id, t.name,
      (t.member_id is null and t.user_id is null) as unlinked,
      coalesce(m.gender, user_member.gender) as gender
    from public.edu_teachers t
    left join public.members m on m.id = t.member_id
    left join lateral (
      select linked.gender from public.members linked
      where linked.app_user_id = t.user_id
      limit 1
    ) user_member on true
    where t.department_id = p_dept_id and t.is_active = true
  ),
  students as (
    select s.id, s.name, s.student_type, coalesce(m.gender, s.gender) as gender
    from public.edu_students s
    left join public.members m on m.id = s.member_id
    where s.department_id = p_dept_id and s.is_active = true
  ),
  present_teachers as (
    select t.* from teachers t
    join public.edu_teacher_attendance a
      on a.teacher_id = t.id and a.attend_date = p_date and a.is_present = true
  ),
  present_students as (
    select s.* from students s
    join public.edu_student_attendance a
      on a.student_id = s.id and a.attend_date = p_date and a.attend_status in ('출', '인')
  )
  select 'teacher'::text,
    count(*) filter (where p.gender = 'M')::int,
    count(*) filter (where p.gender = 'F')::int,
    count(*)::int,
    (select coalesce(array_agg(t.name order by t.name), array[]::text[])
     from teachers t where not t.unlinked and (t.gender not in ('M', 'F') or t.gender is null)),
    (select coalesce(array_agg(t.name order by t.name), array[]::text[])
     from teachers t where t.unlinked)
  from present_teachers p
  union all
  select 'student'::text,
    count(*) filter (where p.gender = 'M')::int,
    count(*) filter (where p.gender = 'F')::int,
    count(*)::int,
    (select coalesce(array_agg(s.name order by s.name), array[]::text[])
     from students s where s.student_type <> '체험' and (s.gender not in ('M', 'F') or s.gender is null)),
    array[]::text[]
  from present_students p where p.student_type <> '체험'
  union all
  select 'new_friend'::text,
    count(*) filter (where p.gender = 'M')::int,
    count(*) filter (where p.gender = 'F')::int,
    count(*)::int,
    (select coalesce(array_agg(s.name order by s.name), array[]::text[])
     from students s where s.student_type = '체험' and (s.gender not in ('M', 'F') or s.gender is null)),
    array[]::text[]
  from present_students p where p.student_type = '체험';
end;
$$;

grant execute on function public.edu_journal_sunday_rollup(uuid, date) to authenticated;
