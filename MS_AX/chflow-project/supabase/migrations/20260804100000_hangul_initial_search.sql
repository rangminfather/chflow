-- ============================================================================
-- 한글 초성 검색 (성도 / 학생 / 앱 사용자 이름)
--
--   "ㅊ"      → 최·차·추 …
--   "ㅊㅅㅎ"  → 최성헌
--   "최ㅅㅎ"  → 최성헌   (한글 + 초성 혼합)
--
-- 설계 원칙
--   · 기존 ilike / like / = 조건은 그대로 두고 OR 로만 추가한다.
--   · 검색어에 초성이 하나도 없으면 hangul_search_regex() 가 NULL 을 반환하므로
--     기존 검색 동작·결과·정렬은 100% 그대로다.
--   · ㄱ 입력 시 ㄲ 은 매칭하지 않는다 (사용자 결정).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────
-- 0. 초성 → 정규식 변환 헬퍼
-- ─────────────────────────────────────────────────────────────
create or replace function public.hangul_search_regex(p_query text)
returns text
language plpgsql
immutable
parallel safe
as $fn$
declare
  v_src  text := btrim(coalesce(p_query, ''));
  v_out  text := '';
  v_ch   text;
  v_code int;
  v_idx  int;
  v_hit  boolean := false;
  v_i    int;
begin
  if v_src = '' then
    return null;
  end if;

  for v_i in 1 .. length(v_src) loop
    v_ch   := substr(v_src, v_i, 1);
    v_code := ascii(v_ch);

    -- 호환 자모 초성 (U+3131 ~ U+314E) → 19 초성 인덱스
    -- ㄳ ㄵ ㄶ ㄺ ㄻ ㄼ ㄽ ㄾ ㄿ ㅀ ㅄ 는 초성이 될 수 없으므로 제외
    v_idx := case v_code
      when 12593 then 0   -- ㄱ
      when 12594 then 1   -- ㄲ
      when 12596 then 2   -- ㄴ
      when 12599 then 3   -- ㄷ
      when 12600 then 4   -- ㄸ
      when 12601 then 5   -- ㄹ
      when 12609 then 6   -- ㅁ
      when 12610 then 7   -- ㅂ
      when 12611 then 8   -- ㅃ
      when 12613 then 9   -- ㅅ
      when 12614 then 10  -- ㅆ
      when 12615 then 11  -- ㅇ
      when 12616 then 12  -- ㅈ
      when 12617 then 13  -- ㅉ
      when 12618 then 14  -- ㅊ
      when 12619 then 15  -- ㅋ
      when 12620 then 16  -- ㅌ
      when 12621 then 17  -- ㅍ
      when 12622 then 18  -- ㅎ
      else null
    end;

    -- 일부 IME 가 내보내는 한글 자모 블록 초성 (U+1100 ~ U+1112) 도 허용
    if v_idx is null and v_code between 4352 and 4370 then
      v_idx := v_code - 4352;
    end if;

    if v_idx is not null then
      -- 해당 초성으로 시작하는 음절 588 개 구간: 0xAC00 + idx*588 ~ +587
      v_hit := true;
      v_out := v_out
            || '['
            || chr(44032 + v_idx * 588)
            || '-'
            || chr(44032 + v_idx * 588 + 587)
            || ']';
    elsif (v_code between 44032 and 55203)      -- 완성형 한글 음절 (가 ~ 힣)
       or (v_ch ~ '^[A-Za-z0-9]$') then         -- 영문 · 숫자
      v_out := v_out || v_ch;
    else
      -- 그 외 문자는 정규식 메타문자일 수 있으므로 escape
      -- (역슬래시 + 비영숫자 = 해당 문자 리터럴)
      v_out := v_out || '\' || v_ch;
    end if;
  end loop;

  if not v_hit then
    return null;   -- 초성이 없으면 기존 검색만 사용
  end if;

  return v_out;
end;
$fn$;

comment on function public.hangul_search_regex(text) is
  '검색어를 초성 매칭용 정규식으로 변환한다. 초성이 하나도 없으면 NULL 을 반환하여 기존 ilike 검색만 쓰도록 한다.';

grant execute on function public.hangul_search_regex(text) to anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- 1. 성도검색 (/directory)
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
language sql
stable
security definer
set search_path = public
as $$
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
    id,
    name,
    phone,
    home_phone,
    gender,
    family_church,
    sub_role,
    spouse_name,
    pasture_name,
    grassland_name,
    plain_name,
    is_child,
    photo_url,
    (select count(*) from filtered)::bigint as total_count
  from filtered
  order by
    match_order,
    coalesce(is_child, false),
    case gender when 'M' then 0 when 'F' then 1 else 2 end,
    name,
    id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

grant execute on function public.directory_search_members(text, text, text, text, int, int) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 2. 관리자 성도관리 / 투표 명단 (admin_search_members_paged)
-- ─────────────────────────────────────────────────────────────
create or replace function public.admin_search_members_paged(
  p_query         text    default null,
  p_plain         text    default null,
  p_grassland     text    default null,
  p_pasture       text    default null,
  p_offset        int     default 0,
  p_limit         int     default 50,
  p_show_children boolean default true,
  p_show_parents  boolean default true,
  p_member_status text    default 'active'
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
  address text,
  pasture_name text,
  grassland_name text,
  plain_name text,
  guard_status text,
  status text,
  has_account boolean,
  is_child boolean,
  source_page int,
  photo_url text,
  household_id uuid,
  pasture_id uuid,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_regex text := public.hangul_search_regex(p_query);
begin
  if coalesce(public.get_user_role(), '') not in ('admin', 'office', 'pastor') then
    raise exception '권한이 없습니다';
  end if;

  return query
  with filtered as (
    select
      m.id,
      m.name,
      m.phone,
      m.home_phone,
      m.gender,
      m.family_church,
      m.sub_role,
      m.spouse_name,
      h.address,
      p.name as pasture_name,
      g.name as grassland_name,
      pl.name as plain_name,
      m.guard_status,
      m.status,
      (m.app_user_id is not null) as has_account,
      m.is_child,
      m.source_page,
      m.photo_url,
      m.household_id,
      h.pasture_id,
      pl.order_no as pl_order,
      g.order_no as g_order,
      p.order_no as p_order,
      h.order_no as h_order
    from public.members m
    left join public.households h on h.id = m.household_id
    left join public.directory_pastures p on p.id = h.pasture_id
    left join public.grasslands g on g.id = p.grassland_id
    left join public.plains pl on pl.id = g.plain_id
    where (
        p_member_status is null
        or p_member_status = 'all'
        or m.status = p_member_status
      )
      and (
        p_query is null
        or m.name ilike '%' || p_query || '%'
        or m.phone ilike '%' || p_query || '%'
        or m.home_phone ilike '%' || p_query || '%'
        or h.home_phone ilike '%' || p_query || '%'
        or (v_regex is not null and m.name ~* v_regex)
      )
      and (p_plain is null or pl.name = p_plain)
      and (p_grassland is null or g.name = p_grassland)
      and (p_pasture is null or p.name = p_pasture)
      and (
        p_show_children
        or not exists (
          select 1
          from public.member_relations r
          join public.members rm on rm.id = r.relative_id
          join public.households rh on rh.id = rm.household_id
          where r.subject_id = m.id
            and r.kind in ('parent', 'grandparent', 'great_grandparent')
            and rh.pasture_id = h.pasture_id
        )
      )
      and (
        p_show_parents
        or not exists (
          select 1
          from public.member_relations r
          join public.members sm on sm.id = r.subject_id
          join public.households sh on sh.id = sm.household_id
          where r.relative_id = m.id
            and r.kind in ('parent', 'grandparent', 'great_grandparent')
            and sh.pasture_id = h.pasture_id
        )
      )
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
    f.address,
    f.pasture_name,
    f.grassland_name,
    f.plain_name,
    f.guard_status,
    f.status,
    f.has_account,
    f.is_child,
    f.source_page,
    f.photo_url,
    f.household_id,
    f.pasture_id,
    (select count(*) from filtered)::bigint as total_count
  from filtered f
  order by f.pl_order nulls last, f.g_order nulls last, f.p_order nulls last, f.h_order nulls last, f.name
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 50), 1), 500);
end;
$$;

grant execute on function public.admin_search_members_paged(text, text, text, text, int, int, boolean, boolean, text) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 3. 성도 후보 검색 (성도카드 모달 · 부모 연결)
--    기존은 이름 완전일치(=)만 매칭. 초성이 들어온 경우에만 초성 매칭을 추가한다.
--
--    ※ 이 RPC 는 anon 에게도 grant 되어 있다. 완전일치였기 때문에 명단 열람이
--      불가능했는데, 초성을 무조건 허용하면 비로그인 상태에서 "ㄱ" 한 글자로
--      성도 명단(이름·전화·주소·목장)을 훑을 수 있게 된다.
--      → 초성 매칭은 로그인 사용자(auth.uid() is not null)에게만 허용한다.
--        비로그인 동작은 기존과 완전히 동일.
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
language sql
stable
security definer
set search_path = public
as $$
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
  cross join (
    select case when auth.uid() is not null
                then public.hangul_search_regex(p_name)
                else null
           end as name_regex
  ) hs
  where m.status = 'active'
    and (
      m.name = p_name
      or (hs.name_regex is not null and m.name ~* hs.name_regex)
    )
  order by match_score desc, m.is_child asc, m.name
  limit p_limit;
$$;

grant execute on function public.search_member_candidates(text, text, int) to anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- 4. 교육이력 성도 후보 검색
-- ─────────────────────────────────────────────────────────────
create or replace function public.education_search_member_candidates(
  p_query text,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(q) order by q.exact_rank, q.member_name, q.member_id), '[]'::jsonb)
  from (
    select
      m.id as member_id,
      m.name::text as member_name,
      (to_jsonb(m)->>'sub_role')::text as current_role,
      case
        when coalesce(to_jsonb(m)->>'birth_date', '') ~ '^[0-9]{4}'
        then left(to_jsonb(m)->>'birth_date', 4)::integer
        else null::integer
      end as birth_year,
      right(regexp_replace(coalesce(to_jsonb(m)->>'phone', ''), '[^0-9]', '', 'g'), 4)::text as phone_last4,
      (
        select count(*)::bigint
        from public.member_education_history eh
        where eh.member_id = m.id and eh.deleted_at is null
      ) as existing_history_count,
      case when regexp_replace(m.name, '[[:space:]]+', '', 'g') =
        regexp_replace(btrim(p_query), '[[:space:]]+', '', 'g') then 0 else 1 end as exact_rank
    from public.members m
    cross join (select public.hangul_search_regex(p_query) as name_regex) hs
    where public.has_app_capability('education_history.manage')
      and m.status = 'active'
      and nullif(btrim(p_query), '') is not null
      and (
        m.name ilike '%' || btrim(p_query) || '%'
        or (hs.name_regex is not null and m.name ~* hs.name_regex)
      )
    order by exact_rank, m.name, m.id
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) q;
$$;

revoke all on function public.education_search_member_candidates(text, integer) from public, anon;
grant execute on function public.education_search_member_candidates(text, integer) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 5. 부서 학생(자녀) 이름 검색
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
DECLARE
  v_regex text;
BEGIN
  IF length(trim(p_query)) < 2 THEN
    RAISE EXCEPTION '검색어는 2자 이상 입력해 주세요';
  END IF;

  v_regex := public.hangul_search_regex(p_query);

  RETURN QUERY
  SELECT s.id, s.student_no, s.name, s.grade, t.name AS teacher_name
  FROM public.edu_students s
  LEFT JOIN public.edu_teachers t ON s.teacher_id = t.id
  WHERE s.department_id = p_dept_id
    AND s.is_active = true
    AND (
      s.name LIKE '%' || trim(p_query) || '%'
      OR (v_regex IS NOT NULL AND s.name ~* v_regex)
    )
  ORDER BY s.grade, s.order_no, s.student_no, s.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dept_search_children(uuid, text) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- 6. 부서 임명 대상 검색
-- ─────────────────────────────────────────────────────────────
create or replace function public.dept_search_members_for_appoint(p_dept_id uuid, p_query text)
returns table(member_id uuid, app_user_id uuid, name text, phone text, gender text, birth_date date, photo_url text, sub_role text, pasture_name text, grassland_name text, plain_name text, already_member boolean)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_regex text;
begin
  if not public.dept_mgmt_grade_ok(p_dept_id, 'dept/members-grade') then
    raise exception '임명 권한이 없습니다 (전도사·교육사 또는 위임된 임원진)';
  end if;
  if p_query is null or length(trim(p_query)) = 0 then
    return;
  end if;

  v_regex := public.hangul_search_regex(p_query);

  return query
  select
    m.id          as member_id,
    m.app_user_id,
    m.name,
    m.phone,
    m.gender,
    m.birth_date,
    m.photo_url,
    m.sub_role,
    p.name        as pasture_name,
    g.name        as grassland_name,
    pl.name       as plain_name,
    exists (
      select 1 from public.department_members dm
      where dm.department_id = p_dept_id
        and dm.user_id = m.app_user_id
        and dm.status = 'approved'
    ) as already_member
  from public.members m
  left join public.households h         on m.household_id = h.id
  left join public.directory_pastures p on h.pasture_id = p.id
  left join public.grasslands g         on p.grassland_id = g.id
  left join public.plains pl            on g.plain_id = pl.id
  where m.app_user_id is not null
    and (
      m.name ilike '%' || p_query || '%'
      or m.phone ilike '%' || p_query || '%'
      or (v_regex is not null and m.name ~* v_regex)
    )
  order by m.name
  limit 20;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 7. 메신저 사용자 검색
-- ─────────────────────────────────────────────────────────────
create or replace function public.search_messenger_users(
  p_query text default '',
  p_limit int default 20
)
returns table (
  user_id uuid,
  name text,
  sub_role text,
  role text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id as user_id,
    p.name,
    p.sub_role,
    p.role,
    coalesce(p.avatar_url, m.photo_url) as avatar_url
  from public.profiles p
  left join public.members m on m.id = p.member_id
  cross join (select public.hangul_search_regex(p_query) as name_regex) hs
  where p.status = 'active'
    and p.id <> auth.uid()
    and exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and me.status = 'active'
    )
    and (
      coalesce(trim(p_query), '') = ''
      or p.name ilike '%' || trim(p_query) || '%'
      or p.username ilike '%' || trim(p_query) || '%'
      or p.sub_role ilike '%' || trim(p_query) || '%'
      or (
        hs.name_regex is not null
        and (p.name ~* hs.name_regex or p.sub_role ~* hs.name_regex)
      )
    )
  order by
    case
      when p.name ilike trim(p_query) || '%' then 0
      when hs.name_regex is not null and p.name ~* ('^' || hs.name_regex) then 0
      else 1
    end,
    p.name nulls last
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.search_messenger_users(text, int) to authenticated;
