create or replace function public.admin_photo_review_members(
  p_query text default null,
  p_filter text default 'all',
  p_offset integer default 0,
  p_limit integer default 30
)
returns table (
  id uuid,
  name text,
  phone text,
  sub_role text,
  source_page integer,
  photo_page integer,
  photo_url text,
  photo_status text,
  review_status text,
  expected_crop_url text,
  expected_source_file text,
  expected_pdf_name text,
  expected_pdf_phone text,
  candidates jsonb,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'office', 'pastor')
  ) then
    raise exception 'not authorized';
  end if;

  return query
  with base as (
    select
      m.id,
      m.name,
      m.phone,
      m.sub_role,
      m.source_page,
      m.photo_page,
      m.photo_url,
      m.photo_status,
      m.review_status,
      ec.source_url as expected_crop_url,
      ec.source_file as expected_source_file,
      ec.pdf_name as expected_pdf_name,
      ec.pdf_phone as expected_pdf_phone,
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'source_file', c.source_file,
              'photo_page', c.photo_page,
              'photo_index', c.photo_index,
              'source_url', c.source_url,
              'pdf_name', c.pdf_name,
              'pdf_phone', c.pdf_phone,
              'expected_member_id', c.expected_member_id
            )
            order by c.photo_index
          ),
          '[]'::jsonb
        )
        from public.directory_photo_crops c
        where c.photo_page = m.photo_page
      ) as candidates
    from public.members m
    left join lateral (
      select c.*
      from public.directory_photo_crops c
      where c.expected_member_id = m.id
      order by
        case when c.photo_page = m.photo_page then 0 else 1 end,
        case
          when regexp_replace(coalesce(c.pdf_phone, ''), '\D', '', 'g') <> ''
           and regexp_replace(coalesce(c.pdf_phone, ''), '\D', '', 'g')
               = regexp_replace(coalesce(m.phone, ''), '\D', '', 'g')
          then 0 else 1
        end,
        c.photo_page,
        c.photo_index
      limit 1
    ) ec on true
    where m.status = 'active'
      and coalesce(m.is_child, false) = false
      and m.photo_page is not null
      and (
        p_query is null
        or p_query = ''
        or m.name ilike '%' || p_query || '%'
        or (
          regexp_replace(p_query, '\D', '', 'g') <> ''
          and regexp_replace(coalesce(m.phone, ''), '\D', '', 'g') like '%' || regexp_replace(p_query, '\D', '', 'g') || '%'
        )
      )
      and (
        p_filter is null
        or p_filter = 'all'
        or (p_filter = 'has_photo' and m.photo_url is not null)
        or (p_filter = 'no_photo' and m.photo_url is null)
        or (p_filter = 'has_expected' and ec.id is not null)
        or (p_filter = 'needs_source' and ec.id is null)
      )
  ),
  counted as (
    select base.*, count(*) over() as total_count
    from base
    order by base.photo_page nulls last, base.name
    offset greatest(p_offset, 0)
    limit least(greatest(p_limit, 1), 100)
  )
  select
    counted.id,
    counted.name,
    counted.phone,
    counted.sub_role,
    counted.source_page,
    counted.photo_page,
    counted.photo_url,
    counted.photo_status,
    counted.review_status,
    counted.expected_crop_url,
    counted.expected_source_file,
    counted.expected_pdf_name,
    counted.expected_pdf_phone,
    counted.candidates,
    counted.total_count
  from counted;
end;
$$;

grant execute on function public.admin_photo_review_members(text, text, integer, integer) to authenticated;
