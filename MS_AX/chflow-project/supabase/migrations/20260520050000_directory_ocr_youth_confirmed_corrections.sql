-- User-confirmed youth role corrections from the local directory OCR validation pass.
-- Source: MS_AX/generated/directory_ocr_validation_2026-05-20

update public.members
set sub_role = '청년'
where id = 'da62a80f-454e-4302-9ae3-a9d759628833'::uuid
  and status = 'active'
  and name = '안예슬'
  and source_page = 103;

update public.members
set sub_role = '청년'
where id = '48ab580b-0df9-4673-be64-0a6bf9e64678'::uuid
  and status = 'active'
  and name = '김효원'
  and source_page = 106;
