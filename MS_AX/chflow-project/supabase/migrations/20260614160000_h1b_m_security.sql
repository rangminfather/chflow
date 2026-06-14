-- =============================================================
-- 보안 H-1b + M 항목 통합 패치
-- 2026-06-14
--
-- ① H-1b: edu_talent_rules 쓰기 권한 상향
--    문제: WITH CHECK 가 is_edu_member_or_admin(부서원 전체)라
--          학부모(grade 4)·교사(grade 3)도 달란트 규칙 추가·수정·삭제 가능.
--    조치: 읽기(SELECT)는 부서원 전체 허용 유지, 쓰기(INSERT/UPDATE/DELETE)는
--          grade 0~2 (관리자/부장/총무/서기)만 허용.
--
-- ② M: edu_talent_records 직접쓰기 차단
--    문제: edu_save_talent RPC(H-1 적용 완료)를 우회해 클라이언트가
--          edu_talent_records 에 직접 INSERT/UPDATE/DELETE 가능.
--    조치: 쓰기 정책을 grade 0~2 로 제한, RPC(SECURITY DEFINER)는
--          postgres 소유자 권한으로 실행되므로 영향 없음.
-- =============================================================

-- ─── ① edu_talent_rules ─────────────────────────────────────
DROP POLICY IF EXISTS "talent_rules_rls" ON public.edu_talent_rules;

CREATE POLICY "talent_rules_select"
  ON public.edu_talent_rules FOR SELECT
  USING (public.is_edu_member_or_admin(department_id));

CREATE POLICY "talent_rules_write"
  ON public.edu_talent_rules FOR INSERT
  WITH CHECK (public.get_user_grade(department_id) <= 2);

CREATE POLICY "talent_rules_update"
  ON public.edu_talent_rules FOR UPDATE
  USING  (public.get_user_grade(department_id) <= 2)
  WITH CHECK (public.get_user_grade(department_id) <= 2);

CREATE POLICY "talent_rules_delete"
  ON public.edu_talent_rules FOR DELETE
  USING  (public.get_user_grade(department_id) <= 2);


-- ─── ② edu_talent_records 직접쓰기 차단 ─────────────────────
DO $$
BEGIN
  -- 기존 all-허용 정책이 있으면 DROP
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.edu_talent_records'::regclass
      AND polname = 'talent_records_rls'
  ) THEN
    DROP POLICY "talent_records_rls" ON public.edu_talent_records;
  END IF;
END $$;

-- SELECT: 부서원 전체
CREATE POLICY "talent_records_select"
  ON public.edu_talent_records FOR SELECT
  USING (public.is_edu_member_or_admin(department_id));

-- 쓰기: grade 0~2 직접쓰기 허용 (RPC는 SECURITY DEFINER 라 우회)
CREATE POLICY "talent_records_write"
  ON public.edu_talent_records FOR INSERT
  WITH CHECK (public.get_user_grade(department_id) <= 2);

CREATE POLICY "talent_records_update"
  ON public.edu_talent_records FOR UPDATE
  USING  (public.get_user_grade(department_id) <= 2)
  WITH CHECK (public.get_user_grade(department_id) <= 2);

CREATE POLICY "talent_records_delete"
  ON public.edu_talent_records FOR DELETE
  USING  (public.get_user_grade(department_id) <= 2);
