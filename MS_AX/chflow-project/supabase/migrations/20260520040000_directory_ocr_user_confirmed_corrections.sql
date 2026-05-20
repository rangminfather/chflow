-- User-confirmed corrections from the local directory OCR validation pass.
-- Source: MS_AX/generated/directory_ocr_validation_2026-05-20

update public.members
set sub_role = '시무권사'
where id = '4bdf16d2-70a6-4db1-9f72-ca0292d04040'::uuid
  and status = 'active'
  and source_page = 77;

update public.members
set name = '김비손',
    sub_role = '서리집사'
where id = '143a1b7d-24ae-4368-88bb-a90693dec5a6'::uuid
  and status = 'active'
  and source_page = 91;

update public.members
set name = '송문석',
    sub_role = '시무집사'
where id = 'e630aa95-02c2-4693-ab41-40cef076e72e'::uuid
  and status = 'active'
  and source_page = 95;

update public.members
set name = '전진규',
    sub_role = '서리집사'
where id = 'c5ef4139-499b-4d89-b60b-59482ab70e1c'::uuid
  and status = 'active'
  and source_page = 102;

update public.members
set sub_role = '교육사'
where id = '0db5745d-e948-41d7-abd2-fb62f3837104'::uuid
  and status = 'active'
  and source_page = 105;

update public.members
set sub_role = '서리집사'
where id = '3f933283-7db4-4cb9-9dc3-b37f14d00438'::uuid
  and status = 'active'
  and source_page = 93;

update public.members
set name = '정성호',
    sub_role = '서리집사'
where id = 'b29779be-6d79-4811-905e-a9127b5b22bf'::uuid
  and status = 'active'
  and source_page = 87;
