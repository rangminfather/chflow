-- =============================================================
-- 관리자 부서원관리(/admin/dept-staff) RPC 권한 판정 정비
--
-- 문제:
--   페이지 진입 게이트 = profiles.role (admin/office/pastor) 인데,
--   부서 클릭 시 호출하는 list_dept_members_with_grade / set_member_grade 는
--   get_user_grade(부서) <= 1 만 확인. get_user_grade 는 department_members
--   행이 있으면 그 grade 가 시스템 role 폴백(0)보다 우선하므로,
--   admin 이라도 해당 부서에 교사(grade 3) 등으로 임명돼 있으면 거부됨.
--   (부서원 행이 없는 부서는 폴백 0 으로 통과 → 부서마다 됐다/안 됐다 하는 불일치)
--   에러 메시지도 영어 'permission denied (요구 등급: 0~1)' 가 그대로 노출.
--
-- 조치:
--   같은 페이지의 admin_approve_dept_join 과 동일하게 시스템 role 을 먼저
--   허용하고, 그 외에는 종전대로 부서 등급 0~1 을 요구. 메시지는 한국어로.
-- =============================================================

create or replace function public.set_member_grade(
  p_dept_id uuid,
  p_member_user_id uuid,
  p_grade smallint
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_grade < 0 or p_grade > 4 then
    raise exception '등급 값이 올바르지 않습니다 (0~4)';
  end if;
  if public.get_user_role() not in ('admin', 'office', 'pastor')
     and public.get_user_grade(p_dept_id) > 1 then
    raise exception '부서원 등급을 변경할 권한이 없습니다 (관리자 또는 부서 등급 0~1)';
  end if;
  update department_members
    set grade = p_grade
    where department_id = p_dept_id and user_id = p_member_user_id;
end;
$$;

create or replace function public.list_dept_members_with_grade(p_dept_id uuid)
returns table (
  user_id    uuid,
  name       text,
  grade      smallint,
  status     text,
  joined_at  timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if public.get_user_role() not in ('admin', 'office', 'pastor')
     and public.get_user_grade(p_dept_id) > 1 then
    raise exception '부서원 목록을 볼 권한이 없습니다 (관리자 또는 부서 등급 0~1)';
  end if;
  return query
    select * from (
      select
        dm.user_id,
        coalesce(m.name, u.email)::text as name,
        dm.grade::smallint,
        dm.status::text,
        dm.requested_at as joined_at
      from department_members dm
      left join auth.users u on u.id = dm.user_id
      left join members m on m.app_user_id = dm.user_id
      where dm.department_id = p_dept_id
    ) merged
    order by merged.grade asc, merged.name asc;
end;
$$;
