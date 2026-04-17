-- =============================================================
-- 부서/사역 섬김 명단: 한 사람이 여러 부서/사역에 소속될 수 있음
-- =============================================================

CREATE TABLE IF NOT EXISTS public.member_ministries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  ministry    text NOT NULL,         -- 영아부/유아부/찬양대(에이레네)/생명의삶 등
  role        text,                  -- 담당/교사/부장/찬양사 등 (선택)
  notes       text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (member_id, ministry, role)
);

CREATE INDEX IF NOT EXISTS idx_member_ministries_member   ON public.member_ministries (member_id);
CREATE INDEX IF NOT EXISTS idx_member_ministries_ministry ON public.member_ministries (ministry);

ALTER TABLE public.member_ministries ENABLE ROW LEVEL SECURITY;

-- 로그인 사용자 조회 가능
DROP POLICY IF EXISTS member_ministries_select ON public.member_ministries;
CREATE POLICY member_ministries_select ON public.member_ministries
  FOR SELECT TO authenticated USING (true);

-- admin/office/pastor 만 쓰기
DROP POLICY IF EXISTS member_ministries_write ON public.member_ministries;
CREATE POLICY member_ministries_write ON public.member_ministries
  FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin','office','pastor'))
  WITH CHECK (public.get_user_role() IN ('admin','office','pastor'));
