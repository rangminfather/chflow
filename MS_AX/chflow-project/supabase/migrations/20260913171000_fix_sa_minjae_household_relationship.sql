-- NOTE (added 2026-09-14 during migration-history reconciliation): applied
-- directly to production on 2026-09-13. This file backfills the local
-- migrations folder to match production; do not re-derive or "redo" this —
-- it is already live.

-- OCR 보정 배치가 사민재를 안준·백혜진의 자녀로 잘못 연결한 데이터를 정정한다.
-- 실제 저장된 배우자 관계(김새롬)를 기준으로 세대와 기본 관계 상태를 복구한다.

DELETE FROM public.member_relations
WHERE subject_id = '79799a51-b52e-4070-87a1-8a8654b084ab'::uuid
  AND relative_id IN (
    'b0e146c3-f48a-4234-a17e-a04848523c1a'::uuid,
    'cebe09d5-98d3-4230-8d07-012f80803311'::uuid
  )
  AND kind = 'parent';

UPDATE public.members
SET household_id = (SELECT household_id FROM public.members WHERE id = '45f4a8fc-d06a-4241-87ef-69c0d9ca6b69'::uuid),
    relationship_in_household = '배우자',
    is_child = false,
    sub_role = NULL,
    spouse_id = '45f4a8fc-d06a-4241-87ef-69c0d9ca6b69'::uuid,
    spouse_name = '김새롬'
WHERE id = '79799a51-b52e-4070-87a1-8a8654b084ab'::uuid
  AND name = '사민재';

UPDATE public.members
SET spouse_id = '79799a51-b52e-4070-87a1-8a8654b084ab'::uuid,
    spouse_name = '사민재'
WHERE id = '45f4a8fc-d06a-4241-87ef-69c0d9ca6b69'::uuid
  AND name = '김새롬';
