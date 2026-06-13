-- =============================================================
-- pastor 권한 구조 A안: 직분(표시) ↔ 권한(authz) 분리 — 방어심화
-- 2026-06-14 / 보안성 검토 후속 (SECURITY_REVIEW_2026-06.md §3 참조)
--
-- 배경: 'pastor'는 가입에서 자가 선택 가능한 직분인데 동시에 권한 집합
--       (admin/office/pastor)에 포함되어, 자가 가입한 목사가 승인되면
--       staff 권한(전 교인 조회 등)을 자동 획득했다.
--
-- A안: 직분은 sub_role 로 표시·보존하고, 권한 role 은 가입으로 부여하지 않는다.
--   - 앱: /api/signup 이 authz role(admin/office/pastor)을 'member' 로 중립화하여 저장.
--   - DB(본 마이그레이션): CR-1 트리거의 직접삽입 차단 집합에 'pastor' 추가(방어심화).
--     (정상 가입은 service_role 경로라 트리거를 우회하지만, 앱에서 이미 중립화하므로
--      여기서는 UI 우회·직접 PostgREST INSERT 로 role='pastor' 를 넣는 경로를 막는다.)
--
-- 데이터: 본 작성 시점 role IN ('pastor','office') 프로필은 status 무관 0건 → backfill 불필요.
--         이후 staff 권한 부여는 관리자가 의도적으로 수행한다(현재는 service_role 경로).
--
-- 재적용 안전(OR REPLACE). 트리거 본문은 기존(20260612110000)과 동일하며
-- INSERT 차단 집합에 'pastor' 만 추가했다.
-- =============================================================

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- 직접 클라이언트 요청(authenticated/anon)만 제약한다.
  -- approve_user 등 SECURITY DEFINER 함수와 service_role(/api/*) 백엔드는
  -- current_user 가 authenticated/anon 이 아니므로 여기서 통과한다.
  IF current_user IN ('authenticated', 'anon') THEN

    IF TG_OP = 'INSERT' THEN
      IF NEW.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION '가입 시 status 는 pending 이어야 합니다 (관리자 승인 후 활성화)';
      END IF;
      -- A안: 권한 role 은 가입(직접삽입)으로 부여 불가. pastor 도 권한 role 이므로 포함.
      IF NEW.role IN ('admin', 'office', 'pastor') THEN
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

-- 트리거 자체는 20260612110000 에서 이미 생성됨. 함수만 교체하면 적용된다.
-- (재적용 안전을 위해 트리거 재생성도 포함)
DROP TRIGGER IF EXISTS trg_guard_profile_privileged ON public.profiles;
CREATE TRIGGER trg_guard_profile_privileged
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_privileged_columns();
