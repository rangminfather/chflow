-- v3 엑셀 재임포트용: members 에 사진페이지/엑셀row# 컬럼 추가
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS photo_page integer,
  ADD COLUMN IF NOT EXISTS excel_row_no integer;

CREATE INDEX IF NOT EXISTS idx_members_photo_page ON public.members (photo_page);
CREATE INDEX IF NOT EXISTS idx_members_excel_row_no ON public.members (excel_row_no);
