-- =============================================================
-- authenticated 사용자 간 권한 범위(horizontal authorization) 정리
--
-- 배경: anon 회수(20260823180000) 후 남은 항목 — "로그인만 하면 다른 사용자·다른
--   부서 정보를 조회할 수 있는 RPC" 를 live DB 기준으로 조사했다.
--
-- 조사 결과(2026-08-23, live pg_proc + 실제 호출 실측):
--
--  (a) admin_member_profile(uuid)  ← 수정
--      to_jsonb(m) 으로 members 전체 컬럼을 내보내 필드 74개를 반환한다.
--      일반 요람(directory_member_profile, 61개)에는 없는 관리자 전용 정보가 포함:
--        notes(내부 메모), review_note/review_status/reviewed_at/reviewed_by(검수),
--        status/guard_status/account_state/withdrawn_at/withdrawn_by/
--        withdrawal_reason(계정·탈퇴), email, source_page, excel_row_no,
--        legacy_kyoin_id/legacy_family_num, photo_status/photo_page,
--        address_base/detail/zonecode
--      앱 호출처는 components/MemberCardModal → app/admin/members 뿐이고 그 화면은
--      profiles.role in (admin,office,pastor) 게이트를 쓴다. 그런데 RPC 자체에는
--      권한 검사가 없어 아무 로그인 사용자가 직접 호출하면 위 정보를 다 볼 수 있다.
--      → 프로젝트 표준 assert_staff() 를 본문 맨 앞에 추가한다(같은 role 집합).
--        본문 SELECT 는 live 정의를 그대로 옮겼고, 가드를 넣기 위해 LANGUAGE 만
--        sql → plpgsql 로 바꿨다(반환·시그니처·결과 동일).
--
--  (b) 앱에서 전혀 호출하지 않는 3개  ← EXECUTE 축소
--      dept_list_children(uuid)          아동 이름·학년·담임 (미성년자 명단)
--      list_classes_with_teachers(uuid)  반·담임·학생수 (부서 관리 데이터)
--      admin_review_member_flags(uuid)   검수 플래그
--      저장소 전체(chflow-app / chflow-expo / MS_AX / scripts) 검색 결과 호출부 0건.
--      본문을 고쳐 가드를 넣는 것보다 authenticated EXECUTE 를 회수하는 것이
--      더 확실하고 회귀 위험이 없다(호출자가 없으므로). service_role 은 유지해
--      서버 경유 사용 여지를 남긴다.
--      특히 admin_review_member_flags 는 본문에 인코딩이 깨진 한글 리터럴이 있어
--      재작성 시 값이 바뀔 위험이 있다 — grant 만 조정한 이유이기도 하다.
--
--  (c) 정책상 의도된 전체 공개로 판단해 그대로 둔 것 (변경 없음)
--      directory_tree()            평·초원·목장 트리(개인정보 없음) — 요람 내비게이션
--      directory_member_profile()  성도 요람 본문. 로그인 교인이 서로 조회하는 것이
--                                  서비스 의도. get_family_tree 가 돌려주는
--                                  이름·전화는 이 함수가 이미 공개하는 범위의
--                                  부분집합이라 별도 권한 상승이 아니다.
--      get_family_tree(uuid)       위와 같은 이유. 부서 화면 2곳에서 사용 중이고
--                                  가드 기준(성도 단위 범위)은 정책 결정이 필요해
--                                  임의로 좁히지 않는다.
--      admin_list_all_departments() 부서 id·이름·아이콘 + 인원 카운트. 부서명은
--                                  /departments 에서 이미 공개되고 카운트는 집계값
--                                  이라 이름만 보고 잠그지 않는다(보고만).
--
-- 권한 정책(role 집합, grade 범위)은 바꾸지 않았다. 새 권한 함수도 만들지 않았다.
-- 기존 migration 수정 없음. CASCADE 없음.
-- =============================================================

-- (a) 관리자 전용 프로필: 표준 가드 추가 -------------------------
CREATE OR REPLACE FUNCTION public.admin_member_profile(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- 관리자 화면 전용 RPC — 프론트 메뉴 숨김만으로 경계를 삼지 않는다
  PERFORM public.assert_staff();

  RETURN (
  SELECT jsonb_build_object(
    'member', to_jsonb(m) || jsonb_build_object(
      'address', h.address,
      'home_phone', h.home_phone,
      'pasture_name', p.name,
      'grassland_name', g.name,
      'plain_name', pl.name
    ),
    'household_members', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', mm.id, 'name', mm.name, 'phone', mm.phone,
        'family_church', mm.family_church, 'sub_role', mm.sub_role,
        'is_child', mm.is_child, 'photo_url', mm.photo_url, 'gender', mm.gender
      ) ORDER BY mm.is_child, mm.name)
      FROM public.members mm WHERE mm.household_id = m.household_id AND mm.id <> m.id
    ),
    'relations', (
      SELECT jsonb_agg(jsonb_build_object(
        'kind', r.kind, 'role', r.role,
        'relative_id', r.relative_id,
        'name', rm.name, 'phone', rm.phone,
        'photo_url', rm.photo_url,
        'pasture_name', rp.name,
        'plain_name', rpl.name,
        'direction', 'ancestor'
      ))
      FROM public.member_relations r
      JOIN public.members rm ON rm.id = r.relative_id
      LEFT JOIN public.households rh ON rm.household_id = rh.id
      LEFT JOIN public.directory_pastures rp ON rh.pasture_id = rp.id
      LEFT JOIN public.grasslands rg ON rp.grassland_id = rg.id
      LEFT JOIN public.plains rpl ON rg.plain_id = rpl.id
      WHERE r.subject_id = p_member_id
    ),
    'descendants', (
      SELECT jsonb_agg(jsonb_build_object(
        'kind', r.kind, 'role', r.role,
        'relative_id', r.subject_id,
        'name', sm.name, 'phone', sm.phone,
        'photo_url', sm.photo_url,
        'pasture_name', sp.name,
        'plain_name', spl.name,
        'direction', 'descendant',
        'is_child', sm.is_child,
        'has_account', (sm.app_user_id IS NOT NULL)
      ))
      FROM public.member_relations r
      JOIN public.members sm ON sm.id = r.subject_id
      LEFT JOIN public.households sh ON sm.household_id = sh.id
      LEFT JOIN public.directory_pastures sp ON sh.pasture_id = sp.id
      LEFT JOIN public.grasslands sg ON sp.grassland_id = sg.id
      LEFT JOIN public.plains spl ON sg.plain_id = spl.id
      WHERE r.relative_id = p_member_id AND r.kind <> 'spouse'
    )
  )
  FROM public.members m
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN public.directory_pastures p ON h.pasture_id = p.id
  LEFT JOIN public.grasslands g ON p.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  WHERE m.id = p_member_id
  );
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.admin_member_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_member_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_member_profile(uuid) TO service_role;


-- (b) 앱 미사용 함수: authenticated EXECUTE 회수 -------------------
REVOKE EXECUTE ON FUNCTION public.dept_list_children(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.dept_list_children(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.list_classes_with_teachers(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.list_classes_with_teachers(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_review_member_flags(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_review_member_flags(uuid) TO service_role;


-- 사후 확인 -------------------------------------------------------
DO $$
DECLARE r record; v_bad int := 0; v_cnt int;
BEGIN
  -- 미사용 3개: authenticated 실행 불가여야 한다
  FOR r IN
    SELECT p.proname n, has_function_privilege('authenticated', p.oid, 'EXECUTE') ax,
           has_function_privilege('service_role', p.oid, 'EXECUTE') sx
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname IN ('dept_list_children','list_classes_with_teachers','admin_review_member_flags')
  LOOP
    IF r.ax OR NOT r.sx THEN
      RAISE WARNING '기대와 다름: %(auth=%, svc=%)', r.n, r.ax, r.sx;
      v_bad := v_bad + 1;
    END IF;
  END LOOP;

  -- admin_member_profile: authenticated 유지 + assert_staff 포함 + 오버로드 1개
  SELECT count(*) INTO v_cnt
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'admin_member_profile';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '중단: admin_member_profile 오버로드가 %개다(1개여야 함)', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'admin_member_profile'
    AND p.prosrc ~ 'assert_staff'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '중단: admin_member_profile 가드/권한 상태가 기대와 다르다';
  END IF;

  IF v_bad > 0 THEN
    RAISE EXCEPTION '중단: grant 상태가 기대와 다른 함수 %개', v_bad;
  END IF;
  RAISE NOTICE 'horizontal authz 정리 완료';
END
$$;
