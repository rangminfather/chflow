-- NOTE (added 2026-09-14 during migration-history reconciliation): applied
-- directly to production on 2026-09-13. This file backfills the local
-- migrations folder to match production; do not re-derive or "redo" this —
-- it is already live.

-- 정다솔·하재훈은 실제 배우자 관계다.
-- 정다솔에게 남아 있던 자녀 플래그/세대 역할만 배우자 정보로 정정한다.

UPDATE public.members
SET is_child = false,
    relationship_in_household = '배우자',
    spouse_id = '752e5ded-5245-45ae-ab35-72d3a71c8c6c'::uuid,
    spouse_name = '하재훈'
WHERE id = 'd3214e89-2acb-4bd6-ab29-dcd3c0bfab90'::uuid
  AND name = '정다솔';

UPDATE public.members
SET spouse_id = 'd3214e89-2acb-4bd6-ab29-dcd3c0bfab90'::uuid,
    spouse_name = '정다솔'
WHERE id = '752e5ded-5245-45ae-ab35-72d3a71c8c6c'::uuid
  AND name = '하재훈';
