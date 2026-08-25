-- =============================================================
-- admin_list_all_departments(): 서버측 관리자 검사 추가
--
-- 정책성 잔여 3건 중 2번 항목. 이전 감사(20260823200000)에서 "이름만 보고 잠그지
-- 않는다"는 원칙으로 보류했던 함수를, 실제 호출 경로를 다시 확인한 뒤 정리한다.
--
-- 조사(2026-08-23, live pg_proc + 저장소 전수 검색):
--   현재 정의 : LANGUAGE sql, STABLE SECURITY DEFINER, search_path=public,
--               인자 없음, 오버로드 1개, anon=f / authenticated=t / service_role=t
--   반환      : departments(is_active=true) 의 id·category·name·icon +
--               approved/pending 인원 집계 카운트
--   호출부    : chflow-app/app/admin/dept-pending/page.tsx 한 곳뿐.
--               그 화면은 get_my_status 로 role in (admin,office,pastor) 를 확인한다.
--   service_role 호출부 : 없음 (API 라우트·크론·스크립트 전수 검색 0건)
--   → 기능 목적이 관리자 화면 전용인데 서버측 검사가 없어, 아무 로그인 사용자가
--     직접 호출하면 전 부서의 가입 대기/승인 인원 집계를 볼 수 있었다.
--
-- 조치: 프로젝트 표준 assert_staff() 를 본문 앞에 추가한다.
--   assert_staff() = profiles.status='active' AND role IN (admin,office,pastor)
--   이며 이미 8개 함수가 쓰는 기존 표준이다(새 권한 함수 만들지 않음).
--   가드를 넣기 위해 LANGUAGE 만 sql → plpgsql 로 바꾸고, SELECT 본문은 live
--   정의를 그대로 옮겼다. 반환 타입·시그니처·정렬은 동일하다.
--
-- assert_staff() 자체는 수정하지 않는다. auth.uid() 가 없는 service_role 직접
--   호출을 거부하는 특성도 그대로 둔다(기존 8개 함수와 동일, 호출부 없음).
--
-- 기존 migration 수정 없음. CASCADE 없음. grant 는 현행 유지
--   (anon 은 20260823180000 에서 이미 회수됨).
-- =============================================================

CREATE OR REPLACE FUNCTION public.admin_list_all_departments()
RETURNS TABLE (
  id uuid,
  category text,
  name text,
  icon text,
  member_count bigint,
  pending_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- 관리자 화면 전용 RPC — 프론트 메뉴 숨김만으로 경계를 삼지 않는다
  PERFORM public.assert_staff();

  RETURN QUERY
  SELECT
    d.id,
    d.category,
    d.name,
    d.icon,
    (SELECT COUNT(*) FROM public.department_members dm WHERE dm.department_id = d.id AND dm.status = 'approved') AS member_count,
    (SELECT COUNT(*) FROM public.department_members dm WHERE dm.department_id = d.id AND dm.status = 'pending') AS pending_count
  FROM public.departments d
  WHERE d.is_active = true
  ORDER BY d.category, d.order_no, d.name;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.admin_list_all_departments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_all_departments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_all_departments() TO service_role;


-- 사후 확인 -------------------------------------------------------
DO $$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_list_all_departments';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '중단: admin_list_all_departments 오버로드가 %개다(1개여야 함)', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_list_all_departments'
    AND p.prosrc ~ 'assert_staff'
    AND p.prosecdef
    AND array_to_string(p.proconfig, ',') = 'search_path=public'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '중단: admin_list_all_departments 가드/권한/search_path 상태가 기대와 다르다';
  END IF;
  RAISE NOTICE 'admin_list_all_departments assert_staff 적용 완료';
END
$$;
