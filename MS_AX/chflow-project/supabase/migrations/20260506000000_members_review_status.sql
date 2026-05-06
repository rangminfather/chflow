-- 데이터 검수: members 테이블에 review_status 컬럼 추가
-- 원본 PDF(교회요람)와 비교하여 OCR 등록 데이터 정합성 검증용
-- 상태값: unreviewed | verified | needs_check

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'members_review_status_check'
  ) THEN
    ALTER TABLE public.members
      ADD CONSTRAINT members_review_status_check
      CHECK (review_status IN ('unreviewed', 'verified', 'needs_check'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_members_review_status ON public.members(review_status);
