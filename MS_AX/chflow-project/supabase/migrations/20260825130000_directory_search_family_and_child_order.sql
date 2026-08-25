-- ============================================================================
-- directory_search_members 병합: 관계 우선순위(family_tier) + 자녀 수동 서열(child_order)
--
--   같은 브랜치 작업 도중 다른 세션이 20260825124000에서 이 함수를 자녀
--   서열(child_order/생년월일) 기준으로 이미 고쳐뒀다. 20260825120000에서
--   내가 만든 family_tier(본인/배우자/자녀/자녀의 배우자/손주/부모/형제/조카/
--   조부모) 로직을 덮어쓰지 않도록, 두 변경을 여기서 합친다.
--
--   - related_ids/가족 포함 범위: family_tier 방식 유지(같은 세대 전체가
--     아니라 관계가 명확한 사람만).
--   - 정렬: family_tier가 우선하고, 그 안에서 자녀(is_child)는
--     child_order → birth_date → gender → name 순으로 세분화한다.
-- ============================================================================

create or replace function public.directory_search_members(
  p_query     text default null,
  p_plain     text default null,
  p_grassland text default null,
  p_pasture   text default null,
  p_offset    int  default 0,
  p_limit     int  default 30
)
returns table (
  id uuid,
  name text,
  phone text,
  home_phone text,
  gender text,
  family_church text,
  sub_role text,
  spouse_name text,
  pasture_name text,
  grassland_name text,
  plain_name text,
  is_child boolean,
  photo_url text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
#variable_conflict use_column
begin
  if public.search_request_is_anonymous() then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;

  return query
  with input as (
    select
      nullif(trim(p_query), '') as query_text,
      nullif(regexp_replace(coalesce(p_query, ''), '\D', '', 'g'), '') as query_digits,
      public.hangul_search_regex(p_query) as query_regex
  ),
  scoped as (
    select
      m.id,
      m.name,
      m.phone,
      m.home_phone,
      m.gender,
      m.family_church,
      m.sub_role,
      m.spouse_name,
      p.name as pasture_name,
      g.name as grassland_name,
      pl.name as plain_name,
      m.is_child,
      m.photo_url,
      m.household_id,
      m.child_order,
      m.birth_date,
      h.home_phone as household_home_phone,
      case
        when i.query_text is null then 0
        when lower(m.name) = lower(i.query_text) then 0
        when m.name ilike i.query_text || '%' then 1
        when i.query_regex is not null and m.name ~* ('^' || i.query_regex) then 1
        when m.name ilike '%' || i.query_text || '%' then 2
        when i.query_regex is not null and m.name ~* i.query_regex then 2
        when coalesce(m.spouse_name, '') ilike '%' || i.query_text || '%' then 3
        when i.query_regex is not null and coalesce(m.spouse_name, '') ~* i.query_regex then 3
        else 4
      end as match_order
    from public.members m
    left join public.households h on h.id = m.household_id
    left join public.directory_pastures p on p.id = h.pasture_id
    left join public.grasslands g on g.id = p.grassland_id
    left join public.plains pl on pl.id = g.plain_id
    cross join input i
    where m.status = 'active'
      and (nullif(p_plain, '') is null or pl.name = p_plain)
      and (nullif(p_grassland, '') is null or g.name = p_grassland)
      and (nullif(p_pasture, '') is null or p.name = p_pasture)
  ),
  direct_matches as (
    select s.*
    from scoped s
    cross join input i
    where i.query_text is null
      or s.name ilike '%' || i.query_text || '%'
      or coalesce(s.spouse_name, '') ilike '%' || i.query_text || '%'
      or (
        i.query_regex is not null
        and (
          s.name ~* i.query_regex
          or coalesce(s.spouse_name, '') ~* i.query_regex
        )
      )
      or (
        i.query_digits is not null
        and (
          regexp_replace(coalesce(s.phone, ''), '\D', '', 'g') like '%' || i.query_digits || '%'
          or regexp_replace(coalesce(s.home_phone, ''), '\D', '', 'g') like '%' || i.query_digits || '%'
          or regexp_replace(coalesce(s.household_home_phone, ''), '\D', '', 'g') like '%' || i.query_digits || '%'
        )
      )
  ),
  -- 직접 일치한 사람(dm) 기준, 함께 딸려 나오는 가족 구성원의 관계 우선순위.
  -- 숫자가 작을수록 먼저 보인다. 여러 dm과 겹치면 가장 가까운(작은) 값을 쓴다.
  family_tier as (
    -- 1. 배우자
    select dm.id as dm_id, r.relative_id as member_id, 1 as tier
    from direct_matches dm
    join public.member_relations r on r.subject_id = dm.id and r.kind = 'spouse'
    union all
    select dm.id, r.subject_id, 1
    from direct_matches dm
    join public.member_relations r on r.relative_id = dm.id and r.kind = 'spouse'

    -- 2. 자녀
    union all
    select dm.id, r.subject_id, 2
    from direct_matches dm
    join public.member_relations r on r.relative_id = dm.id and r.kind = 'parent'

    -- 3. 자녀의 배우자
    union all
    select dm.id, rs.relative_id, 3
    from direct_matches dm
    join public.member_relations rc on rc.relative_id = dm.id and rc.kind = 'parent'
    join public.member_relations rs on rs.subject_id = rc.subject_id and rs.kind = 'spouse'

    -- 4. 손주·증손주 (명시적 grandparent 관계 + 부모관계 2단 전개 모두 포함
    --    — 자녀 쪽에 grandparent row를 안 만들어둔 경우를 대비)
    union all
    select dm.id, r.subject_id, 4
    from direct_matches dm
    join public.member_relations r on r.relative_id = dm.id and r.kind in ('grandparent', 'great_grandparent')
    union all
    select dm.id, gc.subject_id, 4
    from direct_matches dm
    join public.member_relations c on c.relative_id = dm.id and c.kind = 'parent'
    join public.member_relations gc on gc.relative_id = c.subject_id and gc.kind = 'parent'

    -- 5. 부모
    union all
    select dm.id, r.relative_id, 5
    from direct_matches dm
    join public.member_relations r on r.subject_id = dm.id and r.kind = 'parent'

    -- 6. 형제자매 (같은 부모를 공유하는 다른 자녀)
    union all
    select dm.id, sib.subject_id, 6
    from direct_matches dm
    join public.member_relations rp on rp.subject_id = dm.id and rp.kind = 'parent'
    join public.member_relations sib on sib.relative_id = rp.relative_id
      and sib.kind = 'parent'
      and sib.subject_id <> dm.id

    -- 7. 형제자매의 자녀 (조카)
    union all
    select dm.id, niece.subject_id, 7
    from direct_matches dm
    join public.member_relations rp on rp.subject_id = dm.id and rp.kind = 'parent'
    join public.member_relations sib on sib.relative_id = rp.relative_id
      and sib.kind = 'parent'
      and sib.subject_id <> dm.id
    join public.member_relations niece on niece.relative_id = sib.subject_id and niece.kind = 'parent'

    -- 8. 조부모·증조부모 (명시적 grandparent 관계 + 부모관계 2단 전개 모두 포함)
    union all
    select dm.id, r.relative_id, 8
    from direct_matches dm
    join public.member_relations r on r.subject_id = dm.id and r.kind in ('grandparent', 'great_grandparent')
    union all
    select dm.id, gp.relative_id, 8
    from direct_matches dm
    join public.member_relations p on p.subject_id = dm.id and p.kind = 'parent'
    join public.member_relations gp on gp.subject_id = p.relative_id and gp.kind = 'parent'
  ),
  best_tier as (
    select member_id, min(tier) as tier
    from family_tier
    group by member_id
  ),
  related_ids as (
    select dm.id
    from direct_matches dm

    union

    select member_id
    from best_tier
  ),
  filtered as (
    select
      s.id,
      s.name,
      s.phone,
      s.home_phone,
      s.gender,
      s.family_church,
      s.sub_role,
      s.spouse_name,
      s.pasture_name,
      s.grassland_name,
      s.plain_name,
      s.is_child,
      s.photo_url,
      s.child_order,
      s.birth_date,
      case when dm.id is not null then s.match_order else 4 end as match_order,
      coalesce(bt.tier, 9) as family_tier
    from scoped s
    left join direct_matches dm on dm.id = s.id
    left join best_tier bt on bt.member_id = s.id
    cross join input i
    where (i.query_text is null and dm.id is not null)
       or (i.query_text is not null and s.id in (select id from related_ids))
  )
  select
    f.id,
    f.name,
    f.phone,
    f.home_phone,
    f.gender,
    f.family_church,
    f.sub_role,
    f.spouse_name,
    f.pasture_name,
    f.grassland_name,
    f.plain_name,
    f.is_child,
    f.photo_url,
    (select count(*) from filtered)::bigint as total_count
  from filtered f
  order by
    f.match_order,
    f.family_tier,
    coalesce(f.is_child, false),
    case when coalesce(f.is_child, false) then f.child_order end nulls last,
    case when coalesce(f.is_child, false) then f.birth_date end nulls last,
    case f.gender when 'M' then 0 when 'F' then 1 else 2 end,
    f.name,
    f.id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$fn$;

revoke all on function public.directory_search_members(text, text, text, text, int, int) from public, anon;
grant execute on function public.directory_search_members(text, text, text, text, int, int) to authenticated, service_role, postgres;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'directory_search_members'
    and pg_get_function_identity_arguments(p.oid) = 'p_query text, p_plain text, p_grassland text, p_pasture text, p_offset integer, p_limit integer';

  if v_definition is null
     or v_definition not like '%f.child_order%'
     or v_definition not like '%family_tier%'
     or has_function_privilege('anon', 'public.directory_search_members(text,text,text,text,integer,integer)', 'EXECUTE')
  then
    raise exception 'directory_search_members 병합(가족 우선순위 + 자녀 서열) 검증 실패';
  end if;
end
$$;
