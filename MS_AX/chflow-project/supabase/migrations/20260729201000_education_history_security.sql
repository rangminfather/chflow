-- Education history RLS, public projections, and mutation RPCs.

alter table public.app_capabilities enable row level security;
alter table public.app_capability_grants enable row level security;
alter table public.education_courses enable row level security;
alter table public.education_course_aliases enable row level security;
alter table public.education_course_policies enable row level security;
alter table public.education_import_batches enable row level security;
alter table public.education_offerings enable row level security;
alter table public.education_import_rows enable row level security;
alter table public.education_import_match_candidates enable row level security;
alter table public.education_import_duplicate_candidates enable row level security;
alter table public.member_identity_aliases enable row level security;
alter table public.member_education_history enable row level security;
alter table public.education_history_audit_logs enable row level security;

create policy app_capabilities_read_authenticated
  on public.app_capabilities for select to authenticated
  using (public.has_app_capability('education_history.read'));
create policy app_capabilities_admin_manage
  on public.app_capabilities for all to authenticated
  using (public.get_user_role() = 'admin')
  with check (public.get_user_role() = 'admin');

create policy app_capability_grants_admin
  on public.app_capability_grants for all to authenticated
  using (public.get_user_role() = 'admin')
  with check (public.get_user_role() = 'admin');

create policy education_courses_read
  on public.education_courses for select to authenticated
  using (public.has_app_capability('education_history.read') and deleted_at is null);
create policy education_courses_manage
  on public.education_courses for all to authenticated
  using (public.has_app_capability('education_course.manage'))
  with check (public.has_app_capability('education_course.manage'));

create policy education_aliases_manage
  on public.education_course_aliases for all to authenticated
  using (public.has_app_capability('education_course.manage'))
  with check (public.has_app_capability('education_course.manage'));

create policy education_policies_read
  on public.education_course_policies for select to authenticated
  using (public.has_app_capability('education_history.read'));
create policy education_policies_manage
  on public.education_course_policies for all to authenticated
  using (public.has_app_capability('education_course.manage'))
  with check (public.has_app_capability('education_course.manage'));

create policy education_offerings_read
  on public.education_offerings for select to authenticated
  using (public.has_app_capability('education_history.read') and deleted_at is null);
create policy education_offerings_manage
  on public.education_offerings for all to authenticated
  using (public.has_app_capability('education_history.manage'))
  with check (public.has_app_capability('education_history.manage'));

create policy education_batches_staff
  on public.education_import_batches for all to authenticated
  using (public.has_app_capability('education_history.import'))
  with check (public.has_app_capability('education_history.import'));

create policy education_import_rows_staff
  on public.education_import_rows for all to authenticated
  using (public.has_app_capability('education_history.manage'))
  with check (public.has_app_capability('education_history.manage'));

create policy education_match_candidates_staff
  on public.education_import_match_candidates for all to authenticated
  using (public.has_app_capability('education_history.manage'))
  with check (public.has_app_capability('education_history.manage'));

create policy education_duplicate_candidates_staff
  on public.education_import_duplicate_candidates for all to authenticated
  using (public.has_app_capability('education_history.manage'))
  with check (public.has_app_capability('education_history.manage'));

create policy member_identity_aliases_staff
  on public.member_identity_aliases for all to authenticated
  using (public.has_app_capability('education_history.manage'))
  with check (public.has_app_capability('education_history.manage'));

create policy member_education_history_staff
  on public.member_education_history for all to authenticated
  using (public.has_app_capability('education_history.manage'))
  with check (public.has_app_capability('education_history.manage'));

create policy education_audit_admin_read
  on public.education_history_audit_logs for select to authenticated
  using (public.has_app_capability('education_history.audit.read'));

revoke all on public.app_capabilities from anon;
revoke all on public.app_capability_grants from anon;
revoke all on public.education_courses from anon;
revoke all on public.education_course_aliases from anon;
revoke all on public.education_course_policies from anon;
revoke all on public.education_import_batches from anon;
revoke all on public.education_offerings from anon;
revoke all on public.education_import_rows from anon;
revoke all on public.education_import_match_candidates from anon;
revoke all on public.education_import_duplicate_candidates from anon;
revoke all on public.member_identity_aliases from anon;
revoke all on public.member_education_history from anon;
revoke all on public.education_history_audit_logs from anon;

grant select, insert, update, delete on public.app_capabilities to authenticated;
grant select, insert, update, delete on public.app_capability_grants to authenticated;
grant select, insert, update, delete on public.education_courses to authenticated;
grant select, insert, update, delete on public.education_course_aliases to authenticated;
grant select, insert, update, delete on public.education_course_policies to authenticated;
grant select, insert, update, delete on public.education_import_batches to authenticated;
grant select, insert, update, delete on public.education_offerings to authenticated;
grant select, insert, update, delete on public.education_import_rows to authenticated;
grant select, insert, update, delete on public.education_import_match_candidates to authenticated;
grant select, insert, update, delete on public.education_import_duplicate_candidates to authenticated;
grant select, insert, update, delete on public.member_identity_aliases to authenticated;
grant select, insert, update, delete on public.member_education_history to authenticated;
grant select on public.education_history_audit_logs to authenticated;

grant all on public.app_capabilities to service_role;
grant all on public.app_capability_grants to service_role;
grant all on public.education_courses to service_role;
grant all on public.education_course_aliases to service_role;
grant all on public.education_course_policies to service_role;
grant all on public.education_import_batches to service_role;
grant all on public.education_offerings to service_role;
grant all on public.education_import_rows to service_role;
grant all on public.education_import_match_candidates to service_role;
grant all on public.education_import_duplicate_candidates to service_role;
grant all on public.member_identity_aliases to service_role;
grant all on public.member_education_history to service_role;
grant all on public.education_history_audit_logs to service_role;

revoke all on function public.has_app_capability(text, uuid) from public, anon;
grant execute on function public.has_app_capability(text, uuid) to authenticated, service_role;
revoke all on function public.assert_app_capability(text) from public, anon;
grant execute on function public.assert_app_capability(text) to authenticated, service_role;

create or replace function public.get_my_app_capabilities()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(c.capability_key order by c.capability_key), '{}'::text[])
  from public.app_capabilities c
  where c.active and public.has_app_capability(c.capability_key);
$$;
revoke all on function public.get_my_app_capabilities() from public, anon;
grant execute on function public.get_my_app_capabilities() to authenticated;

create or replace view public.public_member_education_history_view
with (security_barrier = true)
as
select
  h.id,
  h.member_id,
  m.name as member_name,
  c.id as course_id,
  c.name as course_name,
  c.category,
  coalesce(o.audience, c.default_audience) as audience,
  o.cohort_no,
  o.cohort_label_raw,
  o.cohort_from,
  o.cohort_to,
  o.cohort_precision,
  o.class_variant,
  o.instructor_raw,
  h.attendance_status,
  o.started_on,
  o.ended_on,
  o.completed_on,
  o.date_precision,
  current_policy.requirement_type as current_requirement_type,
  case
    when o.completed_on is null or o.date_precision not in ('day', 'range') then '당시 정책 미확인'
    when historical_policy.requirement_type is null then '당시 정책 미확인'
    else historical_policy.requirement_type
  end as historical_requirement_type
from public.member_education_history h
join public.members m on m.id = h.member_id and m.status = 'active'
join public.education_courses c on c.id = h.course_id and c.deleted_at is null
left join public.education_offerings o on o.id = h.offering_id and o.deleted_at is null
left join lateral (
  select p.requirement_type
  from public.education_course_policies p
  where p.course_id = c.id
    and p.active
    and (p.effective_from is null or p.effective_from <= current_date)
    and (p.effective_to is null or p.effective_to >= current_date)
  order by p.effective_from desc nulls last, p.created_at desc
  limit 1
) current_policy on true
left join lateral (
  select p.requirement_type
  from public.education_course_policies p
  where p.course_id = c.id
    and p.active
    and p.effective_from is not null
    and p.effective_from <= o.completed_on
    and (p.effective_to is null or p.effective_to >= o.completed_on)
  order by p.effective_from desc, p.created_at desc
  limit 1
) historical_policy on true
where h.deleted_at is null
  and public.has_app_capability('education_history.read');

revoke all on public.public_member_education_history_view from public, anon;
grant select on public.public_member_education_history_view to authenticated;

create or replace function public.education_member_summaries(
  p_query text default null,
  p_plain text default null,
  p_grassland text default null,
  p_pasture text default null,
  p_required_status text default null,
  p_offset integer default 0,
  p_limit integer default 30
)
returns table (
  member_id uuid,
  member_name text,
  sub_role text,
  plain_name text,
  grassland_name text,
  pasture_name text,
  total_history_count bigint,
  life_study_count bigint,
  required_completed_count bigint,
  required_total_count bigint,
  latest_completed_on date,
  required_status text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_app_capability('education_history.read');
  return query
  with current_required as (
    select distinct on (p.course_id) p.course_id
    from public.education_course_policies p
    join public.education_courses c on c.id = p.course_id
    where p.active
      and p.requirement_type = 'basic_required'
      and c.category = 'life_study'
      and c.default_audience = 'adult'
      and c.active
      and c.deleted_at is null
      and (p.effective_from is null or p.effective_from <= current_date)
      and (p.effective_to is null or p.effective_to >= current_date)
    order by p.course_id, p.effective_from desc nulls last, p.created_at desc
  ),
  required_total as (
    select count(*)::bigint as value from current_required
  ),
  history_agg as (
    select
      h.member_id,
      count(*) filter (where h.attendance_status in ('completed', 'attended'))::bigint as total_history_count,
      count(*) filter (
        where c.category = 'life_study'
          and h.attendance_status in ('completed', 'attended')
      )::bigint as life_study_count,
      count(distinct h.course_id) filter (
        where h.course_id in (select course_id from current_required)
          and coalesce(o.audience, c.default_audience) = 'adult'
          and h.attendance_status in ('completed', 'attended')
      )::bigint as required_completed_count,
      max(o.completed_on) filter (where h.attendance_status in ('completed', 'attended')) as latest_completed_on
    from public.member_education_history h
    join public.education_courses c on c.id = h.course_id
    left join public.education_offerings o on o.id = h.offering_id
    where h.deleted_at is null
    group by h.member_id
  ),
  scoped as (
    select
      m.id as member_id,
      m.name as member_name,
      m.sub_role,
      pl.name as plain_name,
      g.name as grassland_name,
      dp.name as pasture_name,
      coalesce(ha.total_history_count, 0)::bigint as total_history_count,
      coalesce(ha.life_study_count, 0)::bigint as life_study_count,
      coalesce(ha.required_completed_count, 0)::bigint as required_completed_count,
      rt.value as required_total_count,
      ha.latest_completed_on,
      case
        when rt.value = 0 then '확인 필요'
        when coalesce(ha.required_completed_count, 0) >= rt.value then '기본필수과정 충족'
        else '기본필수과정 미충족'
      end as required_status
    from public.members m
    left join public.households hh on hh.id = m.household_id
    left join public.directory_pastures dp on dp.id = hh.pasture_id
    left join public.grasslands g on g.id = dp.grassland_id
    left join public.plains pl on pl.id = g.plain_id
    left join history_agg ha on ha.member_id = m.id
    cross join required_total rt
    where m.status = 'active'
      and (nullif(trim(p_query), '') is null or m.name ilike '%' || trim(p_query) || '%')
      and (nullif(p_plain, '') is null or pl.name = p_plain)
      and (nullif(p_grassland, '') is null or g.name = p_grassland)
      and (nullif(p_pasture, '') is null or dp.name = p_pasture)
  ),
  filtered as (
    select *
    from scoped s
    where nullif(p_required_status, '') is null or s.required_status = p_required_status
  )
  select
    f.member_id, f.member_name, f.sub_role, f.plain_name, f.grassland_name, f.pasture_name,
    f.total_history_count, f.life_study_count, f.required_completed_count,
    f.required_total_count, f.latest_completed_on, f.required_status,
    count(*) over()::bigint
  from filtered f
  order by f.member_name, f.member_id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;
revoke all on function public.education_member_summaries(text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.education_member_summaries(text, text, text, text, text, integer, integer) to authenticated;

create or replace function public.education_member_detail(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.assert_app_capability('education_history.read');

  with current_required as (
    select distinct on (p.course_id)
      p.course_id, c.name as course_name
    from public.education_course_policies p
    join public.education_courses c on c.id = p.course_id
    where p.active
      and p.requirement_type = 'basic_required'
      and c.category = 'life_study'
      and c.default_audience = 'adult'
      and c.active
      and c.deleted_at is null
      and (p.effective_from is null or p.effective_from <= current_date)
      and (p.effective_to is null or p.effective_to >= current_date)
    order by p.course_id, p.effective_from desc nulls last, p.created_at desc
  ),
  public_history as (
    select *
    from public.public_member_education_history_view
    where member_id = p_member_id
  )
  select jsonb_build_object(
    'member', (
      select jsonb_build_object('id', m.id, 'name', m.name, 'sub_role', m.sub_role)
      from public.members m
      where m.id = p_member_id and m.status = 'active'
    ),
    'summary', jsonb_build_object(
      'total_history_count', (select count(*) from public_history),
      'life_study_count', (select count(*) from public_history where category = 'life_study'),
      'required_completed_count', (
        select count(distinct cr.course_id)
        from current_required cr
        join public_history ph on ph.course_id = cr.course_id
        where ph.audience = 'adult'
          and ph.attendance_status in ('completed', 'attended')
      ),
      'required_total_count', (select count(*) from current_required),
      'latest_completed_on', (select max(completed_on) from public_history)
    ),
    'requirements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'course_id', cr.course_id,
        'course_name', cr.course_name,
        'status', case
          when exists (
            select 1 from public_history ph
            where ph.course_id = cr.course_id
              and ph.audience = 'adult'
              and ph.attendance_status in ('completed', 'attended')
          ) then '이수 완료'
          else '미이수'
        end
      ) order by cr.course_name), '[]'::jsonb)
      from current_required cr
    ),
    'histories', (
      select coalesce(jsonb_agg(to_jsonb(ph) order by ph.completed_on desc nulls last, ph.course_name), '[]'::jsonb)
      from public_history ph
    )
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.education_member_detail(uuid) from public, anon;
grant execute on function public.education_member_detail(uuid) to authenticated;

create or replace function public.stage_education_import(
  p_batch jsonb,
  p_rows jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_existing uuid;
begin
  perform public.assert_app_capability('education_history.import');

  select b.id into v_existing
  from public.education_import_batches b
  where lower(b.file_hash) = lower(p_batch->>'file_hash')
    and b.source_type = p_batch->>'source_type'
    and b.import_status <> 'cancelled'
  order by b.uploaded_at desc
  limit 1;

  insert into public.education_import_batches(
    source_filename, source_type, file_hash, parser_version,
    total_tables, total_rows, valid_rows, invalid_rows,
    repeated_header_rows, empty_rows, import_status,
    validation_report, duplicate_of_batch_id, uploaded_by
  )
  values (
    p_batch->>'source_filename',
    p_batch->>'source_type',
    p_batch->>'file_hash',
    p_batch->>'parser_version',
    coalesce((p_batch->>'total_tables')::integer, 0),
    coalesce((p_batch->>'total_rows')::integer, 0),
    coalesce((p_batch->>'valid_rows')::integer, 0),
    coalesce((p_batch->>'invalid_rows')::integer, 0),
    coalesce((p_batch->>'repeated_header_rows')::integer, 0),
    coalesce((p_batch->>'empty_rows')::integer, 0),
    case when v_existing is null then 'staged' else 'duplicate' end,
    coalesce(p_batch->'validation_report', '{}'::jsonb),
    v_existing,
    auth.uid()
  )
  returning id into v_batch_id;

  if v_existing is not null then
    return v_batch_id;
  end if;

  insert into public.education_import_rows(
    batch_id, source_table_no, source_row_no, serial_raw, course_name_raw,
    person_name_raw, instructor_raw, certificate_no_raw, date_raw, note_raw,
    status_raw, raw_data, raw_row_text, parser_version,
    person_name_normalized, historical_role_raw, disambiguator_raw,
    organization_raw, normalization_note, cohort_no, cohort_label_raw,
    cohort_from, cohort_to, cohort_precision, class_variant, audience,
    ministry_department, category, requirement_type, started_on, ended_on,
    completed_on, date_precision, attendance_status, date_parse_status,
    normalized_data, normalization_status
  )
  select
    v_batch_id,
    (r->>'source_table_no')::integer,
    (r->>'source_row_no')::integer,
    r->>'serial_raw',
    r->>'course_name_raw',
    r->>'person_name_raw',
    r->>'instructor_raw',
    r->>'certificate_no_raw',
    r->>'date_raw',
    r->>'note_raw',
    r->>'status_raw',
    coalesce(r->'raw_data', '{}'::jsonb),
    coalesce(r->>'raw_row_text', ''),
    coalesce(r->>'parser_version', p_batch->>'parser_version'),
    r->>'person_name_normalized',
    r->>'historical_role_raw',
    r->>'disambiguator_raw',
    r->>'organization_raw',
    r->>'normalization_note',
    nullif(r->>'cohort_no', '')::integer,
    r->>'cohort_label_raw',
    nullif(r->>'cohort_from', '')::integer,
    nullif(r->>'cohort_to', '')::integer,
    coalesce(r->>'cohort_precision', 'unknown'),
    r->>'class_variant',
    coalesce(r->>'audience', 'unknown'),
    r->>'ministry_department',
    r->>'category',
    r->>'requirement_type',
    nullif(r->>'started_on', '')::date,
    nullif(r->>'ended_on', '')::date,
    nullif(r->>'completed_on', '')::date,
    coalesce(r->>'date_precision', 'unknown'),
    coalesce(r->>'attendance_status', 'unknown'),
    coalesce(r->>'date_parse_status', 'unknown'),
    coalesce(r->'normalized_data', '{}'::jsonb),
    coalesce(r->>'normalization_status', 'unclassified')
  from jsonb_array_elements(p_rows) r;

  with course_suggestions as (
    select
      ir0.id,
      min(c.id) as course_id,
      count(c.id)::integer as course_count
    from public.education_import_rows ir0
    left join public.education_courses c
      on c.active
      and c.deleted_at is null
      and c.normalized_name = regexp_replace(
        lower(coalesce(ir0.normalized_data->>'standard_course_name', ir0.course_name_raw)),
        '\s+', '', 'g'
      )
    where ir0.batch_id = v_batch_id
    group by ir0.id
  )
  update public.education_import_rows ir
  set
    suggested_course_id = course_suggestions.course_id,
    normalization_status = case
      when course_suggestions.course_count = 1 then 'auto_suggested'
      when course_suggestions.course_count > 1 then 'ambiguous'
      else 'unclassified'
    end
  from course_suggestions
  where ir.id = course_suggestions.id;

  insert into public.education_import_match_candidates(
    import_row_id, member_id, candidate_rank, match_score, match_basis, alias_id
  )
  select
    ir.id,
    candidates.member_id,
    candidates.candidate_rank,
    candidates.match_score,
    candidates.match_basis,
    candidates.alias_id
  from public.education_import_rows ir
  cross join lateral (
    select
      x.member_id,
      row_number() over(order by x.alias_match desc, x.member_id)::integer as candidate_rank,
      case when x.alias_match then 100.0 else 90.0 end::numeric(5,2) as match_score,
      jsonb_build_object(
        'exact_name', true,
        'verified_alias', x.alias_match
      ) as match_basis,
      x.alias_id
    from (
      select m.id as member_id, false as alias_match, null::uuid as alias_id
      from public.members m
      where m.status = 'active'
        and regexp_replace(lower(m.name), '\s+', '', 'g') = ir.person_name_normalized
      union
      select a.member_id, true, a.id
      from public.member_identity_aliases a
      where a.active
        and a.person_name_normalized = ir.person_name_normalized
    ) x
  ) candidates
  where ir.batch_id = v_batch_id;

  update public.education_import_rows ir
  set
    suggested_member_id = matches.single_member_id,
    match_status = case
      when matches.member_count = 1 then 'recommended'
      when matches.member_count > 1 then 'ambiguous'
      else 'unmatched'
    end
  from (
    select
      ir2.id,
      count(distinct mc.member_id)::integer as member_count,
      min(mc.member_id) as single_member_id
    from public.education_import_rows ir2
    left join public.education_import_match_candidates mc on mc.import_row_id = ir2.id
    where ir2.batch_id = v_batch_id
    group by ir2.id
  ) matches
  where ir.id = matches.id;

  -- Duplicate detection only flags candidates. It never deletes or merges rows.
  insert into public.education_import_duplicate_candidates(
    import_row_id, history_id, duplicate_basis
  )
  select
    ir.id,
    h.id,
    jsonb_build_object(
      'same_member', true,
      'same_course', true,
      'same_cohort_or_date', true,
      'same_status', true
    )
  from public.education_import_rows ir
  join public.member_education_history h
    on h.member_id = ir.suggested_member_id
   and h.course_id = ir.suggested_course_id
   and h.attendance_status = ir.attendance_status
   and h.deleted_at is null
  left join public.education_offerings o on o.id = h.offering_id
  where ir.batch_id = v_batch_id
    and (
      (ir.cohort_no is not null and o.cohort_no = ir.cohort_no)
      or (ir.completed_on is not null and o.completed_on = ir.completed_on)
      or (
        ir.cohort_label_raw is not null
        and o.cohort_label_raw = ir.cohort_label_raw
      )
    )
  on conflict (import_row_id, history_id) do nothing;

  update public.education_import_rows ir
  set duplicate_status = 'suspected'
  where ir.batch_id = v_batch_id
    and exists (
      select 1
      from public.education_import_duplicate_candidates dc
      where dc.import_row_id = ir.id
    );

  with duplicate_keys as (
    select
      person_name_normalized,
      suggested_course_id,
      coalesce(cohort_no::text, cohort_label_raw, '') as cohort_key,
      coalesce(completed_on::text, started_on::text || ':' || ended_on::text, '') as date_key,
      attendance_status
    from public.education_import_rows
    where batch_id = v_batch_id
      and person_name_normalized is not null
      and suggested_course_id is not null
    group by person_name_normalized, suggested_course_id,
      coalesce(cohort_no::text, cohort_label_raw, ''),
      coalesce(completed_on::text, started_on::text || ':' || ended_on::text, ''),
      attendance_status
    having count(*) > 1
  )
  update public.education_import_rows ir
  set duplicate_status = 'suspected'
  from duplicate_keys d
  where ir.batch_id = v_batch_id
    and ir.person_name_normalized = d.person_name_normalized
    and ir.suggested_course_id = d.suggested_course_id
    and coalesce(ir.cohort_no::text, ir.cohort_label_raw, '') = d.cohort_key
    and coalesce(ir.completed_on::text, ir.started_on::text || ':' || ir.ended_on::text, '') = d.date_key
    and ir.attendance_status = d.attendance_status;

  return v_batch_id;
end;
$$;
revoke all on function public.stage_education_import(jsonb, jsonb) from public, anon;
grant execute on function public.stage_education_import(jsonb, jsonb) to authenticated;

create or replace function public.review_education_import_row(
  p_row_id uuid,
  p_member_id uuid default null,
  p_course_id uuid default null,
  p_action text default 'hold',
  p_review_note text default null,
  p_save_alias boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.education_import_rows%rowtype;
  v_offering_id uuid;
  v_history_id uuid;
begin
  perform public.assert_app_capability(
    case when p_action in ('approve', 'unapprove') then 'education_history.approve'
         else 'education_history.manage' end
  );

  select * into v_row
  from public.education_import_rows
  where id = p_row_id
  for update;
  if not found then
    raise exception '가져오기 행을 찾을 수 없습니다';
  end if;

  if p_action = 'exclude' then
    update public.education_import_rows
    set match_status = 'skipped', excluded_at = now(), excluded_by = auth.uid(),
        exclusion_reason = p_review_note, review_note = p_review_note,
        reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_row_id;
    return null;
  end if;

  if p_action = 'unlink' then
    update public.education_import_rows
    set matched_member_id = null, match_status = 'pending',
        reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_review_note
    where id = p_row_id;
    return null;
  end if;

  if p_action = 'unapprove' then
    if v_row.created_history_id is not null then
      update public.member_education_history
      set deleted_at = now(), deletion_reason = coalesce(p_review_note, '승인 취소')
      where id = v_row.created_history_id and deleted_at is null;
    end if;
    update public.education_import_rows
    set created_history_id = null, match_status = 'recommended',
        reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_review_note
    where id = p_row_id;
    return null;
  end if;

  if p_member_id is not null or p_course_id is not null then
    update public.education_import_rows
    set
      matched_member_id = coalesce(p_member_id, matched_member_id),
      suggested_course_id = coalesce(p_course_id, suggested_course_id),
      match_status = case when coalesce(p_member_id, matched_member_id) is null then match_status else 'approved' end,
      normalization_status = case when coalesce(p_course_id, suggested_course_id) is null then normalization_status else 'manually_confirmed' end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = p_review_note
    where id = p_row_id
    returning * into v_row;
  end if;

  if p_save_alias and v_row.matched_member_id is not null then
    insert into public.member_identity_aliases(
      member_id, person_name_raw, person_name_normalized, historical_role_raw,
      disambiguator_raw, organization_raw, source_type, match_confidence,
      verified_by
    )
    select
      v_row.matched_member_id, v_row.person_name_raw, v_row.person_name_normalized,
      v_row.historical_role_raw, v_row.disambiguator_raw, v_row.organization_raw,
      b.source_type, 100, auth.uid()
    from public.education_import_batches b
    where b.id = v_row.batch_id;
  end if;

  if p_action <> 'approve' then
    return null;
  end if;

  if v_row.created_history_id is not null then
    return v_row.created_history_id;
  end if;
  if v_row.matched_member_id is null or v_row.suggested_course_id is null then
    raise exception '성도와 표준 과정 연결이 모두 필요합니다';
  end if;
  if v_row.attendance_status = 'applied' then
    raise exception '신청 상태 행은 정식 이력으로 승인할 수 없습니다';
  end if;

  insert into public.education_offerings(
    course_id, cohort_no, cohort_label_raw, cohort_from, cohort_to,
    cohort_precision, class_variant, instructor_raw, audience,
    ministry_department, organization_raw, started_on, ended_on,
    completed_on, date_precision, source_import_batch_id
  )
  values (
    v_row.suggested_course_id, v_row.cohort_no, v_row.cohort_label_raw,
    v_row.cohort_from, v_row.cohort_to, v_row.cohort_precision,
    v_row.class_variant, v_row.instructor_raw, v_row.audience,
    v_row.ministry_department, v_row.organization_raw, v_row.started_on,
    v_row.ended_on, v_row.completed_on, v_row.date_precision, v_row.batch_id
  )
  returning id into v_offering_id;

  insert into public.member_education_history(
    member_id, course_id, offering_id, attendance_status, certificate_no_raw,
    person_name_raw, historical_role_raw, organization_raw,
    source_import_row_id, verified_by
  )
  values (
    v_row.matched_member_id, v_row.suggested_course_id, v_offering_id,
    v_row.attendance_status, v_row.certificate_no_raw, v_row.person_name_raw,
    v_row.historical_role_raw, v_row.organization_raw, v_row.id, auth.uid()
  )
  returning id into v_history_id;

  update public.education_import_rows
  set created_history_id = v_history_id, match_status = 'approved',
      reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_review_note
  where id = p_row_id;

  return v_history_id;
end;
$$;
revoke all on function public.review_education_import_row(uuid, uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.review_education_import_row(uuid, uuid, uuid, text, text, boolean) to authenticated;
