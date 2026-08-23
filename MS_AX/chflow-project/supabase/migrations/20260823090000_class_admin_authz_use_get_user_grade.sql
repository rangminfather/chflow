-- =============================================================
-- 반 관리 계열 권한 판정을 get_user_grade 로 통일
--
-- 배경: 20260822090000 에서 merge_placeholder_teacher 를 고쳤으나, 반 관리 계열
--   함수들은 여전히 department_members.grade 를 직접 읽어 시스템
--   role(admin/office/pastor)을 인정하지 않았다. 그래서 부서 소속이 없는 관리자가
--   '담임 계정 연결'은 되는데 '반 추가·이름변경·삭제·담임 지정'은 막혀 절차가
--   중간에 끊겼다.
--
-- 정책 기준: 20260711150000_get_user_grade_admin_priority
--   get_user_grade = least(승인된 부서 등급, admin/office/pastor 면 0)
--
-- 직접 읽기의 부수 문제도 함께 해소된다: 기존 쿼리는 status 를 보지 않아
--   승인 대기(pending) 행의 grade 까지 권한으로 인정할 여지가 있었다.
--   get_user_grade 는 status='approved' 행만 본다.
--
-- 이번에 바꾸는 정의 3개 (임원진 0~2 기준·본문 로직은 그대로, authz 블록만 교체):
--   1) assert_dept_class_admin    — add_dept_class / rename_dept_class /
--                                   delete_dept_class 의 공용 게이트
--   2) bulk_assign_class_teacher  — 반 담임 일괄 지정
--   3) set_class_homeroom_teacher — 정·부 담임 지정
-- =============================================================

-- 1) 공용 게이트 -------------------------------------------------
create or replace function public.assert_dept_class_admin(p_dept_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_grade smallint;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  v_grade := public.get_user_grade(p_dept_id);
  if v_grade is null or v_grade > 2 then
    raise exception '반 관리 권한이 없습니다 (임원진 또는 관리자만 가능)';
  end if;
end;
$$;


-- 2) 반 담임 일괄 지정 -------------------------------------------
create or replace function public.bulk_assign_class_teacher(
  p_dept_id uuid, p_class_no text, p_new_teacher_id uuid, p_reason text default null
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_name text;
  v_caller_grade smallint;
  v_old_teacher_id uuid;
  v_old_teacher_name text;
  v_new_teacher_name text;
  v_count integer;
begin
  v_caller_grade := public.get_user_grade(p_dept_id);

  if v_caller_grade is null or v_caller_grade > 2 then
    raise exception '권한 없음 (임원진 또는 관리자만 가능)';
  end if;

  select name into v_caller_name from public.profiles where id = v_caller;
  select name into v_new_teacher_name
  from public.edu_teachers
  where id = p_new_teacher_id and department_id = p_dept_id;

  if v_new_teacher_name is null then
    raise exception '담임 정보 없음 또는 부서 불일치';
  end if;

  select teacher_id into v_old_teacher_id
  from public.edu_classes
  where department_id = p_dept_id and class_no = p_class_no;

  if v_old_teacher_id is null then
    select teacher_id into v_old_teacher_id
    from public.edu_students
    where department_id = p_dept_id and class_no = p_class_no and teacher_id is not null
    limit 1;
  end if;

  if v_old_teacher_id is not null then
    select name into v_old_teacher_name from public.edu_teachers where id = v_old_teacher_id;
  end if;

  update public.edu_classes
  set teacher_id = p_new_teacher_id
  where department_id = p_dept_id and class_no = p_class_no;

  update public.edu_students
  set teacher_id = p_new_teacher_id
  where department_id = p_dept_id and class_no = p_class_no;
  get diagnostics v_count = row_count;

  insert into public.teacher_assignment_log (
    department_id, action_type, class_no, old_teacher_id, old_teacher_name,
    new_teacher_id, new_teacher_name, reason, changed_by, changed_by_name
  ) values (
    p_dept_id, 'bulk_assign', p_class_no, v_old_teacher_id, v_old_teacher_name,
    p_new_teacher_id, v_new_teacher_name, p_reason, v_caller, v_caller_name
  );

  return v_count;
end;
$$;


-- 3) 정·부 담임 지정 ---------------------------------------------
create or replace function public.set_class_homeroom_teacher(
  p_dept_id uuid, p_class_no text, p_role text, p_teacher_id uuid default null, p_reason text default null
)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid(); v_grade smallint; v_caller_name text;
  v_old_id uuid; v_old_name text; v_new_name text; v_count integer := 0;
begin
  v_grade := public.get_user_grade(p_dept_id);
  if v_grade is null or v_grade > 2 then raise exception '권한 없음 (임원진 또는 관리자만 가능)'; end if;
  if p_role not in ('정','부') then raise exception '담임 구분은 정 또는 부만 가능합니다'; end if;
  if p_teacher_id is not null then
    select name into v_new_name from public.edu_teachers
    where id=p_teacher_id and department_id=p_dept_id and is_active=true;
    if v_new_name is null then raise exception '담임 정보 없음 또는 부서 불일치'; end if;
  end if;
  select name into v_caller_name from public.profiles where id=v_caller;

  insert into public.edu_classes(department_id, grade_year, class_no, sort_order, created_by)
  select p_dept_id, max(s.grade_year), p_class_no, 0, v_caller
  from public.edu_students s where s.department_id=p_dept_id and s.class_no=p_class_no
  on conflict (department_id,class_no) do nothing;

  if p_role='정' then
    select teacher_id into v_old_id from public.edu_classes where department_id=p_dept_id and class_no=p_class_no;
    update public.edu_classes set teacher_id=p_teacher_id, homeroom_position=null
      where department_id=p_dept_id and class_no=p_class_no;
    update public.edu_students set teacher_id=p_teacher_id
      where department_id=p_dept_id and class_no=p_class_no;
    get diagnostics v_count = row_count;
  else
    select assistant_teacher_id into v_old_id from public.edu_classes where department_id=p_dept_id and class_no=p_class_no;
    update public.edu_classes set assistant_teacher_id=p_teacher_id, homeroom_position=null
      where department_id=p_dept_id and class_no=p_class_no;
  end if;
  if v_old_id is not null then select name into v_old_name from public.edu_teachers where id=v_old_id; end if;
  insert into public.teacher_assignment_log(
    department_id, action_type, class_no, old_teacher_id, old_teacher_name,
    new_teacher_id, new_teacher_name, reason, changed_by, changed_by_name
  ) values (
    p_dept_id, 'bulk_assign', p_class_no, v_old_id, v_old_name,
    p_teacher_id, v_new_name, '['||p_role||'담임] '||coalesce(p_reason,''), v_caller, v_caller_name
  );
  return v_count;
end;
$$;
