-- =============================================================
-- 보안 긴급 패치 (CR-1, CR-2, CR-3)
-- 2026-06-12 / 보안성 검토 1차 조치
--
-- 모든 구문은 현행 DB 상태와 무관하게 안전하게 재적용 가능하도록
-- IF EXISTS / OR REPLACE / DROP ... IF EXISTS 로 작성.
-- =============================================================


-- =============================================================
-- CR-1. 권한 상승 차단 (profiles.role / profiles.status 자가 변경 금지)
--
-- 문제: profiles_update_own 정책에 컬럼 제한이 없어 일반 사용자가
--       자기 행의 role='admin', status='active' 로 직접 승격 가능.
--       또한 profiles_insert_own / 미사용 RPC 로 가입 시 role 주입 가능.
--
-- 해결: 직접 클라이언트 요청(role = authenticated/anon)에 한해
--       role/status 변경·권한 role 주입을 트리거로 차단.
--       SECURITY DEFINER 관리 함수(approve_user 등)와 service_role
--       백엔드는 current_user 가 authenticated/anon 이 아니므로 통과.
-- =============================================================

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- 직접 클라이언트 요청(authenticated/anon)만 제약한다.
  -- approve_user 등 SECURITY DEFINER 함수는 함수 소유자(postgres 등) 권한으로
  -- 실행되어 current_user 가 authenticated/anon 이 아니므로 여기서 통과한다.
  -- service_role 키(백엔드 /api/* )도 마찬가지로 통과한다.
  IF current_user IN ('authenticated', 'anon') THEN

    IF TG_OP = 'INSERT' THEN
      IF NEW.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION '가입 시 status 는 pending 이어야 합니다 (관리자 승인 후 활성화)';
      END IF;
      IF NEW.role IN ('admin', 'office') THEN
        RAISE EXCEPTION '해당 권한(role=%)으로는 직접 프로필을 생성할 수 없습니다', NEW.role;
      END IF;

    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'role 은 본인이 직접 변경할 수 없습니다 (관리자 승인 경로만 허용)';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'status 는 본인이 직접 변경할 수 없습니다 (관리자 승인 경로만 허용)';
      END IF;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_privileged ON public.profiles;
CREATE TRIGGER trg_guard_profile_privileged
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_privileged_columns();


-- CR-1 (보강) 미사용 고아 RPC create_profile_on_signup 차단
--   앱은 /api/signup(service_role) 직접 upsert 를 사용하며 이 RPC 는 호출하지 않음.
--   SECURITY DEFINER 라 위 트리거를 우회하므로, 권한 role 주입 검증 + EXECUTE 회수.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_profile_on_signup'
  ) THEN
    -- authenticated 가 직접 호출하지 못하도록 EXECUTE 회수
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.create_profile_on_signup(text, text, text, text, text) FROM authenticated';
  END IF;
END $$;


-- =============================================================
-- CR-2. 백업/스테이징 테이블 RLS 누락 (전 교인 PII 노출)
--   members_backup / households_backup / staging_members_mdb 에
--   RLS 미적용. 존재 시 RLS 활성화 + anon/authenticated 권한 회수.
-- =============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['members_backup', 'households_backup', 'staging_members_mdb'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
      -- 정책을 만들지 않으므로 default-deny: service_role/postgres 만 접근.
    END IF;
  END LOOP;
END $$;


-- =============================================================
-- CR-3. remove_member_relation 권한 검증 누락 (IDOR)
--   인자 ID 를 검증 없이 신뢰하여 누구나 남의 가족관계 삭제 가능.
--   다른 회원 관리 함수와 동일한 역할 집합으로 게이트.
-- =============================================================
CREATE OR REPLACE FUNCTION public.remove_member_relation(
  p_subject_id uuid, p_relative_id uuid, p_kind text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  DELETE FROM public.member_relations
  WHERE subject_id = p_subject_id AND relative_id = p_relative_id AND kind = p_kind;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_member_relation(uuid, uuid, text) TO authenticated;
