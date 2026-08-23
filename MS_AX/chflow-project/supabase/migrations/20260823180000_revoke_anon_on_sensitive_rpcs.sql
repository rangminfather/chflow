-- =============================================================
-- RPC 익명(anon) 실행 권한 회수 — 실측으로 확인된 정보노출만 최소 범위로 차단
--
-- 배경: list_dept_eligible_for_teacher 에서 발견된 패턴(SECURITY DEFINER +
--   PUBLIC/anon EXECUTE + 내부 호출자 검증 없음)이 다른 RPC 에도 남아 있는지
--   live pg_proc 로 전수 조사했다.
--
-- 조사 결과(2026-08-23, 프로덕션):
--   public 함수 349 / SECURITY DEFINER 332 / anon EXECUTE 315 / secdef+anon 302
--   그중 auth.uid() 를 직접·1단계 참조도 하지 않는 '무가드' 함수 38개.
--   38개를 실제 anon 키로 호출해 확인한 노출(대표):
--     directory_tree()                  → 전 교인 명부 89건
--     dept_list_children(dept)          → 부서 아동 명단 39건
--     list_teachers_status(dept)        → 교사 명단 15건
--     list_classes_with_teachers(dept)  → 반·담임 11건
--     get_family_tree(member)           → 가족관계 6건
--     directory_member_profile(member)  → 개인 상세 1건
--     admin_member_profile(member)      → 개인 상세 1건
--     admin_list_all_departments()      → 부서 목록 6건
--   반면 dept_search_members_for_appoint / list_dept_grade_members /
--   promote_preview 는 내부 가드가 실제로 동작해 anon 거부됐다(수정 대상 아님).
--
-- 이 마이그레이션이 하는 일 (전부 최소 조치):
--   1) 아래 함수들의 PUBLIC/anon EXECUTE 회수. 앱은 전부 로그인 후 화면에서만
--      호출하므로(호출부 전수 확인) authenticated 는 건드리지 않는다.
--   2) 서버(service_role)·크론·DB 내부 헬퍼 전용 함수도 anon 회수.
--      SECURITY DEFINER 내부 호출은 소유자 권한으로 실행되므로 영향 없다.
--   3) list_classes_with_teachers: 유일하게 search_path 가 고정돼 있지 않던
--      SECURITY DEFINER 함수 → ALTER FUNCTION 으로 search_path 만 고정(본문 불변).
--   4) list_teachers_status: 호출부가 반 관리·사역 가입 승인 두 화면(둘 다
--      get_user_grade <= 2 게이트)뿐이라, 같은 기준의 호출자 가드를 넣어
--      타부서 로그인 사용자의 교사 명단 조회도 막는다.
--
-- 하지 않는 것 (보고만):
--   - anon 이 필요한 가입 플로우 함수(check_username_available, list_signup_pastures)와
--     공개 성경 데이터 함수는 그대로 둔다.
--   - directory_* / admin_member_profile / get_family_tree 등의 '로그인 사용자 간
--     범위 제한'(유형 4)은 화면별 정책 확인이 필요해 이번에 손대지 않는다.
--   - 전체 PUBLIC EXECUTE 일괄 회수, grade/role 정책 변경, 미사용 함수 DROP 없음.
-- =============================================================

-- 1) 개인정보·내부정보 조회 (로그인 후 화면 전용) ------------------
REVOKE EXECUTE ON FUNCTION public.directory_tree() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.directory_member_profile(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_member_profile(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_review_member_flags(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_all_departments() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_family_tree(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dept_list_children(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_teachers_status(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_classes_with_teachers(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_student_auto_talent(uuid, integer, integer, integer, integer) FROM PUBLIC, anon;

-- 2) 서버·크론·내부 헬퍼 전용 --------------------------------------
--    edu_emit_* 는 app/api/cron/promotion-upcoming 에서 service_role 로만 호출한다.
REVOKE EXECUTE ON FUNCTION public.edu_emit_absence_alerts(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.edu_emit_promotion_upcoming(text, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_usage_take_snapshot() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._emit_promo_notif(uuid, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.edu_merge_teacher_into(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.edu_sync_roster_member(uuid, uuid, uuid, smallint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.edu_next_teacher_order(uuid) FROM PUBLIC, anon;

-- service_role 은 유지(크론·서버 경유 호출)
GRANT EXECUTE ON FUNCTION public.edu_emit_absence_alerts(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.edu_emit_promotion_upcoming(text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_usage_take_snapshot() TO service_role;

-- 3) 유일하게 search_path 미고정이던 SECURITY DEFINER 함수 ----------
--    본문은 건드리지 않고 설정만 고정한다.
ALTER FUNCTION public.list_classes_with_teachers(uuid) SET search_path = public;

-- 4) list_teachers_status: 호출자 가드 추가 ------------------------
--    live 정의(pg_get_functiondef)를 그대로 옮기고 가드만 앞에 붙였다.
--    기준은 호출 화면(반 관리 / 사역 가입 승인)의 게이트와 동일한 get_user_grade <= 2.
CREATE OR REPLACE FUNCTION public.list_teachers_status(p_dept_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  member_id uuid,
  user_id uuid,
  is_placeholder boolean,
  is_active boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_grade smallint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;
  v_caller_grade := public.get_user_grade(p_dept_id);
  IF v_caller_grade IS NULL OR v_caller_grade > 2 THEN
    RAISE EXCEPTION '권한 없음 (임원진 또는 관리자만 조회 가능)';
  END IF;

  RETURN QUERY
  SELECT
    et.id,
    et.name,
    et.member_id,
    et.user_id,
    (et.member_id IS NULL AND et.user_id IS NULL) AS is_placeholder,
    et.is_active
  FROM public.edu_teachers et
  WHERE et.department_id = p_dept_id
  ORDER BY et.is_active DESC, et.name;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.list_teachers_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_teachers_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_teachers_status(uuid) TO service_role;


-- 사후 확인: 대상 함수의 anon 권한이 모두 사라졌는지 + 오버로드 수 이상 없는지
DO $$
DECLARE r record; v_bad int := 0;
BEGIN
  FOR r IN
    SELECT p.proname n, pg_get_function_identity_arguments(p.oid) a,
           has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname IN (
      'directory_tree','directory_member_profile','admin_member_profile','admin_review_member_flags',
      'admin_list_all_departments','get_family_tree','dept_list_children','list_teachers_status',
      'list_classes_with_teachers','get_student_auto_talent','edu_emit_absence_alerts',
      'edu_emit_promotion_upcoming','admin_usage_take_snapshot','_emit_promo_notif',
      'edu_merge_teacher_into','edu_sync_roster_member','edu_next_teacher_order')
  LOOP
    IF r.anon_x THEN
      RAISE WARNING '아직 anon 실행 가능: %(%)', r.n, r.a;
      v_bad := v_bad + 1;
    END IF;
  END LOOP;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '중단: anon 회수가 안 된 함수 %개', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'list_teachers_status';
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '중단: list_teachers_status 오버로드가 %개다(1개여야 함)', v_bad;
  END IF;
  RAISE NOTICE 'anon 회수 완료 · list_teachers_status 오버로드 1개';
END
$$;
