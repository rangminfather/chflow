-- 교육일지 자동집계 보강: 반별 체크 상태/성별 누락, 주일통계, 헌금 상세.

alter table public.edu_journals
  add column if not exists offering_details jsonb;

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
  missing_student_gender text[]
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
  teacher_missing as (
    select link.class_no,
      coalesce(array_agg(t.name order by t.name) filter (
        where coalesce(m.gender, user_member.gender) not in ('M', 'F')
           or coalesce(m.gender, user_member.gender) is null
      ), array[]::text[]) as names
    from class_teacher_links link
    join public.edu_teachers t on t.id = link.teacher_id and t.is_active = true
    left join public.members m on m.id = t.member_id
    left join lateral (
      select linked.gender from public.members linked
      where linked.app_user_id = t.user_id
      limit 1
    ) user_member on true
    group by link.class_no
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
    coalesce(teacher_missing.names, array[]::text[]),
    coalesce(reg.missing_gender, array[]::text[])
  from classes c
  left join reg on reg.class_no = c.class_no
  left join att on att.class_no = c.class_no
  left join tal on tal.class_no = c.class_no
  left join teacher_missing on teacher_missing.class_no = c.class_no
  order by c.sort_order, c.class_no;
end;
$$;
grant execute on function public.edu_journal_class_rollup(uuid, date) to authenticated;

create or replace function public.edu_journal_sunday_rollup(p_dept_id uuid, p_date date)
returns table (
  category text,
  male int,
  female int,
  total int,
  missing_gender_names text[]
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_edu_member_or_admin(p_dept_id) then
    raise exception '접근 권한이 없습니다';
  end if;

  return query
  with teachers as (
    select t.id, t.name, coalesce(m.gender, user_member.gender) as gender
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
     from teachers t where t.gender not in ('M', 'F') or t.gender is null)
  from present_teachers p
  union all
  select 'student'::text,
    count(*) filter (where p.gender = 'M')::int,
    count(*) filter (where p.gender = 'F')::int,
    count(*)::int,
    (select coalesce(array_agg(s.name order by s.name), array[]::text[])
     from students s where s.student_type <> '체험' and (s.gender not in ('M', 'F') or s.gender is null))
  from present_students p where p.student_type <> '체험'
  union all
  select 'new_friend'::text,
    count(*) filter (where p.gender = 'M')::int,
    count(*) filter (where p.gender = 'F')::int,
    count(*)::int,
    (select coalesce(array_agg(s.name order by s.name), array[]::text[])
     from students s where s.student_type = '체험' and (s.gender not in ('M', 'F') or s.gender is null))
  from present_students p where p.student_type = '체험';
end;
$$;
grant execute on function public.edu_journal_sunday_rollup(uuid, date) to authenticated;

drop function if exists public.edu_get_journal(uuid);
create function public.edu_get_journal(p_id uuid)
returns table (
  id uuid, department_id uuid, journal_date date, edu_topic text,
  scripture text, leader text, preacher text, sermon_title text, prayer_lead text,
  praise text, joint_activity text, lesson_content text, events text,
  stat_reg_male int, stat_reg_female int, stat_reg_total int,
  stat_enrolled int, stat_attend int, stat_absent int,
  offering int, volunteers text, prayer_requests text, class_stats jsonb,
  offering_details jsonb, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select j.id, j.department_id, j.journal_date, j.edu_topic,
    j.scripture, j.leader, j.preacher, j.sermon_title, j.prayer_lead,
    j.praise, j.joint_activity, j.lesson_content, j.events,
    j.stat_reg_male, j.stat_reg_female, j.stat_reg_total,
    j.stat_enrolled, j.stat_attend, j.stat_absent,
    j.offering, j.volunteers, j.prayer_requests, j.class_stats,
    j.offering_details, j.created_at
  from public.edu_journals j
  where j.id = p_id and public.is_edu_member_or_admin(j.department_id);
$$;
grant execute on function public.edu_get_journal(uuid) to authenticated;

drop function if exists public.edu_upsert_journal(uuid,date,text,text,text,text,text,text,text,text,text,text,int,int,int,int,int,int,int,text,text,jsonb);
create function public.edu_upsert_journal(
  p_dept_id uuid, p_date date, p_topic text, p_scripture text,
  p_leader text, p_preacher text, p_sermon_title text, p_prayer_lead text,
  p_praise text, p_joint text, p_lesson text, p_events text,
  p_reg_male int, p_reg_female int, p_reg_total int,
  p_enrolled int, p_attend int, p_absent int, p_offering int,
  p_volunteers text, p_prayer text, p_class_stats jsonb default null,
  p_offering_details jsonb default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_edu_member_or_admin(p_dept_id) then
    raise exception '권한이 없습니다';
  end if;

  insert into public.edu_journals (
    department_id, journal_date, edu_topic, scripture, leader, preacher,
    sermon_title, prayer_lead, praise, joint_activity, lesson_content, events,
    stat_reg_male, stat_reg_female, stat_reg_total, stat_enrolled, stat_attend,
    stat_absent, offering, volunteers, prayer_requests, class_stats,
    offering_details, created_by, updated_at
  ) values (
    p_dept_id, p_date, p_topic, p_scripture, p_leader, p_preacher,
    p_sermon_title, p_prayer_lead, p_praise, p_joint, p_lesson, p_events,
    coalesce(p_reg_male, 0), coalesce(p_reg_female, 0), coalesce(p_reg_total, 0),
    coalesce(p_enrolled, 0), coalesce(p_attend, 0), coalesce(p_absent, 0),
    coalesce(p_offering, 0), p_volunteers, p_prayer, p_class_stats,
    p_offering_details, auth.uid(), now()
  )
  on conflict (department_id, journal_date) do update set
    edu_topic = excluded.edu_topic,
    scripture = excluded.scripture,
    leader = excluded.leader,
    preacher = excluded.preacher,
    sermon_title = excluded.sermon_title,
    prayer_lead = excluded.prayer_lead,
    praise = excluded.praise,
    joint_activity = excluded.joint_activity,
    lesson_content = excluded.lesson_content,
    events = excluded.events,
    stat_reg_male = excluded.stat_reg_male,
    stat_reg_female = excluded.stat_reg_female,
    stat_reg_total = excluded.stat_reg_total,
    stat_enrolled = excluded.stat_enrolled,
    stat_attend = excluded.stat_attend,
    stat_absent = excluded.stat_absent,
    offering = excluded.offering,
    volunteers = excluded.volunteers,
    prayer_requests = excluded.prayer_requests,
    class_stats = excluded.class_stats,
    offering_details = excluded.offering_details,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.edu_upsert_journal(uuid,date,text,text,text,text,text,text,text,text,text,text,int,int,int,int,int,int,int,text,text,jsonb,jsonb) to authenticated;
