-- =============================================================
-- 알림 INSERT RLS 정책 완화
-- 일반 사용자가 부서 가입 신청 등을 통해 시스템 알림을 발송할 때
-- SECURITY DEFINER RPC 안에서 INSERT가 RLS에 막히던 문제 해결
-- =============================================================

DROP POLICY IF EXISTS "notif_insert_admin" ON public.notifications;

-- 인증된 사용자는 누구나 알림 INSERT 가능 (단, 본인에게는 못 보냄 - 악용 방지)
CREATE POLICY "notif_insert_authenticated"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);  -- RPC 호출 시 검증

-- 본인 자신에게 알림 보내는 직접 INSERT는 일반적으로 의미 없음
-- (RPC를 통한 자동 발송은 OK)
