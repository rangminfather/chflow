-- =============================================================
-- 달란트 리셋 권한 회수 — 임원(grade 0~2)만 리셋 기록/취소 가능
--   조회는 부서 구성원 전체 (통장 잔액 계산에 필요)
--   리셋일은 반기 말일(6/30·12/31)로 기록 → 늦게 눌러도 다음 반기 체크 보존
-- =============================================================

DROP POLICY IF EXISTS "talent_resets_rls" ON public.edu_talent_resets;
DROP POLICY IF EXISTS "talent_resets_select" ON public.edu_talent_resets;
DROP POLICY IF EXISTS "talent_resets_insert" ON public.edu_talent_resets;
DROP POLICY IF EXISTS "talent_resets_delete" ON public.edu_talent_resets;

CREATE POLICY "talent_resets_select" ON public.edu_talent_resets
  FOR SELECT USING (public.is_edu_member_or_admin(department_id));

CREATE POLICY "talent_resets_insert" ON public.edu_talent_resets
  FOR INSERT WITH CHECK (public.get_user_grade(department_id) <= 2);

CREATE POLICY "talent_resets_delete" ON public.edu_talent_resets
  FOR DELETE USING (public.get_user_grade(department_id) <= 2);
