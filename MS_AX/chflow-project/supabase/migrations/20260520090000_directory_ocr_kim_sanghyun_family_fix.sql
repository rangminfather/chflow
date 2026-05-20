-- User-confirmed 김상현/김성현 family correction.
--
-- 김상현 is the p98 member with spouse 이효정 and children 김수민/김수아.
-- The p95 record in 정영교's household is 김성현, spouse-only/no-photo context.

update public.members
set name = '김성현',
    sub_role = '서리집사',
    spouse_name = '정영교',
    photo_url = null,
    photo_status = 'no_photo_in_pdf',
    photo_page = null
where id = 'f3a802c9-3c82-4e75-a890-5fcb51eae435'::uuid
  and status = 'active'
  and source_page = 95;

update public.members
set spouse_name = '김성현'
where id = 'c345efb5-2fcf-4250-9d12-22b8a1b6b967'::uuid
  and status = 'active'
  and name = '정영교'
  and source_page = 95;

update public.members
set sub_role = '시무집사',
    spouse_name = '이효정'
where id = 'b572e471-e0df-45b7-a044-260bf4bbaad8'::uuid
  and status = 'active'
  and name = '김상현'
  and source_page = 98;

update public.members
set spouse_name = '김상현'
where id = 'dd867551-39df-4fd2-ba5b-820452fbbab6'::uuid
  and status = 'active'
  and name = '이효정'
  and source_page = 98;
