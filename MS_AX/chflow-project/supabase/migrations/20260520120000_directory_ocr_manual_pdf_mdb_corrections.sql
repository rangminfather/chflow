-- Directory OCR corrections confirmed by original PDF pages and MDB staging.

update public.members
set name = '박순자',
    sub_role = '서리집사',
    spouse_name = '안용기',
    phone = '',
    home_phone = '(052)234-6965',
    photo_status = 'no_photo_in_pdf',
    photo_page = null,
    relationship_in_household = '처'
where id = 'fbe0acfb-0252-4cd6-a292-8c999f0448dc'::uuid
  and status = 'active';

update public.members
set sub_role = '성도',
    spouse_name = '박순자'
where id = 'f16b71c9-beeb-451c-a4b8-b91a63dc99f1'::uuid
  and status = 'active';

update public.members
set status = 'active',
    source_page = 88,
    is_child = true,
    sub_role = '',
    spouse_name = '',
    phone = '',
    home_phone = '(052)234-6965',
    photo_status = 'no_photo_in_pdf',
    photo_page = null,
    relationship_in_household = '자',
    household_id = 'a2e4bb3a-1d58-4372-bd6b-dcd64a1536b6'::uuid
where id = 'a8b00caa-6c31-4203-ac9d-ba22c9173772'::uuid;

insert into public.member_relations (subject_id, relative_id, kind, role)
values
  ('a8b00caa-6c31-4203-ac9d-ba22c9173772'::uuid, 'f16b71c9-beeb-451c-a4b8-b91a63dc99f1'::uuid, 'parent', 'father'),
  ('a8b00caa-6c31-4203-ac9d-ba22c9173772'::uuid, 'fbe0acfb-0252-4cd6-a292-8c999f0448dc'::uuid, 'parent', 'mother')
on conflict (subject_id, relative_id, kind)
do update set role = excluded.role;

update public.members
set name = '윤경숙',
    sub_role = '집사',
    spouse_name = '박순형',
    phone = '010-8716-6527'
where id = '1129547b-d1a2-4784-8d8e-584fc0a7b5d1'::uuid
  and status = 'active';

update public.members
set name = '박순형',
    sub_role = '집사',
    spouse_name = '윤경숙',
    phone = '010-7551-6537'
where id = '6f433f08-d26d-443b-a899-06f6c1d7cc45'::uuid
  and status = 'active';

update public.members
set name = '김은순',
    sub_role = '권사',
    spouse_name = '전송수',
    phone = '010-4757-1750'
where id = 'f526a8ee-8397-4cdd-91fc-1e27c6560e52'::uuid
  and status = 'active';

update public.members
set spouse_name = '김은순'
where id = '2e26ba2f-b2a7-4a00-9d42-652e03de7dea'::uuid
  and status = 'active';

update public.members
set name = '박수진',
    sub_role = '집사',
    spouse_name = '선우석',
    phone = '010-5504-2898',
    relationship_in_household = '처'
where id = '47ad29d7-bfb1-4283-a97f-8e93716f3616'::uuid
  and status = 'active';

update public.members
set spouse_name = '박수진',
    phone = ''
where id = 'e3647779-c5f5-45c5-9c4a-6dcaf31a3287'::uuid
  and status = 'active';

update public.members
set name = '정사무엘',
    sub_role = '집사',
    spouse_name = '손미혜',
    phone = '010-3337-1874'
where id = 'dee865f3-e050-4266-be41-40a9c0753f37'::uuid
  and status = 'active';

update public.members
set name = '손미혜',
    sub_role = '집사',
    spouse_name = '정사무엘',
    phone = '010-9048-4685'
where id = '84744504-238d-419f-b289-593699b1e6b7'::uuid
  and status = 'active';

update public.members
set name = '장준호',
    sub_role = '',
    spouse_name = '김수진',
    phone = ''
where id = '33d53645-fac4-496c-b132-6071e481767c'::uuid
  and status = 'active';

update public.members
set spouse_name = '장준호',
    phone = '010-8299-1633'
where id = '6de31251-f09e-4e0c-9f60-3f1a373fa85b'::uuid
  and status = 'active';

update public.members
set name = '정희은',
    sub_role = '집사',
    spouse_name = '박강민',
    phone = '010-3026-3951'
where id = '74e03b92-35b0-492d-8c77-b8d8fde07353'::uuid
  and status = 'active';

update public.members
set spouse_name = '정희은',
    phone = '010-3535-3053'
where id = 'd9902676-e879-4673-ba52-7986fb6a299d'::uuid
  and status = 'active';

update public.members
set name = '박명학',
    sub_role = '',
    spouse_name = '조은혜',
    phone = ''
where id = 'e14d6409-421c-4fff-a96e-6d10fb16b8fe'::uuid
  and status = 'active';

update public.members
set spouse_name = '박명학',
    phone = '010-7379-6003'
where id = '5b78a57f-07c4-4360-94b5-27de7222f4b5'::uuid
  and status = 'active';

update public.members
set name = '김상석',
    sub_role = '시무집사',
    spouse_name = '정수연',
    phone = '010-2429-4616'
where id = '7d7b0492-2307-4058-b86a-a42a26b82c81'::uuid
  and status = 'active';

update public.members
set spouse_name = '김상석',
    phone = '010-5053-0868'
where id = '5d21c7ef-6446-41cd-bb08-db883d62c364'::uuid
  and status = 'active';

update public.members
set name = '정외섭',
    sub_role = '',
    spouse_name = '박화선',
    phone = ''
where id = 'e3fa8121-1f42-4f49-9209-fd65854f9fe4'::uuid
  and status = 'active';

update public.members
set sub_role = '명예권사',
    spouse_name = '정외섭',
    phone = '010-9403-7493'
where id = 'b0d49282-46b5-4206-beb4-5eb5f7b7cbfa'::uuid
  and status = 'active';

update public.members
set spouse_name = '김규호'
where id = '073431d1-ebc8-44c4-80f3-e01e0e05acca'::uuid
  and status = 'active';

update public.members
set phone = ''
where id = '91b8a869-c356-44bf-94b9-8e780295c73d'::uuid
  and status = 'active';

update public.members
set phone = '010-5780-7325'
where id = '7f9fad94-8488-4d12-8d76-2f9e7dcae5c1'::uuid
  and status = 'active';

update public.members
set name = '정성령',
    sub_role = '청년'
where id = 'cab7e2da-ccef-4763-8ad2-71ef11f0eb39'::uuid
  and status = 'active';
