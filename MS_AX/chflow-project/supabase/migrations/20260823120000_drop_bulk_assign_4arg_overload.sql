-- =============================================================
-- bulk_assign_class_teacher: 중복 오버로드 제거 (4인자 삭제, 5인자 유지)
--
-- 경위(정정): 이 중복은 오래된 잔재가 아니라 어제자 내 마이그레이션이 만든 것이다.
--   20260815110000_edu_class_homeroom_position 은 4인자·5인자 두 시그니처를 모두
--     drop 한 뒤 5인자만 create 했다 → 그 시점 이후 오버로드는 1개였다.
--   20260823090000_class_admin_authz_use_get_user_grade 가 권한 판정을 고치면서
--     'create or replace' 로 4인자 시그니처를 다시 만들어 오버로드가 2개가 됐다.
--     (해당 마이그레이션을 만들 때 DROP 이력을 보지 않고 '최신 CREATE' 만 추적한
--      스캔 결과에 의존한 실수다.)
--   그래서 이 마이그레이션은 20260815110000 이 의도한 상태로 되돌리는 것이다.
--
-- 오버로드가 2개면 PostgREST 가 인자 이름만으로 후보를 특정하지 못해
--   'Could not choose the best candidate function' 이 난다.
--
-- 조사 결과(2026-08-23, 프로덕션 실측):
--   live 오버로드 : oid 29469 = 5인자(p_homeroom_position 포함), oid 30009 = 4인자
--   코드 호출처   : 없음. 저장소 전체에서 이 함수를 rpc 로 호출하는 곳이 없다.
--                   (chflow-app 의 'bulk_assign' 문자열은 teacher_assignment_log.
--                    action_type 라벨이고, 그 값은 set_class_homeroom_teacher 가 쓴다)
--   DB 참조       : 다른 함수 본문 0, pg_depend 비정상 의존 0, 뷰 0, 트리거 0,
--                   pg_cron 잡 0
--   대체 경로     : 반 담임 지정은 set_class_homeroom_teacher(uuid,text,text,uuid,text)
--
-- 남기는 쪽을 5인자로 정한 근거: 4인자 기능을 모두 포함하는 상위 호환이며
--   (homeroom_position 처리와 edu_classes upsert 분기가 추가됨) 20260815110000 이
--   의도적으로 선택한 시그니처다.
--
-- CASCADE 는 쓰지 않는다. 되돌리는 스크립트는
--   supabase/rollbacks/20260823120000_drop_bulk_assign_4arg_overload.sql
-- =============================================================

do $$
declare v_five int; v_four int;
begin
  select count(*) into v_five
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'bulk_assign_class_teacher'
    and pg_get_function_identity_arguments(p.oid)
        = 'p_dept_id uuid, p_class_no text, p_new_teacher_id uuid, p_reason text, p_homeroom_position text';

  select count(*) into v_four
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'bulk_assign_class_teacher'
    and pg_get_function_identity_arguments(p.oid)
        = 'p_dept_id uuid, p_class_no text, p_new_teacher_id uuid, p_reason text';

  -- 남겨야 할 5인자가 없으면 아무것도 지우지 않고 멈춘다
  if v_five <> 1 then
    raise exception '중단: 유지 대상 5인자 함수가 % 개다(1개여야 함). 4인자를 삭제하지 않았다.', v_five;
  end if;
  raise notice '삭제 전 상태: 5인자 %개 / 4인자 %개', v_five, v_four;
end
$$;

-- 정확한 시그니처만 지정해 삭제 (이름만으로 DROP 하지 않는다)
drop function if exists public.bulk_assign_class_teacher(uuid, text, uuid, text);

do $$
declare v_total int; v_args text;
begin
  select count(*) into v_total
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'bulk_assign_class_teacher';

  if v_total <> 1 then
    raise exception '중단: 삭제 후 bulk_assign_class_teacher 오버로드가 % 개다(1개여야 함)', v_total;
  end if;

  select pg_get_function_identity_arguments(p.oid) into v_args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'bulk_assign_class_teacher';

  if v_args <> 'p_dept_id uuid, p_class_no text, p_new_teacher_id uuid, p_reason text, p_homeroom_position text' then
    raise exception '중단: 남은 시그니처가 예상과 다르다 → (%)', v_args;
  end if;
  raise notice '삭제 후 상태: 오버로드 1개, 시그니처 (%)', v_args;
end
$$;
