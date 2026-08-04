-- ============================================================================
-- 성도/학생 검색 RPC 익명 접근 차단 (보안 H-3 완결)
-- 2026-08-04
--
-- 문제
--   1) Postgres 는 새 함수에 PUBLIC EXECUTE 를 기본 부여한다. 아래 3개 RPC 는
--      이를 회수한 적이 없어 anon 키만으로 PostgREST 직접 호출이 가능하다.
--   2) directory_search_members 는 함수 내부에 권한 검사가 전혀 없어
--      p_query='%' 한 글자로 전 성도의 이름·휴대폰·집전화·평원/초원/목장을
--      100건씩 페이지네이션하며 덤프할 수 있다.
--      dept_search_children 도 마찬가지로 '%%' 로 전체 학생 명단이 노출된다.
--   3) 20260614150000_h3_revoke_anon_signup_rpcs.sql (H-3) 은
--      `REVOKE ... FROM PUBLIC` 만 수행했는데, 20260518030000 에서
--      search_member_candidates 에 부여한 `GRANT ... TO anon` 은 anon 롤에
--      직접 부여된 것이라 PUBLIC 회수로는 지워지지 않는다. → 아직 열려 있다.
--
-- 조치 (2중 방어)
--   (a) EXECUTE 권한: PUBLIC·anon 회수 후 authenticated·service_role·postgres 재부여
--   (b) 함수 내부: 익명 호출이면 42501 예외
--
-- 유지 사항
--   · authenticated 호출의 결과·정렬은 일절 바꾸지 않는다.
--   · service_role(서버 route)·직접 DB 접속(마이그레이션·cron)은 차단하지 않는다.
--   · SECURITY DEFINER / search_path=public 설정은 그대로 둔다.
--     (전체 함수의 search_path 정비는 별도 마이그레이션에서 스키마 한정 후 진행)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────
-- 0. 익명 호출 판정 헬퍼
--
--    auth.uid() IS NULL 만으로 판정하면 service_role 서버 호출까지 막힌다.
--    PostgREST 는 요청마다 SET LOCAL ROLE 로 롤을 바꾸고, 이 role GUC 는
--    SECURITY DEFINER 함수 안에서도 그대로 보인다(current_user 만 소유자로 바뀜).
--
--      anon            → uid NULL, role 'anon'          → 익명 (차단)
--      authenticated   → uid 있음                        → 통과
--      service_role    → uid NULL, role 'service_role'   → 통과
--      직접 DB 접속     → uid NULL, role 'none'(미설정)   → 통과
-- ─────────────────────────────────────────────────────────────
create or replace function public.search_request_is_anonymous()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is null
     and coalesce(nullif(current_setting('role', true), ''), 'none')
         not in ('service_role', 'postgres', 'none');
$$;

comment on function public.search_request_is_anonymous() is
  '검색 RPC 익명 호출 판정. service_role·직접 DB 접속은 익명으로 보지 않는다.';

revoke all on function public.search_request_is_anonymous() from public, anon;
grant execute on function public.search_request_is_anonymous() to authenticated, service_role, postgres;


-- ─────────────────────────────────────────────────────────────
-- 1. directory_search_members — 익명 차단 검사 추가
--
--    본문(질의)은 20260707103000 정의를 한 글자도 바꾸지 않는다.
--    language sql → plpgsql 로만 바꿔 앞에 가드를 붙였다.
--    `#variable_conflict use_column` 로 RETURNS TABLE 출력명(id·name·match_order 등)과
--    질의 안 컬럼명이 충돌하지 않게 한다(충돌 시 컬럼 우선 = 기존 SQL 함수와 동일).
--    ※ SECURITY DEFINER 함수는 원래 플래너 인라인 대상이 아니므로 성능 차이 없음.
-- ─────────────────────────────────────────────────────────────
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
      nullif(regexp_replace(coalesce(p_query, ''), '\D', '', 'g'), '') as query_digits
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
      h.home_phone as household_home_phone,
      case
        when i.query_text is null then 0
        when lower(m.name) = lower(i.query_text) then 0
        when m.name ilike i.query_text || '%' then 1
        when m.name ilike '%' || i.query_text || '%' then 2
        when coalesce(m.spouse_name, '') ilike '%' || i.query_text || '%' then 3
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
        i.query_digits is not null
        and (
          regexp_replace(coalesce(s.phone, ''), '\D', '', 'g') like '%' || i.query_digits || '%'
          or regexp_replace(coalesce(s.home_phone, ''), '\D', '', 'g') like '%' || i.query_digits || '%'
          or regexp_replace(coalesce(s.household_home_phone, ''), '\D', '', 'g') like '%' || i.query_digits || '%'
        )
      )
  ),
  related_ids as (
    select dm.id
    from direct_matches dm

    union

    select s.id
    from scoped s
    join direct_matches dm on dm.household_id is not null and s.household_id = dm.household_id

    union

    select r.subject_id
    from public.member_relations r
    join direct_matches dm on dm.id = r.relative_id
    where r.kind <> 'spouse'
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
      case when dm.id is not null then s.match_order else 4 end as match_order
    from scoped s
    left join direct_matches dm on dm.id = s.id
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
    coalesce(f.is_child, false),
    case f.gender when 'M' then 0 when 'F' then 1 else 2 end,
    f.name,
    f.id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$fn$;

revoke all on function public.directory_search_members(text, text, text, text, int, int) from public, anon;
grant execute on function public.directory_search_members(text, text, text, text, int, int) to authenticated, service_role, postgres;


-- ─────────────────────────────────────────────────────────────
-- 2. search_member_candidates — 익명 차단 검사 추가
--    (H-3 의 anon 직접 GRANT 잔존분도 여기서 회수)
-- ─────────────────────────────────────────────────────────────
create or replace function public.search_member_candidates(
  p_name  text,
  p_phone text default null,
  p_limit int  default 10
)
returns table (
  id uuid,
  name text,
  phone text,
  home_phone text,
  gender text,
  family_church text,
  sub_role text,
  address text,
  pasture_name text,
  grassland_name text,
  plain_name text,
  is_child boolean,
  household_id uuid,
  pasture_id uuid,
  match_score int
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
  select
    m.id, m.name, m.phone, m.home_phone, m.gender, m.family_church, m.sub_role,
    h.address,
    p.name  as pasture_name,
    g.name  as grassland_name,
    pl.name as plain_name,
    m.is_child,
    m.household_id,
    h.pasture_id,
    case
      when p_phone is not null and (
        regexp_replace(coalesce(m.phone,''), '\D','','g') = regexp_replace(p_phone, '\D','','g')
        or regexp_replace(coalesce(m.home_phone,''), '\D','','g') = regexp_replace(p_phone, '\D','','g')
        or regexp_replace(coalesce(h.home_phone,''), '\D','','g') = regexp_replace(p_phone, '\D','','g')
      ) then 100
      when p_phone is not null and (
        right(regexp_replace(coalesce(m.phone,''), '\D','','g'), 4) = right(regexp_replace(p_phone, '\D','','g'), 4)
        or right(regexp_replace(coalesce(m.home_phone,''), '\D','','g'), 4) = right(regexp_replace(p_phone, '\D','','g'), 4)
        or right(regexp_replace(coalesce(h.home_phone,''), '\D','','g'), 4) = right(regexp_replace(p_phone, '\D','','g'), 4)
      ) then 80
      when m.name = p_name then 50
      else 10
    end as match_score
  from public.members m
  left join public.households h          on m.household_id = h.id
  left join public.directory_pastures p  on h.pasture_id = p.id
  left join public.grasslands g          on p.grassland_id = g.id
  left join public.plains pl             on g.plain_id = pl.id
  where m.status = 'active'
    and m.name = p_name
  order by match_score desc, m.is_child asc, m.name
  limit p_limit;
end;
$fn$;

revoke all on function public.search_member_candidates(text, text, int) from public, anon;
grant execute on function public.search_member_candidates(text, text, int) to authenticated, service_role, postgres;


-- ─────────────────────────────────────────────────────────────
-- 3. dept_search_children — 익명 차단 검사 추가
--    개인정보 보호용 "2자 이상" 제한은 그대로 유지한다.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dept_search_children(p_dept_id uuid, p_query text)
RETURNS TABLE (
  id           uuid,
  student_no   int,
  name         text,
  grade        text,
  teacher_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.search_request_is_anonymous() THEN
    RAISE EXCEPTION '로그인이 필요합니다' USING ERRCODE = '42501';
  END IF;

  IF length(trim(p_query)) < 2 THEN
    RAISE EXCEPTION '검색어는 2자 이상 입력해 주세요';
  END IF;

  RETURN QUERY
  SELECT s.id, s.student_no, s.name, s.grade, t.name AS teacher_name
  FROM public.edu_students s
  LEFT JOIN public.edu_teachers t ON s.teacher_id = t.id
  WHERE s.department_id = p_dept_id
    AND s.is_active = true
    AND s.name LIKE '%' || trim(p_query) || '%'
  ORDER BY s.grade, s.order_no, s.student_no, s.name;
END;
$$;

revoke all on function public.dept_search_children(uuid, text) from public, anon;
grant execute on function public.dept_search_children(uuid, text) to authenticated, service_role, postgres;
