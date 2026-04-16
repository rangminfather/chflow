-- 자녀 더미(is_child=true) ↔ 실제 성인 member(is_child=false, 다른 household) 연결
-- 휴리스틱: 자녀 더미가 속한 가족의 부모 성인과 같은 이름의 성인 후보의 phone 뒷 4자리 일치
-- 매칭된 쌍에 대해 부모-성인자녀 관계를 member_relations에 기록 (parent/father or mother)

WITH child_dummies AS (
  SELECT id, name, household_id
  FROM members
  WHERE is_child = true
),
-- 자녀 더미의 부모 후보 = 같은 household의 성인
family_parents AS (
  SELECT
    cd.id AS child_dummy_id,
    cd.name AS child_name,
    cd.household_id,
    p.id AS parent_id,
    p.name AS parent_name,
    p.phone AS parent_phone,
    regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') AS parent_phone_digits,
    p.gender AS parent_gender
  FROM child_dummies cd
  JOIN members p
    ON p.household_id = cd.household_id
   AND p.is_child = false
),
-- 성인 자녀 후보 = 다른 household의 같은 이름 성인
adult_candidates AS (
  SELECT
    fp.child_dummy_id,
    fp.parent_id,
    fp.parent_gender,
    am.id AS adult_id,
    am.name AS adult_name,
    regexp_replace(coalesce(am.phone, ''), '\D', '', 'g') AS adult_phone_digits
  FROM family_parents fp
  JOIN members am
    ON am.name = fp.child_name
   AND am.is_child = false
   AND am.household_id <> fp.household_id
  WHERE length(fp.parent_phone_digits) >= 4
    AND length(regexp_replace(coalesce(am.phone, ''), '\D', '', 'g')) >= 4
    AND right(fp.parent_phone_digits, 4)
        = right(regexp_replace(coalesce(am.phone, ''), '\D', '', 'g'), 4)
),
-- 자녀더미→성인자녀 1:1만 허용 (동명이인 오매칭 방지): 같은 child_dummy_id에 성인 후보가 정확히 1명
strict AS (
  SELECT ac.*
  FROM adult_candidates ac
  JOIN (
    SELECT child_dummy_id
    FROM (SELECT DISTINCT child_dummy_id, adult_id FROM adult_candidates) d
    GROUP BY child_dummy_id
    HAVING COUNT(*) = 1
  ) uniq ON uniq.child_dummy_id = ac.child_dummy_id
),
-- 실제 member_relations 삽입 행
inserted AS (
  INSERT INTO member_relations (subject_id, relative_id, kind, role)
  SELECT DISTINCT
    adult_id,
    parent_id,
    'parent',
    CASE parent_gender WHEN 'M' THEN 'father'
                       WHEN 'F' THEN 'mother'
                       ELSE NULL END
  FROM strict
  ON CONFLICT (subject_id, relative_id, kind) DO NOTHING
  RETURNING id
)
SELECT
  (SELECT COUNT(*) FROM child_dummies)                               AS total_child_dummies,
  (SELECT COUNT(DISTINCT child_dummy_id) FROM adult_candidates)      AS dummies_with_any_candidate,
  (SELECT COUNT(DISTINCT child_dummy_id) FROM strict)                AS dummies_uniquely_matched,
  (SELECT COUNT(*) FROM inserted)                                    AS relations_inserted;
