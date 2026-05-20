-- High-confidence corrections from the two-pass local directory OCR validation.
-- Source: MS_AX/generated/directory_ocr_validation_2026-05-20
-- Applied rules:
--   1. both parses agree on a close corrected name, or
--   2. exact name match and the DB role was blank.

update public.members set name = '안준규', sub_role = '권사'
where id = 'e3a3bf44-33ce-4b95-87c2-a1fd34fad87b'::uuid and status = 'active' and source_page = 59;

update public.members set name = '김성균'
where id = '278c0154-6c85-4e1d-b202-21db0ece5de9'::uuid and status = 'active' and source_page = 61;

update public.members set name = '정은종'
where id = '1cc5498e-a8ea-44e5-8092-21ab0f606541'::uuid and status = 'active' and source_page = 68;

update public.members set name = '장용환', sub_role = '서리집사'
where id = '1a704f43-2bec-4c5d-b8dd-537d4791d79b'::uuid and status = 'active' and source_page = 69;

update public.members set sub_role = '권사'
where id = '98441954-8e72-4166-8676-2630d584472a'::uuid and status = 'active' and source_page = 75;

update public.members set sub_role = '서리집사'
where id = '690fa30f-2e99-4adc-834d-46f96089bfdd'::uuid and status = 'active' and source_page = 76;

update public.members set name = '서윤화'
where id = '0c5e269f-e0a8-4bff-a837-7470e94ce14c'::uuid and status = 'active' and source_page = 79;

update public.members set name = '김선환'
where id = '9f9e02ff-9ceb-4194-8c46-c608a17f8557'::uuid and status = 'active' and source_page = 85;

update public.members set sub_role = '서리집사'
where id = '2f5306ad-a3ef-4a9e-854a-9135cd3f26c9'::uuid and status = 'active' and source_page = 89;

update public.members set name = '이성건', sub_role = '서리집사'
where id = '1e533f03-f916-441d-9414-0cdd94fbef29'::uuid and status = 'active' and source_page = 90;

update public.members set name = '공태식'
where id = '3a1e0370-a6cf-4b14-a9e7-8e76f3784843'::uuid and status = 'active' and source_page = 91;

update public.members set name = '이은주', sub_role = '서리집사'
where id = '8e031450-9e10-44ec-8e81-572c4651d3ec'::uuid and status = 'active' and source_page = 94;

update public.members set sub_role = '서리집사'
where id = 'fef7c086-fc8d-47bb-9da2-827f8b0a6ffc'::uuid and status = 'active' and source_page = 95;

update public.members set sub_role = '서리집사'
where id = '88fa831b-4e54-4432-afd9-550f0af61aef'::uuid and status = 'active' and source_page = 95;

update public.members set name = '정영교', sub_role = '서리집사'
where id = 'c345efb5-2fcf-4250-9d12-22b8a1b6b967'::uuid and status = 'active' and source_page = 95;

update public.members set sub_role = '서리집사'
where id = '698e9d5e-7e63-4a71-9df7-3b77062a5988'::uuid and status = 'active' and source_page = 97;

update public.members set sub_role = '서리집사'
where id = '49c324e4-b961-46af-9c80-2cfd499b4e2b'::uuid and status = 'active' and source_page = 98;

update public.members set name = '서혜진', sub_role = '서리집사'
where id = '32204ced-42b7-448e-b1a3-4ce3a4b59d9a'::uuid and status = 'active' and source_page = 99;

update public.members set name = '이순선', sub_role = '서리집사'
where id = 'd2089b58-e740-4f71-a6ae-4c44c0b30320'::uuid and status = 'active' and source_page = 100;

update public.members set name = '박화선', sub_role = '명예권사'
where id = 'b0d49282-46b5-4206-beb4-5eb5f7b7cbfa'::uuid and status = 'active' and source_page = 101;

update public.members set name = '윤서은'
where id = '6b0f9ae9-d483-430e-b09c-9d14753f0019'::uuid and status = 'active' and source_page = 101;

update public.members set name = '남영주', sub_role = '청년'
where id = 'cada470c-bca7-464b-b871-40191124d833'::uuid and status = 'active' and source_page = 103;

update public.members set name = '이명규', sub_role = '청년'
where id = 'ca0b285e-2673-4182-b20c-ee176b5863f1'::uuid and status = 'active' and source_page = 103;

update public.members set name = '박정모', sub_role = '청년'
where id = '8a9e86cc-9e37-4070-a317-88e1facdf3a4'::uuid and status = 'active' and source_page = 104;

update public.members set name = '김시은', sub_role = '청년'
where id = '7413eb30-d8d4-468a-9a69-e44bd4208410'::uuid and status = 'active' and source_page = 105;

update public.members set name = '전종재', sub_role = '청년'
where id = '7d7f234f-70ae-4b17-86e5-a3f13bd572dd'::uuid and status = 'active' and source_page = 105;

update public.members set name = '백화목'
where id = '9cab049e-7524-4ed0-80e1-54c58eddb290'::uuid and status = 'active' and source_page = 109;

update public.members set name = '정현승', sub_role = '청년'
where id = 'ea1f00e9-b803-4de8-a167-a2e05ae04456'::uuid and status = 'active' and source_page = 109;

update public.members set name = '나장균', sub_role = '청년'
where id = '5c0e367f-ecba-4bb8-b590-a5ec9d5ed35c'::uuid and status = 'active' and source_page = 111;

update public.members set name = '홍은빈', sub_role = '청년'
where id = '1a47d817-f00d-4105-8fa8-0fcd90667133'::uuid and status = 'active' and source_page = 111;
