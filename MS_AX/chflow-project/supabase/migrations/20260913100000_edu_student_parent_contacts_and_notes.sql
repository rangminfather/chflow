-- 학생 정보 관리 전용: 교적 가족관계와 별도로 여러 부모 연락처와 운영 비고를 보관한다.
ALTER TABLE public.edu_students
  ADD COLUMN IF NOT EXISTS parent_contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.edu_students
  DROP CONSTRAINT IF EXISTS edu_students_parent_contacts_array;

ALTER TABLE public.edu_students
  ADD CONSTRAINT edu_students_parent_contacts_array
  CHECK (jsonb_typeof(parent_contacts) = 'array');
