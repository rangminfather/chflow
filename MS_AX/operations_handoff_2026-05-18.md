# Operations Handoff - 2026-05-18

## Current Production State

- Production URL: `https://chflow-app.vercel.app`
- Current production deployment inspected as ready:
  - `dpl_BhfpzhLc68skThCZhR8SVSRUYXo7`
  - alias: `https://chflow-app.vercel.app`
- Supabase production environment variables were corrected on Vercel:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Previous issue fixed: Supabase URL/key values had a literal trailing `\n`, causing Realtime WebSocket auth failures.

## Review/MDB Work Status

- MDB merge review is complete.
- PDF review is complete.
- Photo matching review is complete for the adult directory scope.
- Review pages are intentionally closed:
  - `/admin/review`
  - `/admin/review-mdb`
- Admin entry points to review pages were removed from:
  - `/home`
  - `/admin/members`
- Future edits should be done through `/admin/members`, not through the old review pages.

## Production Verification Completed

### 1. Operational Smoke Check

Verified with a temporary admin account, then deleted the account.

- Login works.
- `/home` works.
- `/admin/members` works.
- `/admin/password-reset` works.
- `/admin/pending` works.
- `/admin/rearrange` works.
- `/admin/votes` works.
- `/admin/review` shows the closed review page.
- `/admin/review-mdb` shows the closed MDB review page.
- Browser runtime errors: 0.
- Console errors after env fix: 0.

### 2. Core Admin Flow Check

Verified with a temporary admin account and a temporary member, then deleted both.

- Admin login works.
- Home admin navigation works for:
  - members
  - votes
  - rearrange
- Member management loads.
- Member search works.
- Member card detail opens.
- Member add modal opens.
- Temporary member create works.
- Created member appears in search.
- Temporary member update works.
- Updated member appears in search.
- Temporary member delete works.
- Deleted member no longer appears in search.
- Direct admin pages load:
  - `/admin/password-reset`
  - `/admin/pending`
  - `/admin/rearrange`
  - `/admin/votes`
  - `/departments`
- Temporary test leftovers:
  - `codexflow%` profiles: 0
  - `운영점검_%` members: 0

### 3. Production DB Review Residual Check

Final production DB state:

- Total active members: 2142
- `review_status != verified`: 0
- Raw review flags: 0
- PDF review filters:
  - `needs_check`: 0
  - `needs_household`: 0
  - `no_photo`: 0
  - `spouse_mismatch`: 0
  - `bad_phone`: 0
  - `orphan_child`: 0
  - `duplicate_name_birth`: 0
  - `duplicate_legacy`: 0
- MDB review filters:
  - `needs_check`: 0
  - `needs_household`: 0
  - `no_photo`: 0
  - `spouse_mismatch`: 0
  - `bad_phone`: 0
  - `orphan_child`: 0
  - `duplicate_name_birth`: 0
  - `duplicate_legacy`: 0
- Duplicate legacy ID members: 0
- Duplicate name+birth members: 0

## Special Cases Closed

- `주성철`
  - Spouse name `김은선` remains free text.
  - The registered `김은선` is treated as a different person, spouse of `설수환`.
  - No relationship link should be created.
  - `spouse_mismatch` is now suppressed when a verified note contains `배우자 동명이인`.

- `정순남`
  - Manual active member with household/pasture/address.
  - No PDF/MDB source.
  - Treated as valid manual member.
  - Marked `verified`.

- Education-roster children without registered parents/MDB source
  - Kept as valid.
  - Not deletion targets.
  - Verified operational exceptions should not raise raw review flags.

## DB Migrations Applied Manually

Do not run `supabase db push` in this project. Remote migration history is not aligned.

Use this pattern only:

```powershell
cd C:\csh\project\chflow\MS_AX\chflow-project
npx supabase db query --linked --file supabase\migrations\<file>.sql
```

Latest applied migrations:

- `20260517030000_admin_review_close_verified_operational_flags.sql`
- `20260518010000_admin_review_suppress_verified_operational_exceptions.sql`
- `20260518011000_admin_review_spouse_homonym_note_unicode.sql`
- `20260518020000_admin_ops_health_summary.sql`
- `20260518030000_separate_current_directory_members.sql`

## App Files Changed For Review Closure

- `C:\csh\project\chflow\chflow-app\app\admin\review\page.tsx`
  - Replaced with a closed review notice.
- `C:\csh\project\chflow\chflow-app\app\admin\review-mdb\page.tsx`
  - Replaced with a closed MDB review notice.
- `C:\csh\project\chflow\chflow-app\app\home\page.tsx`
  - Removed the data review admin button.
- `C:\csh\project\chflow\chflow-app\app\admin\members\page.tsx`
  - Removed the data review button.
  - Added home phone display/edit support.
  - Added an entry button for `/admin/ops-status`.

## Operations Status Dashboard

Added an admin-only status page:

- `C:\csh\project\chflow\chflow-app\app\admin\ops-status\page.tsx`
- URL: `/admin/ops-status`
- Entry point: `/admin/members` top action buttons

Added RPC:

- `admin_ops_health_summary()`
- Migration:
  - `20260518020000_admin_ops_health_summary.sql`

The page shows:

- total/active member counts
- unverified member count
- review flag counts
- duplicate legacy ID count
- duplicate name+birth count
- temporary Codex/test leftovers
- PDF review filter counts
- MDB review filter counts

Build verification:

- `npm run build` passed.

RPC verification:

- Temporary admin account could call `admin_ops_health_summary()`.
- Temporary admin account was deleted afterward.
- Temp leftovers after check:
  - `codex%` profiles: 0
  - `운영점검_%` members: 0

## Current / Reference Member Separation

Applied on 2026-05-18:

- Migration:
  - `20260518030000_separate_current_directory_members.sql`
- Current operational member rule:
  - member is listed in the church directory PDF (`source_page is not null`)
  - member belongs to a directory pasture through `household_id -> households.pasture_id`
- Manual active exception:
  - manual records with pasture assignment and no MDB legacy id remain `active`
- Reference/legacy rule:
  - MDB/manual records not backed by the church directory PDF pasture roster are kept, but set to `inactive`
  - they are not deleted because family relations, phone numbers, birth dates, and historical matching can still be useful

Verified production counts after separation:

- total members: 2,142
- current active members: 1,282
- separated inactive/reference members: 860

Operational behavior after the change:

- `admin_search_members_paged(...)` defaults to `active` members only.
- The admin members page has a status filter:
  - current members
  - separated/reference members
  - all members
- `find_member_for_signup(...)` only matches active members.
- `search_member_candidates(...)` only returns active members.

Deletion policy:

- Do not bulk-delete the 860 separated members yet.
- Next safe deletion pass should start from inactive MDB-only records with no profile, no education/student link, no offerings, and no family relation.
- Prefer export/report first, delete second.

## Deployment Command

Run from repo root:

```powershell
cd C:\csh\project\chflow
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-chflow-app.ps1
```

Confirm after deployment:

```powershell
cd C:\csh\project\chflow\chflow-app
vercel inspect https://chflow-app.vercel.app
```

## Next Work Candidates

1. Deploy and smoke-check the current/reference member separation UI.
2. Commit the separation migration and admin members UI update.
3. Produce an inactive-member deletion candidate report.
4. Add a permanent operational smoke-check script so future deploys can re-run login/admin/member CRUD checks.
5. Start the next product area: person-photo matching for remaining future photos, including support for people who have no photo.

## Cleanup Inventory

Cleanup inventory was created:

- `C:\csh\project\chflow\MS_AX\cleanup_inventory_2026-05-18.md`

No files were deleted during this pass. Cleanup candidates were moved to:

- `C:\csh\project\chflow\MS_AX\archive\2026-05-18_cleanup_candidates\`

Archive result:

- 823 files
- about 269.83 MB

The inventory classifies files as:

- keep
- caution keep
- archive candidates
- delete candidates

Important: do not execute old import/backfill/restore scripts without explicit approval. Some of them can update or delete production DB rows.

## Photo Review / Directory Correction Handoff - 2026-05-19

Production DB corrections applied through Supabase REST service-role access.

Photo extraction / review system:

- Re-extracted directory photos from `자료\데이터베이스 추출용.pdf`.
- Uploaded 582 crops to `member-photos/directory-crops-v2/`.
- Replaced `directory_photo_crops` rows with the v2 crop set.
- Added admin photo review support for "no photo in PDF".
- Added `admin_mark_member_no_photo(...)` RPC.
- Deployed the photo review UI to production.

Important photo matching rule:

- A member can legitimately have no photo in the directory PDF.
- Spouse-only photo cases must not be auto-attached to the spouse who has the phone number.
- For these cases, set the member to:
  - `photo_url = null`
  - `photo_page = null`
  - `photo_status = 'no_photo_in_pdf'`
- If a crop belongs to a spouse/reference person and would be matched only by the active member's phone number, keep `directory_photo_crops.expected_member_id = null`.

Manual name/photo corrections saved in production DB:

- 김규본 -> 김규호
- 이명선 -> 이영선
- 김산길 -> 김선길
- 김운복 -> 김준혁
- 박감인 -> 박강인
- 천찬규/김찬규 -> 전진규
- 최송옥 -> 최승욱
- 황정모 -> 황창모
- 강영숙 -> 강명숙
- 김경희 -> 김경화
- 김새흠 -> 김새롬
- 류이영 -> 류아영

Manual photo label / matching corrections:

- 정순길: crop `p006_photo11.png`
- 최성헌: crop `p011_photo14.png`
- 김시원: crop `p023_photo14.png`
- 전진규: crop `p024_photo13.png`
- 최승욱: crop `p028_photo08.png`
- 황창모: crop `p028_photo14.png`
- 강명숙: crop `p029_photo01.png`
- 김경화: crop `p030_photo02.png`
- 김새롬: crop `p030_photo07.png`
- 류아영: crop `p031_photo14.png`
- 엄경애: crop `p034_photo11.png`

No-photo / spouse corrections applied:

- 최성현: no photo in PDF.
- 신수식: no photo in PDF, spouse 최순연.
- 백형준: no photo in PDF, spouse 문미숙.
- 강승원: no photo in PDF, spouse 우영섭.
- 김선한: no photo in PDF, spouse 황신화.
- 황신화: wrong 김영숙 photo removed, spouse 김선한.
- 김효중: no photo in PDF, spouse 이창희.
- 박이서: no photo in PDF, spouse 김수진.

Role corrections applied from user verification:

- 강승원 is spouse only; 우영섭 is 은퇴권사.
- 김성희 is 협동권사; 이정수 is 서리집사.
- 박래동 is 서리집사; 기미녀 is 협동권사.

Crop upload script safeguards:

- `scripts/upload-directory-photo-crops.py` now contains verified label overrides.
- These overrides prevent known OCR/name mistakes from returning on the next crop re-upload.
- `skip_expected` is used for spouse-only photo crops:
  - `p030_photo10.png` 김수진, prevents auto-matching to 박이서
  - `p036_photo03.png` 이창희, prevents auto-matching to 김효중
  - `p039_photo11.png` 김영숙, prevents auto-matching to 황신화

Commits related to this work:

- `25e6308 fix: reextract directory photo crops`
- `d6fddaf feat: add photo review no-photo action`
- `c8741ce fix: preserve verified photo crop corrections`

Still pending:

1. Continue conservative `sub_role` normalization from the directory PDF.
2. Do not bulk-apply ambiguous role changes that cross role families or originate from spouse-adjacent OCR text.
3. Safe automatic role normalizations are:
   - `집사` -> `서리집사`
   - `권사` -> `시무권사`
   - `장로` -> `시무장로`
   - `집사/시무집사` -> `시무집사` only when PDF evidence is direct.
4. Keep explicit roles such as 은퇴권사, 명예권사, 은퇴장로, 원로장로, 명예집사 unless the PDF evidence is direct and unambiguous.

## Sub-role Normalization Pass - 2026-05-20

Read-only report script added:

- `scripts/analyze-sub-role-normalization.py`

Generated latest local report files:

- `MS_AX/generated/sub_role_normalization_candidates_2026-05-20.csv`
- `MS_AX/generated/sub_role_normalization_report_2026-05-20.md`

Report inputs:

- Production Supabase `members`, read through service-role REST.
- Parsed directory PDF workbook from the cleanup archive:
  - `MS_AX/archive/2026-05-18_cleanup_candidates/extraction_outputs/parsed-data/명성교회_회원DB_검수용_v2.1.xlsx`

Matching rule:

- same normalized member name
- same directory `source_page`
- phone overlap preferred; unique name/page accepted for report classification

Safe automatic update applied manually:

- Migration/query file:
  - `chflow-project/supabase/migrations/20260520010000_sub_role_safe_normalization.sql`
- Applied with:
  - `npx supabase db query --linked --file supabase\migrations\20260520010000_sub_role_safe_normalization.sql`
- Updated:
  - 강범석, page 110, `집사` -> `서리집사`
- Guard conditions used:
  - exact member id
  - `status = 'active'`
  - `name = '강범석'`
  - `source_page = 110`
  - current `sub_role = '집사'`
  - phone digits match `01044145451`

Verification after update:

- Production row now has `sub_role = '서리집사'`.
- Re-running the report produced:
  - direct differing matches: 46
  - safe automatic candidates: 0
  - manual review candidates: 46

Remaining work:

1. Review the 46 manual candidates in the CSV.
2. Do not bulk-apply them without human confirmation.
3. Focus first on rows where the PDF role is explicit but does not cross role family.
4. Keep 은퇴/명예/원로 roles unchanged unless PDF evidence is direct and user-verified.
