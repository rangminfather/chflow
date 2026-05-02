-- =============================================================
-- 평원/초원/목장 placeholder 이름 통일: '미지정' / '(미정)' → '미정'
-- =============================================================

-- 평원: '미지정' → '미정'
UPDATE public.plains
SET name = '미정', display_name = '미정평원'
WHERE name = '미지정';

-- 초원: '(미정)' → '미정' (모든 평원)
UPDATE public.grasslands
SET name = '미정'
WHERE name = '(미정)';

-- 목장: '(미정)' → '미정' (모든 초원)
UPDATE public.directory_pastures
SET name = '미정'
WHERE name = '(미정)';
