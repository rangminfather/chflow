-- 학생 구분 '소' 제거 — 초기 종이 명단(초등1부 xlsx)의 흔적으로 어떤 로직도 참조하지 않음.
-- 현재 데이터 분포: 정 44 / 체험 1 / 소 0 (2026-07-12 확인) — 값 이관 불필요.
-- 구분(정/체험)은 새친구 등반 파이프라인이 자동 관리하며 UI 노출도 제거됨.

do $$
begin
  -- 혹시 남아있을 '소' 값 방어적 정리
  update public.edu_students set student_type = '정' where student_type = '소';

  alter table public.edu_students drop constraint if exists edu_students_student_type_check;
  alter table public.edu_students
    add constraint edu_students_student_type_check check (student_type in ('정', '체험'));
end $$;
