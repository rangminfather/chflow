-- Manual rollback for the education-history feature.
-- Run only after exporting education_* data. This is intentionally not placed
-- in migrations because Supabase migrations are forward-only.

begin;

drop view if exists public.public_member_education_history_view;
drop function if exists public.review_education_import_row(uuid, uuid, uuid, text, text, boolean);
drop function if exists public.stage_education_import(jsonb, jsonb);
drop function if exists public.education_member_detail(uuid);
drop function if exists public.education_member_summaries(text, text, text, text, text, integer, integer);
drop function if exists public.education_course_dashboard();
drop function if exists public.education_required_dashboard();
drop function if exists public.education_lmtc_dashboard();
drop function if exists public.education_statistics();
drop function if exists public.education_search_member_candidates(text, integer);
drop function if exists public.get_my_app_capabilities();
drop function if exists public.assert_app_capability(text);

drop table if exists public.education_history_audit_logs;
drop table if exists public.member_education_history;
drop table if exists public.education_import_duplicate_candidates;
drop table if exists public.education_import_match_candidates;
drop table if exists public.member_identity_aliases;
drop table if exists public.education_import_rows;
drop table if exists public.education_offerings;
drop table if exists public.education_import_batches;
drop table if exists public.education_course_policies;
drop table if exists public.education_course_aliases;
drop table if exists public.education_courses;

delete from public.app_capability_grants
where capability_key like 'education_%';
delete from public.app_capabilities
where capability_key like 'education_%';

drop function if exists public.has_app_capability(text, uuid);
drop function if exists public.education_audit_row_changes();
drop function if exists public.education_guard_import_raw_fields();
drop function if exists public.education_touch_updated_at();

commit;
