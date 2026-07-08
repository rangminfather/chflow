-- 학생정보관리 단건 등록/일괄 업로드용 보조 인적사항.
-- 교적(members)과 연결되지 않은 교육사역국 학생도 연락처/생년월일/주소를 보존한다.

alter table public.edu_students
  add column if not exists gender text check (gender in ('M','F')),
  add column if not exists birth_date date,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists school_name text;

create index if not exists idx_edu_students_phone
  on public.edu_students(department_id, phone)
  where phone is not null;
