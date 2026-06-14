-- =============================================================
-- 보안 H-3: 가입 조회 RPC PUBLIC(anon 포함) GRANT 회수
-- 2026-06-14 / 보안성 검토 H-3 조치
--
-- 문제: find_member_for_signup 등 가입 매칭 RPC가 PUBLIC에 GRANT(=X/postgres)되어
--       anon 키로 PostgREST 직접 호출 가능.
--       이름+전화번호만 알면 주소·생년월일·배우자·사진 등 전체 PII 열거 가능.
--
-- 조치: PUBLIC EXECUTE 회수 후 authenticated·service_role·postgres 만 재부여.
--       앱은 /api/signup/find-member|find-child|find-parent 서버 route를
--       경유해 service_role로 호출한다.
--
-- 재적용 안전(REVOKE IF EXISTS 효과 — 없으면 에러 없이 통과).
-- =============================================================

-- find_member_for_signup
REVOKE EXECUTE ON FUNCTION public.find_member_for_signup(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_member_for_signup(text, text) TO authenticated, service_role, postgres;

-- find_child_for_signup
REVOKE EXECUTE ON FUNCTION public.find_child_for_signup(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_child_for_signup(text, text, text) TO authenticated, service_role, postgres;

-- find_parent_for_child_signup
REVOKE EXECUTE ON FUNCTION public.find_parent_for_child_signup(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_parent_for_child_signup(text, text) TO authenticated, service_role, postgres;

-- search_member_candidates (인증된 관리자·앱 경로에서만 사용)
REVOKE EXECUTE ON FUNCTION public.search_member_candidates(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_member_candidates(text, text, integer) TO authenticated, service_role, postgres;
