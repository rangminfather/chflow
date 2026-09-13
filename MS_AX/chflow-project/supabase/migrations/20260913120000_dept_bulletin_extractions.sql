-- 교육부서 주보의 형식별 추출 결과를 한 곳에 보관한다.
-- 원본은 bulletins 에 유지하고, PDF/HWP/HWPX/PPTX/OCR 결과만 캐시한다.
create table if not exists public.dept_bulletin_extractions (
  bulletin_id uuid primary key references public.bulletins(id) on delete cascade,
  extracted_text text not null default '',
  fields jsonb not null default '{}'::jsonb,
  extraction_method text not null check (extraction_method in ('native', 'ocr')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dept_bulletin_extractions enable row level security;
