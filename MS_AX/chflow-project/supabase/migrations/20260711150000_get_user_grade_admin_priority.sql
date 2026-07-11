-- =============================================================
-- get_user_grade: 시스템 role(admin/office/pastor)이 부서 등급보다 우선
--
-- 배경(2026-07-11 결정): 베타 기간 동안 관리자에게 전체 권한 부여.
--   기존 coalesce 구조는 department_members 행이 있으면 그 grade가
--   시스템 role 폴백(0)보다 우선 → admin이 부서에 교사(3)로 임명되면
--   그 부서에서만 등급 3으로 강등되는 비대칭 발생.
--
-- 변경: least(부서 등급, 시스템 role 폴백) — admin/office/pastor는
--   부서 임명과 무관하게 항상 0. 일반 사용자는 종전과 동일
--   (least(dm.grade, 99) = dm.grade / 행 없으면 99).
--
-- 나중에 관리자 role을 회수하면 자동으로 부서 등급 기반으로 돌아간다.
-- =============================================================

create or replace function public.get_user_grade(p_dept_id uuid)
returns smallint
language sql security definer set search_path = public as $$
  select least(
    coalesce(
      (select grade::smallint from department_members
        where department_id = p_dept_id
          and user_id = auth.uid()
          and status = 'approved'
        limit 1),
      99::smallint
    ),
    case when public.get_user_role() in ('admin', 'office', 'pastor') then 0::smallint
         else 99::smallint
    end
  );
$$;
