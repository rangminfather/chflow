-- Server-paginated sensitive review projection. This RPC is never available
-- to ordinary members and intentionally includes raw source cells only after
-- the manage capability check.
create or replace function public.education_import_review_page(
  p_filter text default 'all',
  p_batch_id uuid default null,
  p_query text default null,
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.assert_app_capability('education_history.manage');

  with scoped as (
    select
      r.*,
      b.source_filename,
      b.source_type,
      c.name as suggested_course_name,
      sm.name as suggested_member_name
    from public.education_import_rows r
    join public.education_import_batches b on b.id = r.batch_id
    left join public.education_courses c on c.id = r.suggested_course_id
    left join public.members sm on sm.id = r.suggested_member_id
    where (p_batch_id is null or r.batch_id = p_batch_id)
      and (
        nullif(btrim(p_query), '') is null
        or r.person_name_raw ilike '%' || btrim(p_query) || '%'
        or r.person_name_normalized ilike '%' || btrim(p_query) || '%'
        or r.course_name_raw ilike '%' || btrim(p_query) || '%'
      )
      and case coalesce(p_filter, 'all')
        when 'recommended' then r.match_status = 'recommended' and r.created_history_id is null
        when 'ambiguous' then r.match_status = 'ambiguous'
        when 'unmatched' then r.match_status = 'unmatched'
        when 'unclassified' then r.normalization_status = 'unclassified'
        when 'date_error' then r.date_parse_status in ('invalid', 'blank')
        when 'duplicate' then r.duplicate_status = 'suspected'
        when 'applied' then r.attendance_status = 'applied'
        when 'approved' then r.created_history_id is not null
        when 'excluded' then r.excluded_at is not null or r.match_status = 'skipped'
        else true
      end
  ),
  page_rows as (
    select *
    from scoped
    order by created_at desc, source_table_no, source_row_no
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  select jsonb_build_object(
    'total', (select count(*) from scoped),
    'items', coalesce((
      select jsonb_agg(
        to_jsonb(pr) || jsonb_build_object(
          'candidates', coalesce((
            select jsonb_agg(jsonb_build_object(
              'member_id', m.id,
              'member_name', m.name,
              'current_role', to_jsonb(m)->>'sub_role',
              'birth_year', left(coalesce(to_jsonb(m)->>'birth_date', ''), 4),
              'phone_last4', right(regexp_replace(coalesce(to_jsonb(m)->>'phone', ''), '[^0-9]', '', 'g'), 4),
              'match_score', mc.match_score,
              'match_basis', mc.match_basis,
              'existing_history_count', (
                select count(*) from public.member_education_history eh
                where eh.member_id = m.id and eh.deleted_at is null
              )
            ) order by mc.candidate_rank)
            from public.education_import_match_candidates mc
            join public.members m on m.id = mc.member_id
            where mc.import_row_id = pr.id
          ), '[]'::jsonb)
        )
        order by pr.created_at desc, pr.source_table_no, pr.source_row_no
      )
      from page_rows pr
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'all', (select count(*) from public.education_import_rows),
      'recommended', (select count(*) from public.education_import_rows where match_status = 'recommended' and created_history_id is null),
      'ambiguous', (select count(*) from public.education_import_rows where match_status = 'ambiguous'),
      'unmatched', (select count(*) from public.education_import_rows where match_status = 'unmatched'),
      'unclassified', (select count(*) from public.education_import_rows where normalization_status = 'unclassified'),
      'date_error', (select count(*) from public.education_import_rows where date_parse_status in ('invalid', 'blank')),
      'duplicate', (select count(*) from public.education_import_rows where duplicate_status = 'suspected'),
      'applied', (select count(*) from public.education_import_rows where attendance_status = 'applied'),
      'approved', (select count(*) from public.education_import_rows where created_history_id is not null),
      'excluded', (select count(*) from public.education_import_rows where excluded_at is not null or match_status = 'skipped')
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.education_import_review_page(text, uuid, text, integer, integer) from public, anon;
grant execute on function public.education_import_review_page(text, uuid, text, integer, integer) to authenticated;
