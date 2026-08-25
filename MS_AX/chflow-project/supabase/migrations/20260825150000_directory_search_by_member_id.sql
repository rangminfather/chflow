-- ============================================================================
-- 성도검색: 동명이인 후보를 고르면 그 사람 기준으로만 결과가 나오게
--
--   지금까지는 후보를 골라도 이름 텍스트만 검색창에 채워져서, 검색을 누르면
--   같은 이름의 다른 사람까지 다시 다 섞여 나왔다. p_member_id를 추가해서,
--   후보를 고른 뒤 검색을 누르면 그 사람 한 명만 direct_match로 잡고
--   그 사람의 family_tier(가족)만 나오게 한다.
--
--   p_member_id가 없으면(기존 호출) 완전히 예전과 동일하게 동작한다.
--   파라미터 목록이 바뀌므로 기존 6-파라미터 함수는 DROP 후 재생성한다
--   (그냥 CREATE OR REPLACE로 파라미터를 늘리면 오버로드가 생겨 기존
--   호출이 모호해질 수 있음).
-- ============================================================================

drop function if exists public.directory_search_members(text, text, text, text, int, int);

create or replace function public.directory_search_members(
  p_query     text default null,
  p_plain     text default null,
  p_grassland text default null,
  p_pasture   text default null,
  p_offset    int  default 0,
  p_limit     int  default 30,
  p_member_id uuid default null
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
    where
      -- 후보를 정확히 골랐으면 그 사람 하나만 direct match로 본다 (동명이인 배제)
      (p_member_id is not null and s.id = p_member_id)
      or (
        p_member_id is null
        and (
          i.query_text is null
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
    where (p_member_id is not null and s.id in (select id from related_ids))
       or (p_member_id is null and i.query_text is null and dm.id is not null)
       or (p_member_id is null and i.query_text is not null and s.id in (select id from related_ids))
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

revoke all on function public.directory_search_members(text, text, text, text, int, int, uuid) from public, anon;
grant execute on function public.directory_search_members(text, text, text, text, int, int, uuid) to authenticated, service_role, postgres;
