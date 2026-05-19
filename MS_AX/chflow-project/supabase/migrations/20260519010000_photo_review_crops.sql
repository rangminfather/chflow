create table if not exists public.directory_photo_crops (
  id bigserial primary key,
  source_file text not null unique,
  photo_page integer not null,
  photo_index integer not null,
  source_url text not null,
  pdf_name text,
  pdf_phone text,
  expected_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_directory_photo_crops_page
  on public.directory_photo_crops(photo_page, photo_index);

create index if not exists idx_directory_photo_crops_expected_member
  on public.directory_photo_crops(expected_member_id);

alter table public.directory_photo_crops enable row level security;

drop policy if exists "directory_photo_crops_admin_read" on public.directory_photo_crops;
create policy "directory_photo_crops_admin_read"
  on public.directory_photo_crops
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'office', 'pastor')
    )
  );

drop function if exists public.admin_photo_review_members(text, text, integer, integer);
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
    left join public.directory_photo_crops ec
      on ec.expected_member_id = m.id
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

drop function if exists public.admin_photo_crop_search(text, integer);
create or replace function public.admin_photo_crop_search(
  p_query text default null,
  p_limit integer default 40
)
returns table (
  source_file text,
  photo_page integer,
  photo_index integer,
  source_url text,
  pdf_name text,
  pdf_phone text,
  expected_member_id uuid,
  expected_member_name text
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
  select
    c.source_file,
    c.photo_page,
    c.photo_index,
    c.source_url,
    c.pdf_name,
    c.pdf_phone,
    c.expected_member_id,
    m.name as expected_member_name
  from public.directory_photo_crops c
  left join public.members m on m.id = c.expected_member_id
  where
    p_query is null
    or p_query = ''
    or c.pdf_name ilike '%' || p_query || '%'
    or (
      regexp_replace(p_query, '\D', '', 'g') <> ''
      and regexp_replace(coalesce(c.pdf_phone, ''), '\D', '', 'g') like '%' || regexp_replace(p_query, '\D', '', 'g') || '%'
    )
    or c.source_file ilike '%' || p_query || '%'
  order by c.photo_page, c.photo_index
  limit least(greatest(p_limit, 1), 100);
end;
$$;

grant execute on function public.admin_photo_crop_search(text, integer) to authenticated;
