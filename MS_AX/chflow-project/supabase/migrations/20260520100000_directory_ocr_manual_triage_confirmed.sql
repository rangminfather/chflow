-- User-confirmed corrections from the directory OCR manual triage.
-- source_page remains the pasture/household listing page; role/photo pages can
-- independently confirm spouse and role data when the pasture listing omits it.

update public.members
set phone = '010-5599-4559'
where id = '0245c1d8-96fd-474e-a343-1931bbced9bf'::uuid
  and status = 'active'
  and name = '권관옥';

update public.members
set phone = '010-9814-4559'
where id = '901e2d9a-e925-4d32-8ad3-857a1bda3e40'::uuid
  and status = 'active'
  and name = '임순이';

update public.members
set name = '김찬규'
where id = 'd04dc94e-932a-48a0-8ee8-7ce1efdb5af7'::uuid
  and status = 'active'
  and source_page = 62;

update public.members
set spouse_name = '전진규'
where id = '43a9f9b4-3d0c-440a-bb1f-fd32dc4a0827'::uuid
  and status = 'active'
  and name = '구영교';

update public.members
set name = '박영란',
    sub_role = '은퇴시무권사',
    spouse_name = '신승원'
where id = '68e6467f-c329-4519-9cdf-c8941bbdb5c4'::uuid
  and status = 'active'
  and source_page = 67;

update public.members
set spouse_name = '박영란'
where id = '5a582395-1d2b-4b85-8e71-e238279f6ef4'::uuid
  and status = 'active'
  and name = '신승원';

update public.members
set name = '진영우',
    sub_role = '서리집사'
where id = 'fc07afc3-6497-4804-9cd8-0f49e266f4db'::uuid
  and status = 'active'
  and source_page = 69;

update public.members
set sub_role = '서리집사',
    spouse_name = '진영우'
where id = '33b5418d-cb93-4ca5-8f71-fd165b65bf41'::uuid
  and status = 'active'
  and name = '박현지';

update public.members
set sub_role = '성도',
    spouse_name = '조향선'
where id = '38dd1bc8-d0be-4d4f-b824-2c097ee55736'::uuid
  and status = 'active'
  and name = '이일호';

update public.members
set name = '조향선',
    sub_role = '서리집사',
    spouse_name = '이일호'
where id = '51561ecf-deff-42fd-a6ba-0927747b90d5'::uuid
  and status = 'active'
  and source_page = 77;

update public.members
set sub_role = '시무권사'
where id = 'adcec55a-a524-444a-be0f-6a11a9151c74'::uuid
  and status = 'active'
  and name = '신영이';

update public.members
set sub_role = '성도'
where id = 'ddd4ef61-b067-44f7-863a-1eb7bc7a96ab'::uuid
  and status = 'active'
  and name = '김지호';

update public.members
set sub_role = '시무권사'
where id = 'd60bf316-7040-463a-ad2d-e74cf21a80ba'::uuid
  and status = 'active'
  and name = '천미숙';

update public.members
set sub_role = '성도'
where id = '9b5fd4e2-a5da-4a6e-b697-affef2588f34'::uuid
  and status = 'active'
  and name = '이정필';

update public.members
set sub_role = '교육사'
where id = 'd0d108fd-a19d-42d1-846f-2a0d7a0c60bc'::uuid
  and status = 'active'
  and name = '이용순';

update public.members
set name = '김인기',
    spouse_name = '박지영'
where id = '3a31276a-b0de-41d7-8613-64ce0acb4586'::uuid
  and status = 'active'
  and source_page = 70;

update public.members
set name = '박영석',
    spouse_name = '임순현'
where id = 'e747c5c6-8474-40dc-a4e3-a737b2acf315'::uuid
  and status = 'active'
  and source_page = 71;

update public.members
set name = '임순현',
    spouse_name = '박영석'
where id = 'caf89ec6-8233-4795-b1c5-698bf55eba91'::uuid
  and status = 'active'
  and source_page = 71;

update public.members
set sub_role = '집사'
where id = 'b0e146c3-f48a-4234-a17e-a04848523c1a'::uuid
  and status = 'active'
  and name = '안준';

update public.members
set sub_role = '권사'
where id = '04971639-0fcb-4cab-aab4-54baf57e7c32'::uuid
  and status = 'active'
  and name = '황영애';

update public.members
set name = '김건희',
    sub_role = '명예집사',
    spouse_name = '이영숙'
where id = '3b2da086-73cd-47a4-bbe3-120002e236d2'::uuid
  and status = 'active'
  and source_page = 94;

update public.members
set name = '이영신',
    sub_role = '권사',
    spouse_name = '최인석'
where id = '46914331-75c0-421a-b7c6-cecef31fe09e'::uuid
  and status = 'active'
  and source_page = 94;

update public.members
set name = '박선옥',
    sub_role = '권사',
    spouse_name = '추달촌'
where id = '87941a31-9c10-4ffa-af08-a255c12fef3c'::uuid
  and status = 'active'
  and source_page = 94;

update public.members
set name = '박정숙',
    sub_role = '은퇴권사',
    spouse_name = '송기호'
where id = 'ceb92bfb-4fac-4d53-9005-5a4917e7775b'::uuid
  and status = 'active'
  and source_page = 95;

update public.members
set name = '박강민',
    sub_role = '집사',
    spouse_name = '정희은'
where id = 'd9902676-e879-4673-ba52-7986fb6a299d'::uuid
  and status = 'active'
  and source_page = 97;
