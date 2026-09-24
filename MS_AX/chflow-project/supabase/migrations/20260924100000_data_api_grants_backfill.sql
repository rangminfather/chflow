-- =============================================================
-- Data API GRANT 보정 — 2026-09-24
--
-- 배경: Supabase 가 2026-10-30 부터 public 스키마 신규 테이블에 Data API
--   권한을 자동 부여하지 않는다. 기존 테이블은 현재 grant 를 유지하므로
--   Production 은 영향이 없지만, supabase db reset / preview branch /
--   신규 프로젝트처럼 마이그레이션으로 처음부터 쌓는 환경에서는
--   GRANT 가 없는 테이블이 PostgREST 에서 42501 로 막힌다.
--
-- 대상: 아래 3개 테이블은 supabase-js `.from()` 으로 직접 접근하는데
--   생성 마이그레이션에 테이블 GRANT 가 빠져 있었다.
--   (RPC 전용 테이블은 grant execute on function 으로 이미 덮여 있어 제외)
--
-- 원칙: 코드가 실제로 쓰는 역할·동작에만 부여한다. anon 은 세 테이블 모두
--   접근 경로가 없으므로 부여하지 않는다. RLS 는 그대로 유지되며,
--   GRANT 는 RLS 를 우회하지 않는다 (둘 다 통과해야 접근 가능).
--
-- 재적용 안전: GRANT 는 멱등이다.
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. attendance_saved_locations
--    접근 경로: 모두 사용자 JWT(authenticated) — anon key + Bearer token
--      GET    /api/attendance/geofence-locations        select
--      DELETE /api/attendance/geofence-locations/[id]   select, delete
--      PATCH  /api/attendance/geofence                  select, upsert(insert+update)
--    쓰기는 RLS 정책 attendance_saved_locations_manage_admin_office 가
--    admin/office 로 제한한다. GRANT 는 그 정책을 약화시키지 않는다.
--    service_role 직접 사용처는 현재 없지만 운영·복구 경로를 위해 유지한다.
-- ─────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.attendance_saved_locations to authenticated;
grant all                            on public.attendance_saved_locations to service_role;

-- ─────────────────────────────────────────────────────────────
-- 2. dept_bulletin_extractions
--    접근 경로: service_role 전용 — /api/dept-bulletin/extraction 의 admin()
--      select, upsert(insert+update)
--    RLS 는 켜져 있고 정책이 하나도 없다 = authenticated 는 어차피 0행.
--    GRANT 도 주지 않아 이중으로 막는다 (추출 캐시는 내부 데이터).
-- ─────────────────────────────────────────────────────────────
grant all on public.dept_bulletin_extractions to service_role;

-- ─────────────────────────────────────────────────────────────
-- 3. bulletin_scripture_readings
--    접근 경로:
--      GET /api/bulletin/[id]/scripture-readings   authenticated, select 만
--        (RLS "verified read" 로 status='verified' 행만 보인다)
--      /api/admin/bulletin-scripture-readings      service_role, select+upsert
--    관리자 쓰기는 전부 service_role 을 거치므로 authenticated 에는
--    insert/update/delete 를 주지 않는다.
-- ─────────────────────────────────────────────────────────────
grant select on public.bulletin_scripture_readings to authenticated;
grant all    on public.bulletin_scripture_readings to service_role;
