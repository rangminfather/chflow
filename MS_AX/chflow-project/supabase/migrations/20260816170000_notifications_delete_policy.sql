-- notifications 의 DELETE RLS 정책을 마이그레이션으로 고정한다.
--
-- 배경: 알림 목록의 X 버튼·전체삭제는 클라이언트에서 테이블을 직접 delete 한다.
-- 프로덕션에는 정상 동작하는 DELETE 정책이 있었지만(2026-08-16 실측: 본인 것만
-- 삭제되고 타인 알림은 0행) 그 정책이 마이그레이션 어디에도 없어서,
-- DB를 재구축하면 삭제가 조용히 실패하는 상태였다.
--
-- 이름이 다른 기존 DELETE 정책이 있을 수 있으므로 전부 걷어내고 표준 이름 하나로 통일한다.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications' AND cmd = 'DELETE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.notifications', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "notif_delete_own"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
