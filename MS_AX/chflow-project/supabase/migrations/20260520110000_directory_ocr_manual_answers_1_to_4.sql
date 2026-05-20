-- User-confirmed directory OCR corrections, manual question batch 1-4.

update public.members
set name = '박기완',
    sub_role = '성도',
    spouse_name = '김현숙',
    relationship_in_household = '남편'
where id = 'f3318f4e-e1ba-4cfd-a4af-2179e7a37d1f'::uuid
  and status = 'active'
  and source_page = 55;

update public.members
set sub_role = '시무권사',
    spouse_name = '박기완'
where id = 'f91e1ac8-fc5e-4af2-9bf9-383a35f8ea97'::uuid
  and status = 'active'
  and name = '김현숙'
  and source_page = 55;

update public.members
set name = '박영석'
where id = '34398216-107a-4759-a016-b50edfab769b'::uuid
  and status = 'active'
  and source_page = 55;

update public.members
set phone = '',
    spouse_name = ''
where id = '38864201-b30b-4a79-921f-57bf3fe50793'::uuid
  and status = 'active'
  and name = '박은정'
  and source_page = 74;

update public.members
set name = '신관익',
    sub_role = '',
    spouse_name = '백정희',
    relationship_in_household = '남편'
where id = '664bd15d-ca60-424f-baa0-75c534c6eeb0'::uuid
  and status = 'active'
  and source_page = 78;

update public.members
set name = '백정희',
    sub_role = '',
    spouse_name = '신관익',
    phone = '010-8725-6097',
    relationship_in_household = '세대주'
where id = '9285c644-a516-4c1f-8798-0c965e14d591'::uuid
  and status = 'active'
  and source_page = 78;
