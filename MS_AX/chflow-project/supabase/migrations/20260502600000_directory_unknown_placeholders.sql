-- =============================================================
-- 평원/초원/목장 "(미정)" placeholder 추가
--
-- 목적: 회원의 소속을 단계별로 모를 때(예: 평원만 알고 초원/목장 모름)
--       강제로 입력하지 않고도 저장 가능하게 함.
--
-- 추가:
--   1) "미지정" 평원 (셋 다 모르는 케이스)
--   2) 모든 평원에 "(미정)" 초원
--   3) 모든 초원에 "(미정)" 목장
--
-- (모두 order_no=99 — 드롭다운 맨 아래)
-- =============================================================

-- 1) 미지정 평원
INSERT INTO public.plains (name, display_name, order_no)
SELECT '미지정', '미지정평원', 99
WHERE NOT EXISTS (SELECT 1 FROM public.plains WHERE name = '미지정');

-- 2) 모든 평원에 "(미정)" 초원
INSERT INTO public.grasslands (plain_id, name, order_no)
SELECT pl.id, '(미정)', 99
FROM public.plains pl
WHERE NOT EXISTS (
  SELECT 1 FROM public.grasslands g WHERE g.plain_id = pl.id AND g.name = '(미정)'
);

-- 3) 모든 초원에 "(미정)" 목장
INSERT INTO public.directory_pastures (grassland_id, name, order_no)
SELECT g.id, '(미정)', 99
FROM public.grasslands g
WHERE NOT EXISTS (
  SELECT 1 FROM public.directory_pastures dp
  WHERE dp.grassland_id = g.id AND dp.name = '(미정)'
);
