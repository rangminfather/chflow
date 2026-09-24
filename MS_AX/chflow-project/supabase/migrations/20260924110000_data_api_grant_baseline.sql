-- =============================================================
-- Data API GRANT baseline — 2026-09-24
--
-- 목적: supabase db reset / preview branch / 신규 프로젝트처럼 마이그레이션으로
--   처음부터 쌓는 환경에서도 앱이 동작하게 한다. 2026-10-30 부터 Supabase 가
--   public 신규 테이블에 Data API 권한을 자동 부여하지 않기 때문이다.
--   Production 은 자동부여로 이미 동일 이상의 권한이 있어 적용해도 무변화다.
--
-- 방침(D-b): Production ACL 을 그대로 복제하지 않는다.
--   Production 의 anon/authenticated 권한은 대부분 과거 자동부여의 잔재이고
--   RLS 만으로 막혀 있다. 아래 4가지를 교차검증해 최소권한만 부여한다.
--     1) Production 실제 ACL  — pg_class.relacl 덤프, 관계 148개
--     2) 코드 실사용          — chflow-app 320개 파일 .from() 전수 + MS_AX 파이썬 ETL
--     3) RLS 정책
--     4) 기존 REVOKE 이력     — 25개 테이블, 회수 의도는 건드리지 않는다
--
-- anon: 0건.
--   비로그인 페이지(login/signup/find-id/manual)는 전부 RPC 만 쓰고 테이블을
--   직접 읽지 않는다. PostgREST anon 경로가 하나도 없다.
--
-- RPC 전용 테이블에 GRANT 를 주지 않는 근거:
--   전체 함수 408개 중 390개가 SECURITY DEFINER, 나머지 18개는 트리거(5) 또는
--   순수 계산 함수(13)로 테이블을 전혀 참조하지 않는다. 따라서 RPC 경유 접근은
--   호출자의 테이블 권한을 필요로 하지 않는다.
--
-- 역할 귀속은 파일이 아니라 호출부 수신 변수 기준으로 판정했다.
--   (한 라우트가 user 클라이언트와 service 클라이언트를 함께 만드는 경우가 많아
--    파일 단위로 보면 authenticated 에 과다 부여된다. 예: account_withdrawals 는
--    admin 클라이언트 전용인데 파일 기준으로는 authenticated 로 잘못 잡혔다.)
--   lib/r2.ts 의 r2.from(...) 은 R2 버킷이라 테이블에서 제외했다.
--
-- 생성 마이그레이션에 이미 GRANT 를 명시한 20개 테이블은 여기서 제외했다
--   (중복 방지 + 그쪽 의도 보존).
--
-- 재적용 안전: GRANT 는 멱등이다. REVOKE 는 하지 않으므로 Production 권한이
--   줄어들 일은 없다.
-- =============================================================

grant all on public.account_withdrawals to service_role;
grant insert, select, update on public.attendance_geofences to authenticated;
grant select on public.attendance_location_candidates to authenticated;
grant all on public.bulletins to service_role;
grant select on public.church_attendance to authenticated;
grant select on public.department_members to authenticated;
grant all on public.department_members to service_role;
grant select on public.departments to authenticated;
grant all on public.departments to service_role;
grant all on public.dept_verse_memories to service_role;
grant select on public.directory_pastures to authenticated;
grant all on public.directory_photo_crops to service_role;
grant all on public.edu_classes to service_role;
grant select on public.edu_new_friends to authenticated;
grant select on public.edu_quiz_talent to authenticated;
grant select on public.edu_students to authenticated;
grant all on public.edu_students to service_role;
grant select on public.edu_talent_records to authenticated;
grant delete, insert, select on public.edu_talent_resets to authenticated;
grant insert on public.edu_talent_rules to authenticated;
grant select on public.edu_teachers to authenticated;
grant all on public.edu_teachers to service_role;
grant all on public.facility_building_overrides to service_role;
grant all on public.facility_room_overrides to service_role;
grant all on public.feedback_posts to service_role;
grant select on public.grasslands to authenticated;
grant select on public.households to authenticated;
grant all on public.households to service_role;
grant all on public.households_backup to service_role;
grant select on public.member_ministries to authenticated;
grant select on public.member_relations to authenticated;
grant all on public.member_relations to service_role;
grant all on public.member_status_history to service_role;
grant select on public.members to authenticated;
grant all on public.members to service_role;
grant all on public.members_backup to service_role;
grant all on public.messenger_conversations to service_role;
grant all on public.messenger_message_attachments to service_role;
grant all on public.messenger_messages to service_role;
grant all on public.messenger_participants to service_role;
grant all on public.messenger_user_blocks to service_role;
grant all on public.notification_push_deliveries to service_role;
grant delete on public.notifications to authenticated;
grant all on public.notifications to service_role;
grant select on public.password_reset_log to authenticated;
grant all on public.password_reset_log to service_role;
grant select on public.plains to authenticated;
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
grant all on public.signup_attempt_logs to service_role;
grant all on public.staging_members_mdb to service_role;
grant select on public.teacher_assignment_log to authenticated;
grant all on public.user_push_tokens to service_role;
grant all on public.user_ums_credentials to service_role;
grant select on public.vote_candidates to authenticated;
