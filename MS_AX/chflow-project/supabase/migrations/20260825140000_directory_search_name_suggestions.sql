-- ============================================================================
-- 성도요람 검색창 자동완성 후보 (동명이인 미리 선택)
--
--   기존 directory_search_members는 검색 버튼을 눌러야 실행되고, 결과에
--   매칭된 사람의 가족 전체가 함께 나온다. 이름을 입력하는 중에 동명이인이
--   있으면 검색을 누르기 전에 후보 목록에서 정확한 사람을 바로 고를 수
--   있도록, 이름/전화만 보고 가볍게 후보만 돌려주는 RPC를 별도로 둔다.
--   (가족 트리 확장 없음 — 순수 본인 매칭만)
-- ============================================================================

create or replace function public.directory_search_name_suggestions(
  p_query text,
  p_limit int default 8
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
  photo_url text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_query  text := nullif(trim(p_query), '');
  v_digits text := nullif(regexp_replace(coalesce(p_query, ''), '\D', '', 'g'), '');
  v_regex  text := public.hangul_search_regex(p_query);
begin
  if public.search_request_is_anonymous() then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;

  if v_query is null then
    return;
  end if;

  return query
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
    m.photo_url
  from public.members m
  left join public.households h on h.id = m.household_id
  left join public.directory_pastures p on p.id = h.pasture_id
  left join public.grasslands g on g.id = p.grassland_id
  left join public.plains pl on pl.id = g.plain_id
  where m.status = 'active'
    and (
      m.name ilike v_query || '%'
      or (v_regex is not null and m.name ~* ('^' || v_regex))
      or (
        v_digits is not null and length(v_digits) >= 3
        and (
          regexp_replace(coalesce(m.phone, ''), '\D', '', 'g') like '%' || v_digits || '%'
          or regexp_replace(coalesce(m.home_phone, ''), '\D', '', 'g') like '%' || v_digits || '%'
          or regexp_replace(coalesce(h.home_phone, ''), '\D', '', 'g') like '%' || v_digits || '%'
        )
      )
    )
  order by
    case
      when lower(m.name) = lower(v_query) then 0
      when m.name ilike v_query || '%' then 1
      else 2
    end,
    m.name,
    m.id
  limit greatest(1, least(coalesce(p_limit, 8), 20));
end;
$fn$;

revoke all on function public.directory_search_name_suggestions(text, int) from public, anon;
grant execute on function public.directory_search_name_suggestions(text, int) to authenticated, service_role, postgres;
