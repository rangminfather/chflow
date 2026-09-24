-- =============================================================
-- 교육일지 서식: 부서별 입력란 켜고/끄기
--
--   교육일지 화면은 전 교육부서가 같은 코드를 쓰지만, 부서마다 실제로
--   적는 항목이 다르다. (예: 유아부는 "합동"을 쓰고 초등1부는 안 쓴다)
--   그래서 항목 표시 여부만 부서별로 저장한다. 컬럼·RPC 는 그대로 공통.
--
--   기본값 = 전부 표시. 행이 없으면 보이는 것으로 본다(테이블이 비어도 현행 동작).
--   숨긴 항목의 기존 저장값은 건드리지 않는다 — 화면에서만 빠진다.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.edu_journal_field_settings (
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  field_key     text NOT NULL,
  is_visible    boolean NOT NULL DEFAULT true,
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, field_key)
);

ALTER TABLE public.edu_journal_field_settings ENABLE ROW LEVEL SECURITY;

-- 접근은 전부 아래 RPC 로만 (SECURITY DEFINER). 직접 접근 정책은 두지 않는다.
REVOKE ALL ON public.edu_journal_field_settings FROM anon, authenticated;


-- 켜고/끌 수 있는 항목 목록. 날짜는 일지의 키라서 뺄 수 없으므로 제외한다.
CREATE OR REPLACE FUNCTION public.edu_journal_field_keys()
RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'edu_topic',       -- 주제
    'scripture',       -- 본문 (성경)
    'leader',          -- 인도자
    'preacher',        -- 설교자
    'sermon_title',    -- 설교제목
    'prayer_lead',     -- 기도
    'praise',          -- 찬양
    'joint_activity',  -- 합동
    'lesson_content',  -- 공과내용
    'events',          -- 행사
    'class_stats',     -- 반별 출결표
    'sunday_stats',    -- 주일통계
    'offering',        -- 헌금
    'volunteers',      -- 봉사
    'prayer_requests'  -- 기도제목
  ];
$$;


-- ─────────────────────────────────────────
-- 조회: 부서원이면 누구나 (화면을 그리려면 필요)
--   저장된 행이 없는 항목은 is_visible = true 로 채워서 돌려준다.
--   can_edit 은 모든 행이 같은 값 — 설정 UI 를 띄울지 판단하는 용도로,
--   등급을 따로 물어보는 왕복을 없애려고 같이 실어 보낸다.
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_get_journal_fields(p_dept_id uuid)
RETURNS TABLE (field_key text, is_visible boolean, can_edit boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_can_edit boolean;
BEGIN
  IF NOT public.is_edu_member_or_admin(p_dept_id) THEN
    RAISE EXCEPTION '접근 권한이 없습니다';
  END IF;
  v_can_edit := public.get_user_grade(p_dept_id) <= 2;

  RETURN QUERY
  SELECT k.key AS field_key,
         coalesce(s.is_visible, true) AS is_visible,
         v_can_edit AS can_edit
  FROM unnest(public.edu_journal_field_keys()) WITH ORDINALITY AS k(key, ord)
  LEFT JOIN public.edu_journal_field_settings s
         ON s.department_id = p_dept_id AND s.field_key = k.key
  ORDER BY k.ord;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_get_journal_fields(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 저장: 임원진(등급 0~2)만. 부서관리 메뉴 설정과 같은 기준.
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.edu_set_journal_field(
  p_dept_id   uuid,
  p_field_key text,
  p_visible   boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;
  IF public.get_user_grade(p_dept_id) > 2 THEN
    RAISE EXCEPTION '교육일지 서식 설정은 임원진만 가능합니다';
  END IF;
  IF NOT (p_field_key = ANY (public.edu_journal_field_keys())) THEN
    RAISE EXCEPTION '알 수 없는 항목입니다: %', p_field_key;
  END IF;

  INSERT INTO public.edu_journal_field_settings
    (department_id, field_key, is_visible, updated_by, updated_at)
  VALUES (p_dept_id, p_field_key, coalesce(p_visible, true), auth.uid(), now())
  ON CONFLICT (department_id, field_key) DO UPDATE
    SET is_visible = excluded.is_visible,
        updated_by = excluded.updated_by,
        updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_set_journal_field(uuid, text, boolean) TO authenticated;


-- ─────────────────────────────────────────
-- 현행 상태 이관
--   2026-09-20 에 합동·공과내용 입력란을 코드에서 없앴는데, 그건 초등1부 기준
--   판단이었다. 유아부는 "합동"(joint_activity)을 실제로 쓰고 있었으므로
--   초등1부만 끈 상태로 옮기고 나머지 부서는 기본값(표시)으로 되돌린다.
-- ─────────────────────────────────────────
INSERT INTO public.edu_journal_field_settings (department_id, field_key, is_visible)
SELECT d.id, k.key, false
FROM public.departments d
CROSS JOIN unnest(ARRAY['joint_activity', 'lesson_content']) AS k(key)
WHERE d.name = '초등1부'
ON CONFLICT (department_id, field_key) DO NOTHING;
