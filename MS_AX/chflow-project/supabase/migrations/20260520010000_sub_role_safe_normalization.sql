-- Conservative sub_role normalization from directly matched directory PDF evidence.
-- Generated after read-only report:
--   MS_AX/generated/sub_role_normalization_report_2026-05-20.md
--
-- Rule applied:
--   집사 -> 서리집사
--
-- Guardrails:
--   - exact member id
--   - active current member from source_page 110
--   - current sub_role is still the generic value
--   - phone still matches the parsed PDF row

update public.members
set sub_role = '서리집사'
where id = '7e42acd4-4af3-401e-ac9c-7d158f39b38e'::uuid
  and status = 'active'
  and name = '강범석'
  and source_page = 110
  and sub_role = '집사'
  and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = '01044145451';
