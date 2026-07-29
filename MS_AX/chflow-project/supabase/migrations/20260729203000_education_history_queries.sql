-- Education-history read models. All functions re-check the capability server-side.

create or replace function public.education_course_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_result jsonb;
begin
  perform public.assert_app_capability('education_history.read');
  select jsonb_build_object(
    'courses', coalesce((
      select jsonb_agg(x order by x.course_name, x.cohort_no nulls last)
      from (
        select c.id as course_id, c.name as course_name, c.category,
          ph.current_requirement_type as requirement_type,
          ph.cohort_no, ph.cohort_label_raw, ph.class_variant,
          ph.audience, ph.instructor_raw, ph.started_on, ph.ended_on,
          count(*) filter (where ph.attendance_status = 'completed') as completed_count,
          count(*) filter (where ph.attendance_status = 'attended') as attended_count,
          jsonb_agg(jsonb_build_object(
            'member_id', ph.member_id, 'member_name', ph.member_name,
            'attendance_status', ph.attendance_status,
            'completed_on', ph.completed_on
          ) order by ph.member_name) as participants
        from public.public_member_education_history_view ph
        join public.education_courses c on c.id = ph.course_id
        group by c.id, c.name, c.category, ph.current_requirement_type,
          ph.cohort_no, ph.cohort_label_raw, ph.class_variant,
          ph.audience, ph.instructor_raw, ph.started_on, ph.ended_on
      ) x
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('value', category, 'count', count))
      from (
        select category, count(*) from public.public_member_education_history_view
        group by category order by category
      ) q
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.education_course_dashboard() from public, anon;
grant execute on function public.education_course_dashboard() to authenticated;

create or replace function public.education_required_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_result jsonb;
begin
  perform public.assert_app_capability('education_history.read');
  with required as (
    select distinct on (p.course_id) p.course_id, c.name
    from public.education_course_policies p
    join public.education_courses c on c.id = p.course_id
    where p.active and p.requirement_type = 'basic_required'
      and c.category = 'life_study' and c.default_audience = 'adult'
      and c.active and c.deleted_at is null
      and (p.effective_from is null or p.effective_from <= current_date)
      and (p.effective_to is null or p.effective_to >= current_date)
    order by p.course_id, p.effective_from desc nulls last, p.created_at desc
  ),
  member_status as (
    select m.id, m.name,
      coalesce(jsonb_object_agg(r.name, exists (
        select 1 from public.public_member_education_history_view ph
        where ph.member_id = m.id and ph.course_id = r.course_id
          and ph.audience = 'adult'
          and ph.attendance_status in ('completed', 'attended')
      )), '{}'::jsonb) as courses,
      count(*) filter (where exists (
        select 1 from public.public_member_education_history_view ph
        where ph.member_id = m.id and ph.course_id = r.course_id
          and ph.audience = 'adult'
          and ph.attendance_status in ('completed', 'attended')
      )) as completed_count,
      count(r.course_id) as required_count
    from public.members m cross join required r
    where m.status = 'active'
    group by m.id, m.name
  )
  select jsonb_build_object(
    'policy_basis', '현재 정책 기준',
    'required_courses', coalesce((select jsonb_agg(jsonb_build_object('id', course_id, 'name', name) order by name) from required), '[]'::jsonb),
    'summary', jsonb_build_object(
      'total_members', count(*),
      'fully_met', count(*) filter (where completed_count = required_count and required_count > 0),
      'four_completed', count(*) filter (where completed_count = 4),
      'three_or_less', count(*) filter (where completed_count <= 3)
    ),
    'members', coalesce(jsonb_agg(jsonb_build_object(
      'member_id', id, 'member_name', name, 'courses', courses,
      'completed_count', completed_count, 'required_count', required_count,
      'status', case
        when required_count = 0 then '기본필수과정 확인 필요'
        when completed_count = required_count then '기본필수과정 충족'
        else '기본필수과정 미충족' end
    ) order by name), '[]'::jsonb)
  ) into v_result
  from member_status;
  return v_result;
end;
$$;
revoke all on function public.education_required_dashboard() from public, anon;
grant execute on function public.education_required_dashboard() to authenticated;

create or replace function public.education_lmtc_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_can_manage boolean := public.has_app_capability('education_history.manage');
declare v_result jsonb;
begin
  perform public.assert_app_capability('education_history.read');
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'history_id', h.id, 'member_id', h.member_id, 'member_name', m.name,
      'historical_role_raw', h.historical_role_raw,
      'organization_raw', h.organization_raw,
      'cohort_no', o.cohort_no, 'cohort_label_raw', o.cohort_label_raw,
      'cohort_from', o.cohort_from, 'cohort_to', o.cohort_to,
      'cohort_precision', o.cohort_precision, 'completed_on', o.completed_on,
      'attendance_status', h.attendance_status,
      'certificate_no_raw', case when v_can_manage then h.certificate_no_raw else null end
    ) order by coalesce(o.cohort_no, o.cohort_from), m.name), '[]'::jsonb),
    'counts', jsonb_build_object(
      'completed', count(*) filter (where h.attendance_status = 'completed'),
      'attended', count(*) filter (where h.attendance_status = 'attended'),
      'education', count(*) filter (where h.attendance_status = 'education'),
      'unknown', count(*) filter (where h.attendance_status = 'unknown')
    )
  ) into v_result
  from public.member_education_history h
  join public.members m on m.id = h.member_id
  join public.education_courses c on c.id = h.course_id and c.category = 'lmtc'
  left join public.education_offerings o on o.id = h.offering_id
  where h.deleted_at is null;
  return v_result;
end;
$$;
revoke all on function public.education_lmtc_dashboard() from public, anon;
grant execute on function public.education_lmtc_dashboard() to authenticated;

create or replace function public.education_statistics()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_result jsonb;
begin
  perform public.assert_app_capability('education_history.read');
  select jsonb_build_object(
    'total_histories', (select count(*) from public.member_education_history where deleted_at is null),
    'matched_rows', (select count(*) from public.education_import_rows where match_status = 'approved'),
    'unmatched_rows', (select count(*) from public.education_import_rows where match_status = 'unmatched'),
    'ambiguous_rows', (select count(*) from public.education_import_rows where match_status = 'ambiguous'),
    'unclassified_rows', (select count(*) from public.education_import_rows where normalization_status = 'unclassified'),
    'date_error_rows', (select count(*) from public.education_import_rows where date_parse_status in ('invalid', 'blank')),
    'yearly', coalesce((
      select jsonb_agg(jsonb_build_object('year', year, 'count', count) order by year)
      from (
        select extract(year from completed_on)::integer as year, count(*)
        from public.public_member_education_history_view
        where completed_on is not null group by 1
      ) q
    ), '[]'::jsonb),
    'by_course', coalesce((
      select jsonb_agg(jsonb_build_object('course_name', course_name, 'count', count) order by count desc)
      from (
        select course_name, count(*) from public.public_member_education_history_view
        group by course_name
      ) q
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.education_statistics() from public, anon;
grant execute on function public.education_statistics() to authenticated;

create or replace function public.education_search_member_candidates(
  p_query text,
  p_limit integer default 20
)
returns table (
  member_id uuid,
  member_name text,
  current_role text,
  birth_year integer,
  phone_last4 text,
  existing_history_count bigint
)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.assert_app_capability('education_history.manage');
  return query
  select
    m.id, m.name, m.sub_role,
    extract(year from m.birth_date)::integer,
    right(regexp_replace(coalesce(m.phone, ''), '\D', '', 'g'), 4),
    count(h.id)::bigint
  from public.members m
  left join public.member_education_history h
    on h.member_id = m.id and h.deleted_at is null
  where m.status = 'active'
    and nullif(trim(p_query), '') is not null
    and m.name ilike '%' || trim(p_query) || '%'
  group by m.id, m.name, m.sub_role, m.birth_date, m.phone
  order by
    case when regexp_replace(m.name, '\s+', '', 'g') =
      regexp_replace(trim(p_query), '\s+', '', 'g') then 0 else 1 end,
    m.name, m.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
revoke all on function public.education_search_member_candidates(text, integer) from public, anon;
grant execute on function public.education_search_member_candidates(text, integer) to authenticated;
