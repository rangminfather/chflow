-- 부서원 권한 등급 (0~4)
-- 사용자 xlsx (초등1 메뉴구성.xlsx) 기반:
--   0 = 전도사, 교육사 (모든 메뉴)
--   1 = 부장 (공지·학생·행정·부서)
--   2 = 부부장, 총무, 서기 (공지·학생·행정)
--   3 = 교사 (공지·학생) — 기본값
--   4 = 학부모 (공지 read/comment 만)

alter table department_members
  add column if not exists grade smallint not null default 3;

-- 검증: 0~4 만 허용
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'department_members_grade_check'
  ) then
    alter table department_members
      add constraint department_members_grade_check check (grade >= 0 and grade <= 4);
  end if;
end $$;

-- ────────────────────────────────────────
-- RPC: 현재 사용자의 부서 내 등급 조회
-- 부서원 아니면 99 (접근 불가)
-- 시스템 역할(admin/office/pastor)은 자동 0
-- ────────────────────────────────────────
create or replace function get_user_grade(p_dept_id uuid)
returns smallint
language sql security definer set search_path = public as $$
  select coalesce(
    (select grade::smallint from department_members
      where department_id = p_dept_id
        and user_id = auth.uid()
        and status = 'approved'
      limit 1),
    case when public.get_user_role() in ('admin', 'office', 'pastor') then 0::smallint
         else 99::smallint
    end
  );
$$;

grant execute on function get_user_grade(uuid) to authenticated;

-- ────────────────────────────────────────
-- RPC: 부서원 등급 변경 (admin/grade 0,1 만 가능)
-- ────────────────────────────────────────
create or replace function set_member_grade(
  p_dept_id uuid,
  p_member_user_id uuid,
  p_grade smallint
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  my_grade smallint;
begin
  if p_grade < 0 or p_grade > 4 then
    raise exception 'grade must be 0~4';
  end if;
  my_grade := get_user_grade(p_dept_id);
  if my_grade > 1 then
    raise exception 'permission denied (요구 등급: 0~1)';
  end if;
  update department_members
    set grade = p_grade
    where department_id = p_dept_id and user_id = p_member_user_id;
end;
$$;

grant execute on function set_member_grade(uuid, uuid, smallint) to authenticated;

-- ────────────────────────────────────────
-- RPC: 부서원 목록 + 등급 조회 (등급 0~1 만)
-- ────────────────────────────────────────
create or replace function list_dept_members_with_grade(p_dept_id uuid)
returns table (
  user_id    uuid,
  name       text,
  grade      smallint,
  status     text,
  joined_at  timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  my_grade smallint;
begin
  my_grade := get_user_grade(p_dept_id);
  if my_grade > 1 then
    raise exception 'permission denied (요구 등급: 0~1)';
  end if;
  return query
    select
      dm.user_id,
      coalesce(m.name, u.email)::text as name,
      dm.grade::smallint,
      dm.status::text,
      dm.created_at as joined_at
    from department_members dm
    left join auth.users u on u.id = dm.user_id
    left join members m on m.app_user_id = dm.user_id
    where dm.department_id = p_dept_id
    order by dm.grade asc, name asc;
end;
$$;

grant execute on function list_dept_members_with_grade(uuid) to authenticated;
