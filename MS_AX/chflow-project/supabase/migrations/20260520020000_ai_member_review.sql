create table if not exists public.ai_member_review_candidates (
  id bigserial primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  evidence_image_url text not null,
  evidence_note text,
  model text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'ignored', 'needs_review', 'error')),
  db_name text,
  db_sub_role text,
  db_family_church text,
  db_spouse_name text,
  db_phone text,
  db_home_phone text,
  db_source_page integer,
  ai_name text,
  ai_sub_role text,
  ai_family_church text,
  ai_spouse_name text,
  ai_phone text,
  ai_home_phone text,
  ai_confidence numeric,
  ai_warnings text[],
  recommendation text,
  raw_response jsonb,
  applied_fields text[] not null default '{}',
  review_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz
);

create index if not exists idx_ai_member_review_candidates_member
  on public.ai_member_review_candidates(member_id, created_at desc);

create index if not exists idx_ai_member_review_candidates_status
  on public.ai_member_review_candidates(status, created_at desc);

alter table public.ai_member_review_candidates enable row level security;

drop policy if exists "ai_member_review_admin_read" on public.ai_member_review_candidates;
create policy "ai_member_review_admin_read"
  on public.ai_member_review_candidates
  for select
  to authenticated
  using (public.get_user_role() in ('admin', 'office', 'pastor'));

drop function if exists public.admin_ai_member_review_candidates(text, text, integer, integer);
create or replace function public.admin_ai_member_review_candidates(
  p_status text default 'pending',
  p_query text default null,
  p_offset integer default 0,
  p_limit integer default 30
)
returns table (
  id bigint,
  member_id uuid,
  member_name text,
  member_phone text,
  member_home_phone text,
  member_source_page integer,
  member_status text,
  evidence_image_url text,
  evidence_note text,
  model text,
  status text,
  db_name text,
  db_sub_role text,
  db_family_church text,
  db_spouse_name text,
  db_phone text,
  db_home_phone text,
  db_source_page integer,
  ai_name text,
  ai_sub_role text,
  ai_family_church text,
  ai_spouse_name text,
  ai_phone text,
  ai_home_phone text,
  ai_confidence numeric,
  ai_warnings text[],
  recommendation text,
  applied_fields text[],
  review_note text,
  created_at timestamptz,
  reviewed_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_user_role() not in ('admin', 'office', 'pastor') then
    raise exception 'not authorized';
  end if;

  return query
  with filtered as (
    select
      c.id,
      c.member_id,
      m.name as member_name,
      m.phone as member_phone,
      m.home_phone as member_home_phone,
      m.source_page as member_source_page,
      m.status as member_status,
      c.evidence_image_url,
      c.evidence_note,
      c.model,
      c.status,
      c.db_name,
      c.db_sub_role,
      c.db_family_church,
      c.db_spouse_name,
      c.db_phone,
      c.db_home_phone,
      c.db_source_page,
      c.ai_name,
      c.ai_sub_role,
      c.ai_family_church,
      c.ai_spouse_name,
      c.ai_phone,
      c.ai_home_phone,
      c.ai_confidence,
      c.ai_warnings,
      c.recommendation,
      c.applied_fields,
      c.review_note,
      c.created_at,
      c.reviewed_at
    from public.ai_member_review_candidates c
    join public.members m on m.id = c.member_id
    where
      (p_status is null or p_status = 'all' or c.status = p_status)
      and (
        p_query is null
        or p_query = ''
        or m.name ilike '%' || p_query || '%'
        or c.ai_name ilike '%' || p_query || '%'
        or c.ai_sub_role ilike '%' || p_query || '%'
        or (
          regexp_replace(p_query, '\D', '', 'g') <> ''
          and (
            regexp_replace(coalesce(m.phone, ''), '\D', '', 'g') like '%' || regexp_replace(p_query, '\D', '', 'g') || '%'
            or regexp_replace(coalesce(c.ai_phone, ''), '\D', '', 'g') like '%' || regexp_replace(p_query, '\D', '', 'g') || '%'
          )
        )
      )
  ),
  counted as (
    select filtered.*, count(*) over() as total_count
    from filtered
    order by filtered.created_at desc, filtered.id desc
    offset greatest(p_offset, 0)
    limit least(greatest(p_limit, 1), 100)
  )
  select * from counted;
end;
$$;

grant execute on function public.admin_ai_member_review_candidates(text, text, integer, integer) to authenticated;

drop function if exists public.admin_ai_member_review_decide(bigint, text, boolean, boolean, text);
create or replace function public.admin_ai_member_review_decide(
  p_candidate_id bigint,
  p_decision text,
  p_apply_name boolean default false,
  p_apply_sub_role boolean default false,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.ai_member_review_candidates%rowtype;
  v_applied text[] := '{}';
  v_count integer;
begin
  if public.get_user_role() not in ('admin', 'office', 'pastor') then
    raise exception 'not authorized';
  end if;

  if p_decision not in ('approved', 'ignored', 'needs_review') then
    raise exception 'invalid decision';
  end if;

  select * into v_candidate
  from public.ai_member_review_candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'candidate not found';
  end if;

  if p_decision = 'approved' and (p_apply_name or p_apply_sub_role) then
    update public.members
    set
      name = case
        when p_apply_name and nullif(v_candidate.ai_name, '') is not null
          then v_candidate.ai_name
        else name
      end,
      sub_role = case
        when p_apply_sub_role and nullif(v_candidate.ai_sub_role, '') is not null
          then v_candidate.ai_sub_role
        else sub_role
      end
    where id = v_candidate.member_id
      and name is not distinct from v_candidate.db_name
      and sub_role is not distinct from v_candidate.db_sub_role;

    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception 'member changed after AI review was created; reload before applying';
    end if;

    if p_apply_name then
      v_applied := array_append(v_applied, 'name');
    end if;
    if p_apply_sub_role then
      v_applied := array_append(v_applied, 'sub_role');
    end if;
  end if;

  update public.ai_member_review_candidates
  set
    status = p_decision,
    applied_fields = v_applied,
    review_note = p_note,
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_candidate_id;
end;
$$;

grant execute on function public.admin_ai_member_review_decide(bigint, text, boolean, boolean, text) to authenticated;
