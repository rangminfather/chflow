# MDB Merge Review Spec

목적:
- `staging_members_mdb`를 기준 교적 데이터로 사용해 `members`를 교정/보강한다.
- 운영 중인 `Supabase` 데이터는 보호하고, 사람이 검수한 결과만 부분 반영한다.

원칙:
- 인적정보: `MDB 우선`
- 목장정보: `Supabase 우선`
- 사진정보: 별도 검수
- 앱 운영정보: `Supabase 유지`
- 작업 흐름: `백업 -> staging -> 검수 -> 부분 merge`

## 1. 검수 페이지에 꼭 필요한 컬럼

### A. 매칭 판단용
- `members.id`
- `members.name`
- `members.phone`
- `members.birth_date`
- `members.address`
- `members.spouse_name`
- `members.household_id`
- `staging_members_mdb.id`
- `staging_members_mdb.legacy_kyoin_id`
- `staging_members_mdb.legacy_family_num`
- `staging_members_mdb.name`
- `staging_members_mdb.phone`
- `staging_members_mdb.birth_date`
- `staging_members_mdb.address_line_1`
- `staging_members_mdb.address_line_2`
- `staging_members_mdb.relationship_in_household`

### B. 인적정보 비교용
- 기존값: `members.name`, `members.birth_date`, `members.phone`, `members.address`
- MDB값: `staging.name`, `staging.birth_date`, `staging.phone`, `staging.address_line_1`, `staging.address_line_2`
- 추가 참고값:
  - `staging.gender`
  - `staging.relationship_in_household`
  - `staging.legacy_family_num`
  - `staging.birth_raw`

### C. 운영정보 보존 확인용
- `members.family_church`
- `members.sub_role`
- `members.photo_url`
- `members.photo_status`
- `members.review_status`
- `members.review_note`
- `members.notes`
- `members.household_id`

### D. 화면 표시용 추천 파생값
- `match_score`
- `phone_equal`
- `birth_equal`
- `address_equal`
- `name_equal`
- `is_existing_member`
- `has_conflict`
- `conflict_fields[]`

## 2. 검수 결과 상태값

### A. row 단위 상태
- `unreviewed`
  - 아직 검수 안 함
- `matched`
  - 기존 `members`의 특정 row와 동일 인물로 확정
- `new_member`
  - 기존 `members`에 없는 신규 회원으로 판단
- `hold`
  - 애매해서 보류
- `ignored`
  - 이번 merge 대상에서 제외
- `applied`
  - 실제 반영 완료

### B. 필드 단위 판단
- `use_mdb`
  - MDB 값 채택
- `keep_supabase`
  - 기존값 유지
- `manual_edit`
  - 사람이 직접 수정 후 반영
- `not_applicable`
  - 비교/반영 대상 아님

## 3. 반영 대상 필드

### MDB 우선 반영 필드
- `members.name`
- `members.birth_date`
- `members.phone`
- `members.address`
- `members.gender` if exists
- 신규 컬럼 권장:
  - `members.legacy_kyoin_id`
  - `members.legacy_family_num`
  - `members.relationship_in_household`

### Supabase 유지 필드
- `members.family_church`
- `members.sub_role`
- `members.household_id`
- `members.photo_url`
- `members.photo_status`
- `members.review_status`
- `members.review_note`
- `members.notes`

### 별도 검수 필드
- 배우자/가족관계 연결
- 사진 매칭
- household 재편성

## 4. 검수 페이지에서 필요한 액션

### A. 매칭 관련
- `같은 사람으로 확정`
  - staging row를 특정 `members.id`에 연결
- `신규 회원으로 처리`
  - 새 `members` row 생성 대상으로 표시
- `보류`
  - 사람이 나중에 다시 검토

### B. 필드 반영 관련
- `인적정보만 MDB로 적용`
- `전화만 적용`
- `주소만 적용`
- `생년월일만 적용`
- `이름만 적용`
- `직접 수정 후 적용`

### C. 운영정보 관련
- `목장정보 유지`
- `사진 유지`
- `메모 유지`

## 5. 반영 시 실제 동작

### A. 기존 회원에 매칭된 경우
- `update public.members`
- 업데이트 대상:
  - `name`
  - `birth_date`
  - `phone`
  - `address`
  - `legacy_kyoin_id`
  - `legacy_family_num`
  - `relationship_in_household`
- 유지 대상:
  - `family_church`
  - `sub_role`
  - `household_id`
  - `photo_url`
  - `photo_status`
  - `review_status`
  - `review_note`
  - `notes`

### B. 신규 회원으로 판단된 경우
- `insert into public.members`
- 초기 입력 필드:
  - `name`
  - `birth_date`
  - `phone`
  - `address`
  - `legacy_kyoin_id`
  - `legacy_family_num`
  - `relationship_in_household`
  - `status = 'active'`
- 목장/사진은 비워두거나 후속 검수

### C. 보류인 경우
- 운영 테이블 미수정
- staging row에 보류 사유만 기록

## 6. 추천 구현 구조

### A. 추가 테이블 권장
- `staging_member_matches`
  - `id`
  - `staging_id`
  - `member_id`
  - `match_status`
  - `match_score`
  - `review_note`
  - `reviewed_by`
  - `reviewed_at`

- `staging_member_field_decisions`
  - `id`
  - `staging_id`
  - `member_id`
  - `field_name`
  - `decision`
  - `mdb_value`
  - `supabase_value`
  - `final_value`
  - `reviewed_by`
  - `reviewed_at`

### B. 비교 페이지 추천 URL
- `/admin/review-mdb`

### C. 필요 RPC
- `admin_mdb_review_candidates()`
  - staging row + 기존 members 후보 반환
- `admin_mdb_review_confirm_match(...)`
  - 동일인 확정
- `admin_mdb_review_set_field_decision(...)`
  - 필드별 판단 저장
- `admin_mdb_review_apply(...)`
  - 검수 완료분 실제 반영

## 7. 최소 검수 순서

1. 같은 사람인지 확인
2. 생년월일 비교
3. 전화번호 비교
4. 주소 비교
5. 가족번호/관계 확인
6. 인적정보는 MDB 채택 여부 결정
7. 목장/사진/메모는 기존 유지 여부 확인
8. `applied` 또는 `hold`

## 8. 한 줄 요약

이 페이지의 목적은
`MDB를 기준 교적으로 삼되, 운영 중인 Supabase 데이터를 보호하면서 필요한 인적정보만 승인 기반으로 보강하는 것`이다.
