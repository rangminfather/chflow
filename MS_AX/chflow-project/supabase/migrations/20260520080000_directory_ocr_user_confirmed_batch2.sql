-- User-confirmed corrections from the directory OCR review, batch 2.

update public.members
set sub_role = '은퇴시무집사'
where id = '201c686b-11cc-4f97-a8a1-cb19e1b2b006'::uuid
  and status = 'active'
  and name = '이석철'
  and source_page = 50;

update public.members
set sub_role = '명예서리집사'
where id = '901e2d9a-e925-4d32-8ad3-857a1bda3e40'::uuid
  and status = 'active'
  and name = '임순이'
  and source_page = 56;

update public.members
set sub_role = '은퇴시무집사'
where id = '86f3b692-04c4-4731-a74d-dcc3b19fc79a'::uuid
  and status = 'active'
  and name = '조유태'
  and source_page = 73;

update public.members
set sub_role = '초등학생',
    is_child = true,
    household_id = '46b40ef8-b44a-437c-bfde-bb0bfdc4a0ba'::uuid,
    relationship_in_household = '자',
    spouse_name = ''
where id = '79799a51-b52e-4070-87a1-8a8654b084ab'::uuid
  and status = 'active'
  and name = '사민재'
  and source_page = 69;

insert into public.member_relations (subject_id, relative_id, kind, role)
values
  ('79799a51-b52e-4070-87a1-8a8654b084ab'::uuid, 'b0e146c3-f48a-4234-a17e-a04848523c1a'::uuid, 'parent', 'father'),
  ('79799a51-b52e-4070-87a1-8a8654b084ab'::uuid, 'cebe09d5-98d3-4230-8d07-012f80803311'::uuid, 'parent', 'mother')
on conflict (subject_id, relative_id, kind)
do update set role = excluded.role;

update public.members
set name = '채명진',
    sub_role = '서리집사'
where id = '5a966bc9-239e-49b8-9d0e-cefb50452993'::uuid
  and status = 'active'
  and source_page = 74;

update public.members
set name = '김영미',
    sub_role = '서리집사'
where id = '845c07c0-209d-48e3-b3bf-801f56a07333'::uuid
  and status = 'active'
  and source_page = 78;

update public.members
set name = '박동순',
    sub_role = '은퇴권사'
where id = 'd5fe68ae-63f7-4542-a165-d6592b773f83'::uuid
  and status = 'active'
  and source_page = 78;

update public.members
set name = '최매자',
    sub_role = '은퇴권사'
where id = 'c61f7c4b-01a1-4ef1-89b8-5bc2ceb5270b'::uuid
  and status = 'active'
  and source_page = 78;

update public.members
set name = '김영숙',
    sub_role = '서리집사',
    spouse_name = '김석한'
where id = 'a191406d-9e5e-489c-95db-718f6f5f5122'::uuid
  and status = 'active'
  and source_page = 85;

update public.members
set name = '김석한',
    spouse_name = '김영숙'
where id = '5f12724d-eec8-47fd-943a-4707d25db56d'::uuid
  and status = 'active'
  and source_page = 85;

update public.members
set sub_role = '서리집사'
where id = '750c7c04-d852-4540-b9f2-49d318f5f6e0'::uuid
  and status = 'active'
  and name = '김영숙'
  and source_page = 49;

update public.members
set sub_role = '시무권사'
where id = 'ef8c7587-7801-4ecd-91c8-a54d7a6d7cae'::uuid
  and status = 'active'
  and name = '박선화'
  and source_page = 89;

update public.members
set sub_role = '명예권사'
where id = 'ca3305f1-1d52-4a73-bc1d-7096c6e834e8'::uuid
  and status = 'active'
  and name = '임재옥'
  and source_page = 89;

update public.members
set sub_role = '시무집사'
where id = 'f3a802c9-3c82-4e75-a890-5fcb51eae435'::uuid
  and status = 'active'
  and name = '김상현'
  and source_page = 95;

update public.members
set sub_role = '은퇴시무집사'
where id = 'af957a93-0fe1-4303-ad4b-8df24efd03ec'::uuid
  and status = 'active'
  and name = '송기호'
  and source_page = 95;

update public.members
set sub_role = '은퇴시무집사'
where id = 'f1733b7d-d61d-42b5-a939-af9575ff7999'::uuid
  and status = 'active'
  and name = '김홍남'
  and source_page = 96;

update public.members
set sub_role = '은퇴시무집사'
where id = 'ac5fbb3a-de60-47c2-82dd-7573802547d5'::uuid
  and status = 'active'
  and name = '김근수'
  and source_page = 98;

update public.members
set sub_role = '서리집사'
where id = '5d21c7ef-6446-41cd-bb08-db883d62c364'::uuid
  and status = 'active'
  and name = '정수연'
  and source_page = 99;

update public.members
set sub_role = '은퇴시무장로'
where id = 'c5ad9670-7fb1-49e8-bdb4-2ec563f417a1'::uuid
  and status = 'active'
  and name = '김규호'
  and source_page = 101;

update public.members
set name = '김정엽',
    sub_role = '서리집사'
where id = 'b076877d-ca4f-4ce1-8859-32d958d8bdcf'::uuid
  and status = 'active'
  and source_page = 101;
