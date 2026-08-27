-- 시스템 관리자는 사역부서에 가입하지 않았어도 모든 활성 부서에 입장할 수 있다.
-- 권한 등급은 기존 get_user_grade()의 admin=0 정책을 그대로 사용한다.
-- 목장/목장일지 권한은 별도 도메인이므로 이 마이그레이션에서 변경하지 않는다.

create or replace function public.get_departments_by_category(p_category text)
returns table (
  id uuid,
  category text,
  name text,
  description text,
  icon text,
  order_no int,
  member_count bigint,
  my_status text
)
language sql stable security definer set search_path = public as $$
  select
    d.id,
    d.category,
    d.name,
    d.description,
    d.icon,
    d.order_no,
    (select count(*)
       from public.department_members dm
      where dm.department_id = d.id
        and dm.status = 'approved') as member_count,
    case
      when public.get_user_role() = 'admin' then 'approved'::text
      else (
        select dm.status
          from public.department_members dm
         where dm.department_id = d.id
           and dm.user_id = auth.uid()
         limit 1
      )
    end as my_status
  from public.departments d
  where d.category = p_category
    and d.is_active = true
  order by d.order_no, d.name;
$$;

revoke all on function public.get_departments_by_category(text) from public, anon;
grant execute on function public.get_departments_by_category(text) to authenticated;


create or replace function public.get_my_departments()
returns table (
  id uuid,
  department_id uuid,
  category text,
  name text,
  icon text,
  status text,
  member_role text
)
language sql stable security definer set search_path = public as $$
  select
    coalesce(dm.id, d.id) as id,
    d.id as department_id,
    d.category,
    d.name,
    d.icon,
    case when public.get_user_role() = 'admin' then 'approved'::text else dm.status end as status,
    coalesce(dm.member_role, case when public.get_user_role() = 'admin' then '시스템관리자'::text end) as member_role
  from public.departments d
  left join public.department_members dm
    on dm.department_id = d.id
   and dm.user_id = auth.uid()
  where d.is_active = true
    and (public.get_user_role() = 'admin' or dm.id is not null)
  order by d.category, d.order_no, d.name;
$$;

revoke all on function public.get_my_departments() from public, anon;
grant execute on function public.get_my_departments() to authenticated;
