-- =============================================================
-- 성도 요람: 실제 로그인 아이디(app_username)는 시스템 staff 에게만 반환
--
-- 배경: directory_member_profile 은 로그인한 교인이 서로의 프로필을 보는 요람
--   본문 RPC 다(이 공개 범위 자체는 서비스 정책이므로 유지). 그런데 반환값에
--   profiles.username(=로그인 아이디)이 그대로 포함되어, 일반 성도끼리 서로의
--   로그인 아이디를 볼 수 있었다. UI 도 요람 상세 "앱" 줄에
--   "앱 가입 · <아이디>" 로 표시한다(app/directory/page.tsx:567 →
--   lib/directory-utils.ts:65 directoryAccountDetail).
--
--   이름+아이디 조합이 모이면 계정 공격 표면이 되므로, 가입 여부는 그대로 보여주고
--   실제 아이디만 계정 지원 업무를 하는 시스템 staff 로 제한한다.
--
-- 조치: 딱 한 필드의 값만 역할에 따라 갈라 준다.
--     'app_username', pr.username
--   →
--     'app_username', CASE WHEN <staff> THEN pr.username ELSE NULL END
--
--   프론트 호환성: 필드를 없애지 않고 null 로 내린다. UI 헬퍼가 이미
--   `app_username ? "라벨 · 아이디" : "라벨"` 구조라(directory-utils.ts:65,
--   MemberCardModal.tsx:98) null 이면 자연히 "앱 가입" 만 표시된다 → 앱 코드
--   수정이 필요 없다. 타입도 `app_username?: string | null` 로 이미 nullable 이다.
--
--   staff 판정은 기존 표준 public.get_user_role() 재사용(현재 74개 함수가 쓴다).
--   role 집합은 assert_staff() 와 동일한 admin/office/pastor 다. assert_staff() 는
--   status='active' 도 함께 보지만, 비활성 계정은 애초에 로그인이 되지 않으므로
--   실질 차이가 없고 새 권한 함수를 만들지 않기 위해 표준 함수를 그대로 썼다.
--
--   함수 전체에 assert_staff() 를 거는 방식은 쓰지 않았다. 그러면 일반 성도의
--   요람 자체가 막힌다(지시 §4).
--
-- 나머지 반환 필드(이름·전화·집전화·주소·생년·성별·사진·배우자·세대원·가족관계·
-- 목장/초원/평·has_app_account·app_status·app_user_id)는 전부 그대로다.
-- LANGUAGE sql / STABLE / SECURITY DEFINER / search_path=public / 오버로드 1개 유지.
-- 기존 migration 수정 없음. CASCADE 없음. grant 변경 없음(anon 은 이미 회수됨).
-- =============================================================

CREATE OR REPLACE FUNCTION public.directory_member_profile(p_member_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT jsonb_build_object(
    'member', jsonb_build_object(
      'id', m.id,
      'name', m.name,
      'phone', m.phone,
      'home_phone', m.home_phone,
      'gender', m.gender,
      'birth_date', m.birth_date,
      'family_church', m.family_church,
      'sub_role', m.sub_role,
      'spouse_name', m.spouse_name,
      'is_child', m.is_child,
      'photo_url', m.photo_url,
      'address', h.address,
      'household_home_phone', h.home_phone,
      'pasture_name', p.name,
      'grassland_name', g.name,
      'plain_name', pl.name,
      'has_app_account', coalesce(m.app_user_id is not null or pr.id is not null, false),
      'app_user_id', coalesce(m.app_user_id, pr.id),
      'app_status', pr.status,
      -- 실제 로그인 아이디는 계정 지원 업무를 하는 시스템 staff 에게만
      'app_username', case
        when public.get_user_role() in ('admin', 'office', 'pastor') then pr.username
        else null
      end
    ),
    'household_members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', hm.id,
        'name', hm.name,
        'phone', hm.phone,
        'home_phone', hm.home_phone,
        'gender', hm.gender,
        'family_church', hm.family_church,
        'sub_role', hm.sub_role,
        'spouse_name', hm.spouse_name,
        'is_child', hm.is_child,
        'photo_url', hm.photo_url
      ) order by
        coalesce(hm.is_child, false),
        case hm.gender when 'M' then 0 when 'F' then 1 else 2 end,
        hm.name,
        hm.id), '[]'::jsonb)
      from public.members hm
      where hm.status = 'active'
        and hm.household_id = m.household_id
        and hm.id <> m.id
    ),
    'relations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'kind', r.kind,
        'role', r.role,
        'relative_id', rm.id,
        'name', rm.name,
        'phone', rm.phone,
        'home_phone', rm.home_phone,
        'gender', rm.gender,
        'is_child', rm.is_child,
        'photo_url', rm.photo_url,
        'pasture_name', rp.name,
        'grassland_name', rg.name,
        'plain_name', rpl.name,
        'direction', 'ancestor'
      ) order by
        coalesce(rm.is_child, false),
        case rm.gender when 'M' then 0 when 'F' then 1 else 2 end,
        rm.name,
        rm.id), '[]'::jsonb)
      from public.member_relations r
      join public.members rm on rm.id = r.relative_id and rm.status = 'active'
      left join public.households rh on rh.id = rm.household_id
      left join public.directory_pastures rp on rp.id = rh.pasture_id
      left join public.grasslands rg on rg.id = rp.grassland_id
      left join public.plains rpl on rpl.id = rg.plain_id
      where r.subject_id = m.id
    ),
    'descendants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'kind', r.kind,
        'role', r.role,
        'relative_id', sm.id,
        'name', sm.name,
        'phone', sm.phone,
        'home_phone', sm.home_phone,
        'gender', sm.gender,
        'is_child', sm.is_child,
        'has_account', (sm.app_user_id is not null),
        'photo_url', sm.photo_url,
        'pasture_name', sp.name,
        'grassland_name', sg.name,
        'plain_name', spl.name,
        'direction', 'descendant'
      ) order by
        coalesce(sm.is_child, false),
        case sm.gender when 'M' then 0 when 'F' then 1 else 2 end,
        sm.name,
        sm.id), '[]'::jsonb)
      from public.member_relations r
      join public.members sm on sm.id = r.subject_id and sm.status = 'active'
      left join public.households sh on sh.id = sm.household_id
      left join public.directory_pastures sp on sp.id = sh.pasture_id
      left join public.grasslands sg on sg.id = sp.grassland_id
      left join public.plains spl on spl.id = sg.plain_id
      where r.relative_id = m.id
        and r.kind <> 'spouse'
    )
  )
  from public.members m
  left join public.households h on h.id = m.household_id
  left join public.directory_pastures p on p.id = h.pasture_id
  left join public.grasslands g on g.id = p.grassland_id
  left join public.plains pl on pl.id = g.plain_id
  left join lateral (
    select p0.id, p0.status, p0.username
    from public.profiles p0
    where p0.id = m.app_user_id
       or p0.member_id = m.id
    order by
      case when p0.id = m.app_user_id then 0 else 1 end,
      case p0.status when 'active' then 0 when 'pending' then 1 else 2 end,
      p0.created_at desc nulls last
    limit 1
  ) pr on true
  where m.id = p_member_id
    and m.status = 'active';
$fn$;
REVOKE EXECUTE ON FUNCTION public.directory_member_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.directory_member_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.directory_member_profile(uuid) TO service_role;


-- 사후 확인 -------------------------------------------------------
DO $$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'directory_member_profile';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '중단: directory_member_profile 오버로드가 %개다(1개여야 함)', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'directory_member_profile'
    AND p.prosrc ~ 'get_user_role'
    AND p.prosecdef
    AND array_to_string(p.proconfig, ',') = 'search_path=public'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '중단: directory_member_profile 가드/권한/search_path 상태가 기대와 다르다';
  END IF;
  RAISE NOTICE 'directory_member_profile app_username staff 제한 적용 완료';
END
$$;
