# Cleanup Inventory - 2026-05-18

## 결론

삭제하지 않았다. 1차 정리로 후보 파일을 `MS_AX/archive/2026-05-18_cleanup_candidates/` 아래로 이동했다.

다음에 실제 삭제를 할 때는 이 문서를 기준으로 사용자가 확인한 뒤 진행한다.

## 1차 아카이브 완료

아카이브 위치:

- `MS_AX/archive/2026-05-18_cleanup_candidates/`

이동 결과:

- 823 files
- 약 269.83 MB

아카이브 하위 분류:

- `captures/`
  - HTML 캡처, 임시 PDF, 검수 스크린샷, unmatched photo CSV 등
- `extraction_outputs/`
  - HWPX/PDF 중간 추출물, parsed-data, db-pdf-images, pptx-images 등
- `image_outputs/`
  - Gemini/image/KakaoTalk/menu concept 이미지 산출물
- `legacy_import_scripts/`
  - 초기 import/backfill/photo matching 실험 스크립트

삭제는 아직 하지 않았다.

Git 처리:

- `MS_AX/archive/`는 `.gitignore`에 추가했다.
- 아카이브 파일은 로컬 보관용이며 git 커밋에는 포함하지 않는다.
- 기존에 git이 추적하던 레거시 스크립트/이미지의 원래 위치 삭제는 정리 변경으로 커밋한다.

## 반드시 보존

### 운영 DB/마이그레이션

- `MS_AX/chflow-project/supabase/migrations/`
- `MS_AX/chflow-project/supabase/config.toml`
- `MS_AX/chflow-project/supabase/functions/`

이유:

- 운영 Supabase에 적용된 SQL 이력이다.
- 원격 migration history가 로컬과 완전히 정렬되어 있지 않으므로 `supabase db push`는 사용하지 않는다.
- 새 SQL은 다음 방식으로 개별 적용한다.

```powershell
cd C:\csh\project\chflow\MS_AX\chflow-project
npx supabase db query --linked --file supabase\migrations\<file>.sql
```

### 운영/검수 인수인계 문서

- `MS_AX/operations_handoff_2026-05-18.md`
- `MS_AX/mdb_review_handoff_2026-05-13.md`
- `MS_AX/mdb_merge_review_spec.md`

이유:

- 현재 검수 종료 상태, DB 규칙, 배포 검증 결과가 들어 있다.

### 백업

- `MS_AX/chflow-project/db-backups/`

현재 규모:

- 497 files
- 약 35.9 MB

이유:

- MDB merge/review 전후 복구 기준이다.
- 당분간 삭제하지 않는다.

## 주의 보존

### 회원 export/import 도구

- `MS_AX/export_members.py`
- `MS_AX/import_members.py`

상태:

- 현재 운영 데이터의 엑셀 백업/복원성 작업에 사용할 수 있다.
- `import_members.py`는 DB 변경 도구이므로 실행 전 백업과 명시적 승인 필요.

권장:

- 유지.
- 나중에 `MS_AX/tools/member_excel/` 같은 폴더로 옮기고 README를 붙이는 것이 좋다.

### 비상 복구 스크립트

- `MS_AX/restore_supabase_members_households.py`

상태:

- `members`, `households`를 삭제 후 백업으로 복원하는 매우 위험한 스크립트다.

권장:

- 삭제하지 말고 `MS_AX/tools/dangerous_restore/` 같은 곳에 격리.
- 파일 상단에 `DO NOT RUN WITHOUT EXPLICIT APPROVAL` 주석 추가 권장.

### MDB staging 적재 스크립트

- `MS_AX/load_active_members_to_staging.py`

상태:

- MDB 원본 staging 적재에 사용된 스크립트다.
- MDB merge는 완료됐지만 재현성 때문에 당분간 보존.

권장:

- 유지 또는 `MS_AX/tools/mdb_import/`로 이동.

## 아카이브 후보

실행될 가능성은 낮지만, 작업 재현이나 감사 용도로 조금 더 보관할 수 있는 파일이다.

### 초기 PDF/사진/관계 backfill 스크립트

- `MS_AX/backfill_gender_relations.py`
- `MS_AX/backfill_relations_v3.py`
- `MS_AX/backfill_relations_v4.py`
- `MS_AX/backfill_child_adult_links.sql`
- `MS_AX/_backfill_relations.sql`
- `MS_AX/match_photos_to_members.py`
- `MS_AX/match_photos_fallback.py`
- `MS_AX/match_photos_phone.py`
- `MS_AX/match_photos_spouse.py`
- `MS_AX/match_photos_v3.py`

상태:

- 대부분 과거 PDF/엑셀 기반 일괄 처리용이다.
- 현재 운영에서는 검수와 사진 매칭이 완료됐으므로 직접 실행하면 위험하다.

권장:

- 삭제보다는 `MS_AX/archive/2026-05-18_legacy_import_scripts/`로 이동.
- 이동 전 파일 경로 하드코딩을 끊어야 하는지 검토 필요.

### 초기 엑셀 import 실험 스크립트

- `MS_AX/import_from_excel_v2.py`
- `MS_AX/import_from_excel_v3.py`
- `MS_AX/import_to_supabase.py`
- `MS_AX/merge_and_export.py`
- `MS_AX/merge_v3.py`
- `MS_AX/extract_all.py`
- `MS_AX/extract_v3.py`
- `MS_AX/parse_pasture.py`
- `MS_AX/parse_photo.py`

상태:

- 초창기 데이터 구축/추출용이다.
- 현재 운영 경로에서는 사용하지 않는다.

권장:

- 아카이브 폴더로 이동.
- 바로 삭제는 보류.

## 삭제 후보

아래는 운영 재현성에 중요하지 않은 캡처/중간 산출물로 보인다. 삭제 전 사용자가 마지막 확인한다.

### HTML 캡처/임시 파일

- `MS_AX/_board.html`
- `MS_AX/_login.html`
- `MS_AX/_write.html`
- `MS_AX/_write_authed.html`
- `MS_AX/_font_usage.txt`
- `MS_AX/main` 빈 파일

권장:

- 삭제 가능 후보.

### HWPX/PDF 중간 추출 산출물

- `MS_AX/_hwpx2/`
- `MS_AX/_hwpx_layout/`
- `MS_AX/tmp_pdf_pages/`

현재 규모:

- `_hwpx2`: 19 files, 약 1.19 MB
- `_hwpx_layout`: 20 files, 약 1.2 MB
- `tmp_pdf_pages`: 34 files, 약 4.48 MB

권장:

- 삭제 가능 후보.
- 단, PDF 원본 재처리가 필요할 수 있으면 아카이브 후 삭제.

### 이미지/디자인 실험 산출물

- `MS_AX/Gemini_Generated_Image_*.png`
- `MS_AX/image_*.png`
- `MS_AX/KakaoTalk_*.png`
- `MS_AX/menu_concept_layout.png`
- `MS_AX/pptx-images/`

현재 규모:

- `pptx-images`: 65 files, 약 19.4 MB
- 개별 Gemini/image PNG도 수십 MB 수준.

권장:

- 제품/스토어 자료로 쓰지 않는다면 삭제 후보.
- 스토어/브랜딩 산출물과 섞이지 않도록 먼저 확인 필요.

### 과거 PDF 이미지/파싱 산출물

- `MS_AX/db-pdf-images/`
- `MS_AX/parsed-data/`

현재 규모:

- `db-pdf-images`: 111 files, 약 30.14 MB
- `parsed-data`: 528 files, 약 180.71 MB

권장:

- 가장 큰 삭제 후보.
- 다만 사진 재매칭이나 원본 검증 재현에 필요할 수 있으므로, 삭제 전 `member-photos` storage와 최종 DB가 확정이라는 전제가 필요하다.
- 당장은 삭제보다 압축 아카이브 권장.

### 기타 산출물

- `MS_AX/_test_bulletin.pdf`
- `MS_AX/review-mdb-prod-check.png`
- `MS_AX/unmatched_photos_2026-04-24.csv`
- `MS_AX/exports/` 빈 폴더

권장:

- `_test_bulletin.pdf`: 삭제 후보
- `review-mdb-prod-check.png`: 문서화 완료 후 삭제 후보
- `unmatched_photos_2026-04-24.csv`: 사진 작업 재개 가능성이 있으므로 보류 또는 아카이브
- `exports/`: 빈 폴더라 삭제 가능

## 다음 실행안

### 안전한 1차 정리

완료. 삭제 대신 아카이브 폴더로 이동했다.

권장 아카이브 위치:

- `MS_AX/archive/2026-05-18_cleanup_candidates/`

이동한 후보:

- HTML 캡처
- HWPX/PDF 중간 산출물
- 초기 import/backfill 실험 스크립트
- 과거 이미지 실험 산출물

### 실제 삭제는 2차

아카이브 후 앱 빌드와 운영 상태 점검이 통과하면, 용량 큰 산출물부터 삭제한다.

우선순위:

1. `MS_AX/parsed-data/`
2. `MS_AX/db-pdf-images/`
3. `MS_AX/pptx-images/`
4. `MS_AX/Gemini_Generated_Image_*.png`, `MS_AX/image_*.png`
5. HTML 캡처/빈 폴더

## 실행 금지 메모

아래 파일은 운영 DB를 직접 변경하거나 전체 복원/삭제를 할 수 있으므로 실수로 실행하면 안 된다.

- `MS_AX/import_members.py`
- `MS_AX/restore_supabase_members_households.py`
- `MS_AX/import_from_excel_v2.py`
- `MS_AX/import_from_excel_v3.py`
- `MS_AX/import_to_supabase.py`
- `MS_AX/backfill_relations_v3.py`
- `MS_AX/backfill_relations_v4.py`
- `MS_AX/match_photos_v3.py`
