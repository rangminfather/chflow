-- Password reset audit log — 관리자가 사용자 비밀번호 초기화 시 누가/언제/누구 reset 했는지 기록
-- service role 만 INSERT (api/admin/reset-password endpoint 가 service role 사용)
-- admin 사용자만 조회 가능

CREATE TABLE IF NOT EXISTS public.password_reset_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID,
  admin_username TEXT NOT NULL,
  target_id UUID NOT NULL,
  target_username TEXT NOT NULL,
  target_name TEXT,
  reason TEXT,
  reset_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_log_target ON public.password_reset_log(target_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_log_admin ON public.password_reset_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_log_at ON public.password_reset_log(reset_at DESC);

ALTER TABLE public.password_reset_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_select_reset_log" ON public.password_reset_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );
