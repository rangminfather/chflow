-- =============================================================
-- 반(班) 레지스트리: 학생 0명인 빈 반도 독립적으로 존재/추가/삭제 가능하게.
--   기존: 반 = edu_students.class_no 에서 역산 → 학생 없으면 반 없음.
--   변경: edu_classes 테이블로 반을 1급 객체화. 기존 초등1부 반은 백필로 보존.
--   하위호환: 목록은 (레지스트리 ∪ 학생기반 미등록 반) 합집합.
--   권한: 추가/이름변경/삭제 = grade 0~1 (전도사·부장), 기존 담임지정과 동일.
-- =============================================================

create table if not exists public.edu_classes (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  grade_year    smallint,                 -- null 허용 (영아·유아 등 학년 없는 부서)
  class_no      text not null,            -- 표시·식별용 반 이름 (예: "1-1", "a반")
  label         text,                     -- 추가 설명(선택)
  teacher_id    uuid references public.edu_teachers(id) on delete set null,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  unique (department_id, class_no)
);
create index if not exists idx_edu_classes_dept on public.edu_classes (department_id, sort_order, class_no);
alter table public.edu_classes enable row level security;
-- 직접쿼리 차단 (RPC로만 접근)

-- ───────────────────────── 백필: 기존 학생 반 → 레지스트리 ─────────────────────────
-- class_no 가 있는 활성 학생들의 반을 레지스트리에 등록(없을 때만). 담임은 해당 반 학생의 teacher_id 중 하나.
insert into public.edu_classes (department_id, grade_year, class_no, teacher_id, sort_order)
select
  s.department_id,
  max(s.grade_year)                                              as grade_year,
  s.class_no,
  (array_agg(s.teacher_id) filter (where s.teacher_id is not null))[1] as teacher_id,
  0                                                              as sort_order
from public.edu_students s
where s.is_active = true and coalesce(trim(s.class_no), '') <> ''
group by s.department_id, s.class_no
on conflict (department_id, class_no) do nothing;

-- ───────────────────────── 목록 RPC (레지스트리 ∪ 미등록 학생반) ─────────────────────────
drop function if exists public.list_dept_classes_full(uuid);
create function public.list_dept_classes_full(p_dept_id uuid)
returns table (
  class_no text,
  grade_year smallint,
  label text,
  teacher_id uuid,
  teacher_name text,
  teacher_member_id uuid,
  is_placeholder boolean,
  student_count bigint,
  sort_order int,
  in_registry boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_edu_member_or_admin(p_dept_id) then
    raise exception '접근 권한이 없습니다';
  end if;

  return query
  -- 레지스트리 반
  select
    c.class_no,
    c.grade_year,
    c.label,
    c.teacher_id,
    et.name as teacher_name,
    et.member_id as teacher_member_id,
    (c.teacher_id is not null and et.member_id is null) as is_placeholder,
    coalesce(sc.cnt, 0) as student_count,
    c.sort_order,
    true as in_registry
  from public.edu_classes c
  left join public.edu_teachers et on et.id = c.teacher_id
  left join (
    select class_no, count(*) as cnt
    from public.edu_students
    where department_id = p_dept_id and is_active = true and coalesce(trim(class_no), '') <> ''
    group by class_no
  ) sc on sc.class_no = c.class_no
  where c.department_id = p_dept_id

  union all

  -- 레지스트리에 없는 학생기반 반 (안전망)
  select
    s.class_no,
    max(s.grade_year) as grade_year,
    null::text as label,
    (array_agg(s.teacher_id) filter (where s.teacher_id is not null))[1] as teacher_id,
    (array_agg(et2.name) filter (where et2.name is not null))[1] as teacher_name,
    (array_agg(et2.member_id) filter (where et2.member_id is not null))[1] as teacher_member_id,
    false as is_placeholder,
    count(*) as student_count,
    9999 as sort_order,
    false as in_registry
  from public.edu_students s
  left join public.edu_teachers et2 on et2.id = s.teacher_id
  where s.department_id = p_dept_id and s.is_active = true and coalesce(trim(s.class_no), '') <> ''
    and not exists (
      select 1 from public.edu_classes c2
      where c2.department_id = p_dept_id and c2.class_no = s.class_no
    )
  group by s.class_no

  order by grade_year nulls last, sort_order, class_no;
end;
$$;
grant execute on function public.list_dept_classes_full(uuid) to authenticated;

-- ───────────────────────── 권한 체크 헬퍼 (grade 0~1) ─────────────────────────
create or replace function public.assert_dept_class_admin(p_dept_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_grade smallint;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select grade into v_grade from public.department_members
  where department_id = p_dept_id and user_id = auth.uid();
  if v_grade is null or v_grade > 1 then
    raise exception '반 관리 권한이 없습니다 (전도사·부장만 가능)';
  end if;
end;
$$;

-- ───────────────────────── 반 추가 ─────────────────────────
drop function if exists public.add_dept_class(uuid, smallint, text, text);
create function public.add_dept_class(
  p_dept_id uuid,
  p_grade_year smallint,
  p_class_no text,
  p_label text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_no text := nullif(trim(coalesce(p_class_no, '')), '');
  v_sort int;
begin
  perform public.assert_dept_class_admin(p_dept_id);
  if v_no is null then raise exception '반 이름을 입력하세요'; end if;
  if exists (select 1 from public.edu_classes where department_id = p_dept_id and class_no = v_no) then
    raise exception '이미 같은 이름의 반이 있습니다: %', v_no;
  end if;
  select coalesce(max(sort_order), 0) + 1 into v_sort
  from public.edu_classes where department_id = p_dept_id;
  insert into public.edu_classes (department_id, grade_year, class_no, label, sort_order, created_by)
  values (p_dept_id, p_grade_year, v_no, nullif(trim(coalesce(p_label, '')), ''), v_sort, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.add_dept_class(uuid, smallint, text, text) to authenticated;

-- ───────────────────────── 반 이름/학년 변경 (학생 class_no 도 연쇄 변경) ─────────────────────────
drop function if exists public.rename_dept_class(uuid, text, text, smallint, text);
create function public.rename_dept_class(
  p_dept_id uuid,
  p_old_class_no text,
  p_new_class_no text,
  p_grade_year smallint default null,
  p_label text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_new text := nullif(trim(coalesce(p_new_class_no, '')), '');
begin
  perform public.assert_dept_class_admin(p_dept_id);
  if v_new is null then raise exception '반 이름을 입력하세요'; end if;
  -- 레지스트리에 없으면(=학생기반 반) 새로 생성하며 이름 변경
  if not exists (select 1 from public.edu_classes where department_id = p_dept_id and class_no = p_old_class_no) then
    insert into public.edu_classes (department_id, grade_year, class_no, label, created_by)
    values (p_dept_id, p_grade_year, v_new, nullif(trim(coalesce(p_label, '')), ''), auth.uid())
    on conflict (department_id, class_no) do nothing;
  else
    if v_new <> p_old_class_no
       and exists (select 1 from public.edu_classes where department_id = p_dept_id and class_no = v_new) then
      raise exception '이미 같은 이름의 반이 있습니다: %', v_new;
    end if;
    update public.edu_classes
      set class_no = v_new, grade_year = p_grade_year, label = nullif(trim(coalesce(p_label, '')), '')
      where department_id = p_dept_id and class_no = p_old_class_no;
  end if;
  -- 학생들의 class_no / grade_year 연쇄 변경
  if v_new <> p_old_class_no then
    update public.edu_students
      set class_no = v_new, grade_year = coalesce(p_grade_year, grade_year)
      where department_id = p_dept_id and class_no = p_old_class_no;
  elsif p_grade_year is not null then
    update public.edu_students
      set grade_year = p_grade_year
      where department_id = p_dept_id and class_no = p_old_class_no;
  end if;
end;
$$;
grant execute on function public.rename_dept_class(uuid, text, text, smallint, text) to authenticated;

-- ───────────────────────── 반 삭제 (학생 있으면 막기) ─────────────────────────
drop function if exists public.delete_dept_class(uuid, text);
create function public.delete_dept_class(p_dept_id uuid, p_class_no text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_cnt int;
begin
  perform public.assert_dept_class_admin(p_dept_id);
  select count(*) into v_cnt from public.edu_students
  where department_id = p_dept_id and is_active = true and class_no = p_class_no;
  if v_cnt > 0 then
    raise exception '이 반에 학생 %명이 있습니다. 먼저 학생을 다른 반으로 옮기거나 빼주세요.', v_cnt;
  end if;
  delete from public.edu_classes where department_id = p_dept_id and class_no = p_class_no;
end;
$$;
grant execute on function public.delete_dept_class(uuid, text) to authenticated;

-- ───────────────────────── 담임배정: 레지스트리에도 반영 (빈 반 지원) ─────────────────────────
create or replace function public.bulk_assign_class_teacher(
  p_dept_id uuid, p_class_no text, p_new_teacher_id uuid, p_reason text default null
)
returns integer
language plpgsql security definer
as $function$
DECLARE
  v_caller UUID := auth.uid();
  v_caller_name TEXT;
  v_caller_grade SMALLINT;
  v_old_teacher_id UUID;
  v_old_teacher_name TEXT;
  v_new_teacher_name TEXT;
  v_count INTEGER;
BEGIN
  SELECT grade INTO v_caller_grade FROM public.department_members WHERE department_id = p_dept_id AND user_id = v_caller;
  IF v_caller_grade IS NULL OR v_caller_grade > 1 THEN RAISE EXCEPTION '권한 없음 (grade 0~1 만 가능)'; END IF;
  SELECT name INTO v_caller_name FROM public.profiles WHERE id = v_caller;
  SELECT name INTO v_new_teacher_name FROM public.edu_teachers WHERE id = p_new_teacher_id AND department_id = p_dept_id;
  IF v_new_teacher_name IS NULL THEN RAISE EXCEPTION '담임 정보 없음 또는 부서 불일치'; END IF;

  -- 기존 담임: 레지스트리 우선, 없으면 학생에서
  SELECT teacher_id INTO v_old_teacher_id FROM public.edu_classes WHERE department_id = p_dept_id AND class_no = p_class_no;
  IF v_old_teacher_id IS NULL THEN
    SELECT teacher_id INTO v_old_teacher_id FROM public.edu_students WHERE department_id = p_dept_id AND class_no = p_class_no AND teacher_id IS NOT NULL LIMIT 1;
  END IF;
  IF v_old_teacher_id IS NOT NULL THEN SELECT name INTO v_old_teacher_name FROM public.edu_teachers WHERE id = v_old_teacher_id; END IF;

  -- 레지스트리 반영 (반이 등록돼 있으면)
  UPDATE public.edu_classes SET teacher_id = p_new_teacher_id WHERE department_id = p_dept_id AND class_no = p_class_no;
  -- 학생 반영
  UPDATE public.edu_students SET teacher_id = p_new_teacher_id WHERE department_id = p_dept_id AND class_no = p_class_no;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.teacher_assignment_log (department_id, action_type, class_no, old_teacher_id, old_teacher_name, new_teacher_id, new_teacher_name, reason, changed_by, changed_by_name)
  VALUES (p_dept_id, 'bulk_assign', p_class_no, v_old_teacher_id, v_old_teacher_name, p_new_teacher_id, v_new_teacher_name, p_reason, v_caller, v_caller_name);
  RETURN v_count;
END;
$function$;
grant execute on function public.bulk_assign_class_teacher(uuid, text, uuid, text) to authenticated;
