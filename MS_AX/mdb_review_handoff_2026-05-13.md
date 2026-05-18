# MDB Review Handoff - 2026-05-13

## Context

Goal: 1,500+ MDB staging rows should not be reviewed one by one. Build a safe pipeline where rules/AI handle high-confidence cases and humans review only ambiguous or risky rows.

Current safety policy:

- Do not run `supabase db push` in this project. Remote migration history is not aligned and `db push` tries to reapply old migrations.
- Apply only the intended SQL file manually with:

```powershell
cd C:\csh\project\chflow\MS_AX\chflow-project
npx supabase db query --linked --file supabase\migrations\<file>.sql
```

## Done

### 1. review-mdb pagination

Files:

- `C:\csh\project\chflow\chflow-app\app\admin\review-mdb\page.tsx`
- `C:\csh\project\chflow\MS_AX\chflow-project\supabase\migrations\20260513010000_mdb_review_pagination.sql`

What changed:

- Removed hard 150-row-only behavior.
- Added `p_offset` pagination to `admin_mdb_review_candidates`.
- Added `total_count`.
- Added `admin_mdb_review_status_counts`.
- UI now shows page range, total count, previous/next buttons, and status counts.

DB application status:

- Applied manually with `npx supabase db query --linked --file ...`.
- Verified function signatures exist remotely.

### 2. Auto classification pipeline

Files:

- `C:\csh\project\chflow\chflow-app\app\admin\review-mdb\page.tsx`
- `C:\csh\project\chflow\MS_AX\chflow-project\supabase\migrations\20260513020000_mdb_review_auto_pipeline.sql`

What changed:

- Added statuses:
  - `auto_matched`
  - `needs_review`
  - `hold`
- Added columns to `staging_member_matches`:
  - `auto_classification`
  - `confidence_score`
  - `auto_rule`
  - `auto_payload`
  - `auto_decided_at`
- Added RPC:
  - `admin_mdb_review_run_auto_classification(p_limit integer)`
- Added UI button:
  - `자동 추천 실행`
- Added filters/chips:
  - `자동매칭`
  - `검수필요`
- Auto classification writes recommendations and field decisions only.
- It does not update `public.members`.

DB application status:

- Applied manually with `npx supabase db query --linked --file supabase\migrations\20260513020000_mdb_review_auto_pipeline.sql`.
- Verified remote function signatures:
  - `admin_mdb_review_candidates(p_status text, p_query text, p_limit integer, p_offset integer)`
  - `admin_mdb_review_confirm_match(p_staging_id bigint, p_member_id uuid, p_match_status text, p_match_score integer, p_review_note text)`
  - `admin_mdb_review_run_auto_classification(p_limit integer)`
- Tested `admin_mdb_review_run_auto_classification(1)` inside a transaction and rolled back. It executed successfully.

### 3. Local server

Current dev URL:

```text
http://127.0.0.1:3000/admin/review-mdb
```

If it is not running next time:

```powershell
cd C:\csh\project\chflow\chflow-app
npm run dev -- -p 3000 -H 127.0.0.1
```

## Current Behavior

Clicking `자동 추천 실행`:

- Processes currently unreviewed MDB staging rows.
- Classifies rows into:
  - `auto_matched`: high-confidence match
  - `needs_review`: human should review
  - `hold`: ambiguous/collision risk
- Saves match recommendation and field decisions.
- Does not change live `members`.

Current matching philosophy:

- Avoid wrong automatic decisions.
- Same-name risk is handled conservatively by requiring strong identifiers.
- `auto_matched` requires a unique top candidate and strong evidence such as:
  - exact legacy ID, or
  - phone + name + birth date, or
  - phone + name + family number.

## Verified

- `npm run lint -- app/admin/review-mdb/page.tsx`
  - 0 errors
  - existing warnings remain
- Page request:
  - `GET /admin/review-mdb` returns 200.
- SQL applied directly to remote DB.

### 4. Auto-matched risk report

Files:

- `C:\csh\project\chflow\chflow-app\app\admin\review-mdb\page.tsx`
- `C:\csh\project\chflow\MS_AX\chflow-project\supabase\migrations\20260514010000_mdb_review_risk_report.sql`

What changed:

- Extended `admin_mdb_review_candidates` with risk report fields:
  - `candidate_count`
  - `same_name_candidate_count`
  - `same_phone_candidate_count`
  - `same_birth_candidate_count`
  - `same_family_candidate_count`
  - `top_candidate_count`
  - `second_best_score`
  - `score_gap`
  - `risk_flags`
- UI now shows a compact risk summary on `auto_matched` list cards.
- UI now shows a detailed risk report panel for selected `auto_matched` rows.
- This is read-only reporting and does not update `members`.

DB application status:

- Applied manually with `npx supabase db query --linked --file supabase\migrations\20260514010000_mdb_review_risk_report.sql`.
- Verified remote function result type includes the new risk fields.

### 5. Bulk confirm auto-matched rows

Files:

- `C:\csh\project\chflow\chflow-app\app\admin\review-mdb\page.tsx`
- `C:\csh\project\chflow\MS_AX\chflow-project\supabase\migrations\20260514020000_mdb_review_confirm_auto_matches.sql`

What changed:

- Added RPC:
  - `admin_mdb_review_confirm_auto_matches()`
- Added UI button:
  - `자동매칭 전체 확정`
- Converts only rows where:
  - `match_status = 'auto_matched'`
  - `auto_classification = 'auto_matched'`
  - `member_id IS NOT NULL`
- Returns affected count.
- Does not update `members`.

DB application status:

- Applied manually with `npx supabase db query --linked --file supabase\migrations\20260514020000_mdb_review_confirm_auto_matches.sql`.
- Verified remote function signature:
  - `admin_mdb_review_confirm_auto_matches() returns TABLE(affected_count bigint)`

### 6. Bulk apply confirmed auto-matched rows

Files:

- `C:\csh\project\chflow\chflow-app\app\admin\review-mdb\page.tsx`
- `C:\csh\project\chflow\MS_AX\chflow-project\supabase\migrations\20260514030000_mdb_review_bulk_apply_auto_matches.sql`

What changed:

- Added audit/log tables:
  - `mdb_review_bulk_apply_runs`
  - `mdb_review_bulk_apply_items`
- Added RPC:
  - `admin_mdb_review_bulk_apply_auto_matches(p_limit integer, p_min_confidence integer)`
- Added UI button:
  - `확정 자동매칭 실제 일괄 반영`
- Applies only rows where:
  - `match_status = 'matched'`
  - `auto_classification = 'auto_matched'`
  - `member_id IS NOT NULL`
  - `confidence_score` or `match_score` is at least the requested minimum, default `80`
  - referenced `members.id` exists
- Writes row-level `before_member` and `after_member` JSON snapshots.
- Returns:
  - run id
  - before matched count
  - target count
  - applied count
  - after applied count

DB application status:

- Applied manually with `npx supabase db query --linked --file supabase\migrations\20260514030000_mdb_review_bulk_apply_auto_matches.sql`.
- Verified remote function signature:
  - `admin_mdb_review_bulk_apply_auto_matches(integer, integer) returns TABLE(run_id uuid, before_matched_count bigint, target_count bigint, applied_count bigint, after_applied_count bigint)`
- Follow-up table existence query timed out in the Supabase CLI, but the migration application returned success.

Important behavior:

- This function does update `public.members` when executed.
- Applying the migration only defines the function and log tables; it does not execute the bulk apply.
- The button is intentionally separate from auto classification and bulk confirmation.

Execution status:

- Executed on 2026-05-14 with `p_limit = 5000`, `p_min_confidence = 80`.
- Run id: `aac253b0-d705-4fec-97ed-38d1a0990068`
- Result:
  - `before_matched_count = 0`
  - `target_count = 0`
  - `applied_count = 0`
  - `after_applied_count = 0`
- No `members` rows were changed because there were no `matched` rows with `auto_classification = 'auto_matched'`.
- Current review distribution after execution:
  - `applied` / `auto_classification = null`: 2
  - `matched` / `auto_classification = null`: 3
  - `needs_review` / `auto_classification = 'needs_review'`: 1563

### 7. Second-pass classification for needs_review

Files:

- `C:\csh\project\chflow\chflow-app\app\admin\review-mdb\page.tsx`
- `C:\csh\project\chflow\MS_AX\chflow-project\supabase\migrations\20260514040000_mdb_review_second_pass.sql`

Why:

- First-pass auto classification produced no `auto_matched` rows because existing `members` has very little strong identity data:
  - existing `members.birth_date`: 28 rows
  - existing `members.legacy_kyoin_id`: 2 rows
  - existing `members.legacy_family_num`: 2 rows
- MDB staging has legacy/family data for all 1,568 rows, but the current live members table mostly does not, so strict legacy-based matching cannot help yet.

What changed:

- Added RPC:
  - `admin_mdb_review_run_second_pass(p_limit integer)`
- Added UI button:
  - `needs_review 2차 분류`
- Behavior:
  - unique normalized name + exact birth date -> `auto_matched`
  - unique normalized name only -> stays `needs_review`, but gets `member_id`, score 55, and rule `second_pass_unique_name_only`
  - duplicate normalized names -> `hold`, rule `second_pass_multiple_same_name`
- This stage does not update `members`.

Execution status:

- Applied SQL manually with `npx supabase db query --linked --file supabase\migrations\20260514040000_mdb_review_second_pass.sql`.
- Executed on 2026-05-14.
- Result:
  - `auto_matched_unique_name_birth`: 9
  - `recommended_unique_name_only`: 792
  - `held_multiple_same_name`: 106
  - `field_decisions_inserted`: 54
- Then the 9 `auto_matched` rows were bulk-confirmed and bulk-applied.
- Bulk apply run id: `446c36ba-222b-4d84-80de-06f6df024244`
- Bulk apply result:
  - `before_matched_count = 9`
  - `target_count = 9`
  - `applied_count = 9`
  - `after_applied_count = 9`
  - row-level before/after log rows: 9

Current distribution after second pass and 9-row apply:

- `applied` / `auto_classification = 'auto_matched'` / `second_pass_unique_name_birth`: 9
- `applied` / `auto_classification = null`: 2
- `matched` / `auto_classification = null`: 3
- `hold` / `second_pass_multiple_same_name`: 106
- `needs_review` / `no_candidate`: 656
- `needs_review` / `second_pass_unique_name_only`: 792

### 8. Name-only quick-review bucket

Files:

- `C:\csh\project\chflow\chflow-app\app\admin\review-mdb\page.tsx`
- `C:\csh\project\chflow\MS_AX\chflow-project\supabase\migrations\20260514050000_mdb_review_name_only_candidate_bucket.sql`

Why:

- The 792 `second_pass_unique_name_only` rows were not all equally safe.
- Analysis showed 76 rows were collisions where multiple MDB rows pointed to the same live member/name.
- The remaining 716 rows were one-to-one name-only candidates.

What changed:

- Added match status:
  - `name_only_candidate`
- Added RPC:
  - `admin_mdb_review_separate_name_only_candidates(p_limit integer)`
- Added UI button:
  - `이름유일 후보 분리`
- Added status filter/chip:
  - `이름유일`
- Behavior:
  - one-to-one name-only candidates -> `name_only_candidate`
  - name-only collisions -> `hold`
- This stage does not update `members` and does not mark rows as fully matched.

Execution status:

- Applied SQL manually with `npx supabase db query --linked --file supabase\migrations\20260514050000_mdb_review_name_only_candidate_bucket.sql`.
- Executed on 2026-05-14.
- Result:
  - `name_only_candidate_one_to_one`: 716
  - `name_only_collision_held`: 76

Current distribution after name-only bucket:

- `applied` / `second_pass_unique_name_birth`: 9
- `applied` / `auto_classification = null`: 2
- `matched` / `auto_classification = null`: 3
- `name_only_candidate` / `second_pass_unique_name_only_one_to_one`: 716
- `hold` / `second_pass_multiple_same_name`: 106
- `hold` / `second_pass_name_only_collision`: 76
- `needs_review` / `no_candidate`: 656

### 9. Bulk-confirm name-only one-to-one candidates

Files:

- `C:\csh\project\chflow\MS_AX\chflow-project\supabase\migrations\20260514060000_mdb_review_confirm_name_only_candidates.sql`

Why:

- User reviewed the risk profile and approved treating one-to-one name-only candidates as matched.
- This is still review-status confirmation only and does not update `members`.

What changed:

- Added RPC:
  - `admin_mdb_review_confirm_name_only_candidates(p_limit integer)`
- Confirms only rows where:
  - `match_status = 'name_only_candidate'`
  - `auto_rule = 'second_pass_unique_name_only_one_to_one'`
  - `member_id IS NOT NULL`
  - `auto_payload.same_member_target_count = 1`
  - `auto_payload.same_staging_name_count = 1`

Execution status:

- Applied SQL manually with `npx supabase db query --linked --file supabase\migrations\20260514060000_mdb_review_confirm_name_only_candidates.sql`.
- Executed on 2026-05-14.
- RPC affected count: 713
- Final state check shows all 716 one-to-one name-only candidates are now `matched`.
- `members` was not updated by this step.

Current distribution after name-only bulk confirmation:

- `applied` / `second_pass_unique_name_birth`: 9
- `applied` / `auto_classification = null`: 2
- `matched` / `second_pass_unique_name_only_one_to_one`: 716
- `matched` / `auto_classification = null`: 3
- `hold` / `second_pass_multiple_same_name`: 106
- `hold` / `second_pass_name_only_collision`: 76
- `needs_review` / `no_candidate`: 656

## Next Recommended Work

### Step 1. Add risk report for auto-matched rows

Purpose: prove same-name and shared-phone risks are being filtered correctly.

Add fields or a report RPC showing:

- same-name candidate count
- same-phone candidate count
- same-birth candidate count
- same-family candidate count
- top candidate count
- second-best score
- score gap
- risk flags

UI should show these on auto-matched rows before bulk confirmation.

Status: done on 2026-05-14.

### Step 2. Add `자동매칭 전체 확정` button

Purpose: remove the need to click 1,500 rows one by one.

Behavior:

- Converts `auto_matched` to `matched`.
- Does not update `members`.
- Should return affected count.
- Should only touch rows where:
  - `match_status = 'auto_matched'`
  - `auto_classification = 'auto_matched'`
  - `member_id IS NOT NULL`

Status: done on 2026-05-14.

### Step 3. Add high-confidence bulk apply, but keep separate

Purpose: update live `members` only after confidence review.

Behavior:

- Applies only auto-confirmed/high-confidence matched rows.
- Must create backup/log first.
- Must return before/after count.
- Should be a separate button from auto classification and auto confirmation.

Do not combine classification, confirmation, and live apply into one irreversible button.

Status: implemented on 2026-05-14. Actual bulk apply execution still requires pressing the separate UI button.

## Important Notes

- Do not use `supabase db push`.
- Apply SQL files manually with `npx supabase db query --linked --file ...`.
- `members` has not been modified by the new auto pipeline.
- Next safest task: run a small controlled execution after reviewing `matched` auto-confirmed rows, then inspect `mdb_review_bulk_apply_runs` and `mdb_review_bulk_apply_items`.

## 2026-05-15 Update: Review Page Clarification and Deployment

### What was fixed

Files:

- `C:\csh\project\chflow\chflow-app\app\admin\review-mdb\page.tsx`
- `C:\csh\project\chflow\MS_AX\chflow-project\supabase\migrations\20260514080000_mdb_review_context_and_candidate_fix.sql`

User-facing issue:

- On `needs_review / no_candidate` rows, the page still showed the existing-member apply flow, so pressing DB/apply buttons felt broken.
- Family context was too broad: for a selected MDB row, it mixed same MDB family number rows with live household members from any already-linked family row. This made rows like `김정현` look like they had too many family members and did not clearly answer "whose family is this?"

Changes made:

- If a row has no existing-member candidate, the page now explains that existing-member apply is not possible.
- For no-candidate rows, the intended actions are now clear:
  - `신규회원 생성 실행`
  - `보류`
- Field-by-field overwrite UI is hidden for no-candidate rows because there is no existing member to overwrite.
- The existing-member apply and decision-save buttons visually show disabled state when no candidate is selected.
- Candidate lookup is skipped entirely when the row already reports `candidate_count = 0`, which prevents the page from hanging on rows like `김정현`.
- Family panel text now says it is based on the selected MDB row's `legacy_family_num`.
- Existing DB household rows are shown only when the selected row has an existing matched member.

DB-side migration intent:

- `admin_mdb_review_candidate_options(bigint, integer)` was rewritten to use indexed UNION branches instead of one broad OR query.
- `admin_mdb_review_family_context(bigint)` was tightened so live household rows come only from the selected row's matched member household, not from every matched member inside the same MDB family number.

DB application status:

- The migration command was run:
  - `npx supabase db query --linked --file supabase\migrations\20260514080000_mdb_review_context_and_candidate_fix.sql`
- The first response returned empty rows, but Supabase CLI/pooler then hit authentication circuit-breaker errors during follow-up verification.
- Because of the pooler auth block, the DB function result was not conclusively re-verified after the migration.
- Frontend was additionally guarded so the most visible no-candidate problem is fixed even if candidate RPC behavior remains slow.

Build/deploy status:

- Local production build passed:
  - `npm run build`
- Full lint still fails due pre-existing unrelated errors across other pages/components.
- Production deployment completed:
  - deployment id: `dpl_67DPrxgjL2LoPBHejomTWczQbQGm`
  - deployment URL: `https://chflow-1sinxityv-rangminfathers-projects.vercel.app`
  - public alias: `https://chflow-app.vercel.app`
- Verified public route:
  - `https://chflow-app.vercel.app/admin/review-mdb`
  - HTTP `200 OK`

### Current review meaning

The review page is now intended to be used like this:

1. `matched`
   - A staging MDB row is considered the same person as an existing member.
   - This is still a review decision unless it has been applied.

2. `applied`
   - The existing `members` row has actually been updated.

3. `needs_review / no_candidate`
   - No existing member candidate was found.
   - The correct human action is either create a new member or hold it.
   - Existing-member DB apply is not available because there is no target member.

4. `hold`
   - Ambiguous or risky. Keep for later manual investigation.

### Next Work, Step by Step

#### Step 1. Re-check Supabase function deployment

Goal:

- Confirm whether `20260514080000_mdb_review_context_and_candidate_fix.sql` is fully active in remote Supabase.

Run after the Supabase pooler auth/circuit-breaker cools down:

```powershell
cd C:\csh\project\chflow\MS_AX\chflow-project
npx supabase db query --linked "select set_config('request.jwt.claim.sub','8d6696a2-8aa6-4531-a578-d3a4314ec3f5',true); select row_kind, staging_id, staging_name, staging_relationship, member_name from public.admin_mdb_review_family_context(2);"
npx supabase db query --linked "select set_config('request.jwt.claim.sub','8d6696a2-8aa6-4531-a578-d3a4314ec3f5',true); select member_id, member_name, member_phone, member_birth_date, score from public.admin_mdb_review_candidate_options(2,5);"
```

Expected:

- Family context for staging id `2` should show MDB family rows for family number `2`.
- Existing DB household rows should not appear unless selected row `2` itself is matched to a member with `household_id`.
- Candidate options query should return quickly.

Status on 2026-05-15:

- Completed.
- `admin_mdb_review_family_context(2)` returned only MDB family rows for family number `2`:
  - 김동수 / 세대주
  - 김정현 / 자녀
  - 김태현 / 자녀
  - 이춘자 / 처
  - 정우진 / 사위
  - 정찬영 / 손자
- It no longer appends unrelated live household members for 김정현.
- `admin_mdb_review_candidate_options(2,5)` returned quickly.
- Confirmed candidate count for staging id `2` is `0`.
- This confirms the DB-side function change is active.

#### Step 2. Browser-check the production page

Goal:

- Confirm the actual admin UI flow, not just build/deploy.

Check:

- Open `https://chflow-app.vercel.app/admin/review-mdb`.
- Filter/search `김정현`.
- Verify:
  - Existing-member apply is clearly disabled/explained if there is no candidate.
  - Family panel says it is based on selected MDB family number.
  - The page does not hang while loading candidate options.
  - The visible action is `신규회원 생성 실행` or `보류`.

Status on 2026-05-15:

- Partially completed without admin credentials.
- Public production route check:
  - `https://chflow-app.vercel.app/admin/review-mdb`
  - HTTP `200 OK`
- Deployed JS bundle check confirmed the new UI strings are present:
  - `기존회원 후보 없음`
  - `선택한 MDB 행의 가족번호 확인`
- Deployed bundle check confirmed old confusing strings are no longer present:
  - `기존회원 후보가 아직 없습니다`
  - `MDB 가족번호 기준 가족 확인`
- Chrome headless screenshot was captured at:
  - `C:\csh\project\chflow\MS_AX\review-mdb-prod-check.png`
- Browser opened production successfully, then redirected to the login page because the automation session has no admin login cookie.
- Full inside-page click verification still requires either:
  - a real admin login session, or
  - explicit permission to create and delete a temporary admin test account in production.

#### Step 3. Decide policy for `needs_review / no_candidate`

Goal:

- Determine whether to bulk-create obvious new members or leave all no-candidate rows for human review.

Recommended policy:

- Do not bulk-create all `656` rows immediately.
- First inspect grouped cases:
  - rows with family number and household context
  - rows with phone only
  - rows without birth date
  - rows with suspicious names or missing core data

Possible next automation:

- Add a `신규회원 후보` bucket for no-candidate rows that have enough MDB data.
- Keep weak rows in `hold`.

Status on 2026-05-15:

- Implemented and executed.

Files:

- `C:\csh\project\chflow\MS_AX\chflow-project\supabase\migrations\20260515010000_mdb_review_no_candidate_new_member_bucket.sql`
- `C:\csh\project\chflow\chflow-app\app\admin\review-mdb\page.tsx`
- `C:\csh\project\chflow\.vercelignore`

What changed:

- Added review status:
  - `new_member_candidate`
- Added RPCs:
  - `admin_mdb_review_preview_no_candidate_new_members(p_limit integer)`
  - `admin_mdb_review_classify_no_candidate_new_members(p_limit integer)`
- Classification is review-state only. It does not insert or update `members`.
- Preview before execution:
  - eligible no-candidate rows: 656
  - `new_member_candidate`: 641
  - `hold_possible_existing_candidate`: 2
  - `hold_weak_no_candidate_data`: 13
- Executed classification:
  - `new_member_candidate`: 641
  - `hold_possible_existing_candidate`: 2
  - `hold_weak_no_candidate_data`: 13
- Verified `김정현`:
  - `match_status = new_member_candidate`
  - `auto_rule = no_candidate_new_member_candidate`
  - `match_score = 65`
- Status distribution after execution:
  - `applied`: 11
  - `matched`: 719
  - `new_member_candidate`: 641
  - `hold`: 197
  - `needs_review`: 0

UI/deploy:

- Added `신규후보` status label/filter/summary chip.
- Added toolbar action `후보없음 신규후보 분류`.
- Local `npm run build` passed.
- Production deployment completed:
  - deployment id: `dpl_7FJ4Ldd5cQkzTimBUgAMKUbwZaXg`
  - deployment URL: `https://chflow-o2dv8kgub-rangminfathers-projects.vercel.app`
  - public alias: `https://chflow-app.vercel.app`
- Verified `https://chflow-app.vercel.app/admin/review-mdb` HTTP `200 OK`.
- Verified deployed bundle contains:
  - `신규후보`
  - `후보없음 신규후보 분류`
  - `new_member_candidate`

Deployment note:

- Root `.vercelignore` was tightened so Vercel uploads only `chflow-app`.
- Upload size dropped from about 1.2GB to 17.9MB.

#### Step 4. Apply already matched name-only rows carefully

Goal:

- The 716 name-only one-to-one rows are `matched`, but they have not necessarily updated `members`.

Before bulk apply:

- Add or confirm an apply RPC that can safely apply the `second_pass_unique_name_only_one_to_one` group.
- It should log every updated row like the auto-match bulk apply did.
- It should preserve operational fields such as app status, photo, notes, organization, and ministry data.

Recommended rollout:

1. Apply 10 rows.
2. Inspect changed members.
3. Apply 100 rows.
4. Inspect logs.
5. Apply remaining rows.

Status on 2026-05-15:

- Completed for all 716 `second_pass_unique_name_only_one_to_one` rows.

Applied strategy:

- Non-destructive fill only.
- Existing nonblank `members` fields were preserved.
- Empty `members` fields were filled from MDB.
- `name` was not changed.
- The following fields were eligible to be filled only when existing value was blank:
  - `phone`
  - `birth_date`
  - `address`
  - `gender`
  - `legacy_kyoin_id`
  - `legacy_family_num`
  - `relationship_in_household`
- Every applied row was logged in:
  - `public.mdb_review_bulk_apply_runs`
  - `public.mdb_review_bulk_apply_items`

Execution runs:

1. 10-row test
   - run id: `6580a5b0-5b1b-40f0-ac97-9020aa5aa460`
   - applied: 10
   - verified: name changed 0, nonblank overwrite 0

2. 100-row batch
   - run id: `c45a64b0-dc53-4d34-9c37-d82840ffee2c`
   - applied: 100
   - verified: name changed 0

3. Remaining batches
   - run id: `1b22c295-dc41-47f8-b2f7-2344a415a087` / applied 100
   - run id: `dd8ac934-eaed-426b-919d-3ce2f12a0a61` / applied 100
   - run id: `e1a9f4c8-c77f-4fa6-bbca-3a1bd0b84a19` / applied 100
   - run id: `4f7fd86b-5798-4c0e-8b0a-a1fedcda0a02` / applied 100
   - run id: `2cf00498-c115-420c-91aa-400115658a6c` / applied 100
   - run id: `3957c947-4d9b-464a-9eb5-5077d239bd49` / applied 100
   - run id: `e37c996b-a469-45b2-b20b-5b8f0594dc93` / applied 6

Final verification:

- Total name-only rows applied: 716
- Remaining matched name-only rows: 0
- Log item count for the 9 apply runs: 716
- Name changed: 0
- Existing nonblank field overwritten: 0
- Field fill counts:
  - `birth_date`: 677
  - `address`: 710
  - `phone`: 174
  - `legacy_kyoin_id`: 716
  - `legacy_family_num`: 716
  - `relationship_in_household`: 716

Review distribution after completion:

- `applied`: 1368
- `matched`: 3
- `hold`: 197
- `needs_review`: 0
- `new_member_candidate`: 0
- `auto_matched`: 0

Note:

- One failed attempt to process 606 rows at once created an empty completed run:
  - `885e40ff-905f-4362-904b-e47bed059a00`
  - target/applied: 0
- The failure happened before updates because the REST request URL exceeded header limits.
  Processing resumed safely in <=100 row batches.

### 2026-05-15 Manual matched cleanup and hold review UI

Manual/legacy matched rows:

- There were 3 remaining `matched` rows with `auto_rule = null`.
- They were applied non-destructively:
  - existing nonblank fields were preserved
  - empty address/MDB legacy fields/family relationship were filled from MDB
- run id: `76267a77-e32e-4d57-9c56-fad9c937dd5e`
- target: 3
- applied: 3
- log items: 3

Review distribution after this cleanup:

- `applied`: 1371
- `matched`: 0
- `hold`: 197
- `needs_review`: 0
- `new_member_candidate`: 0
- `auto_matched`: 0

Hold breakdown:

- `second_pass_multiple_same_name`: 106
  - same normalized name maps to multiple existing members
  - birth/phone could not uniquely resolve these
- `second_pass_name_only_collision`: 76
  - multiple MDB rows point to the same existing member by name
  - birth/phone could not uniquely select the correct MDB row
- `no_candidate_possible_existing_candidate`: 2
  - originally no-candidate, but possible existing-member signal was found
- `no_candidate_weak_new_member_data`: 13
  - not enough MDB data to safely create automatically

UI changes:

- `C:\csh\project\chflow\chflow-app\app\admin\review-mdb\page.tsx`
- Hold rows now show Korean hold reasons instead of raw `auto_rule`.
- Detail pane shows why human review is required.
- Detail pane explains the recommended action:
  - choose existing candidate and confirm/apply
  - create new member
  - keep hold if uncertain

Deployment:

- Local `npm run build` passed.
- Production deployment completed:
  - deployment id: `dpl_CKk6beme2w89CDQ47WmfT1UiTdYq`
  - deployment URL: `https://chflow-muotysxd3-rangminfathers-projects.vercel.app`
  - public alias: `https://chflow-app.vercel.app`
- Verified route:
  - `https://chflow-app.vercel.app/admin/review-mdb`
  - HTTP `200 OK`
- Verified deployed bundle contains:
  - `사람이 확인해야 하는 보류 건입니다`
  - `한 기존회원에 MDB 여러 명 충돌`
  - `동명이인 기존회원 후보`

### 2026-05-15 New-Member Candidate Creation

After Step 3 classified no-candidate rows into `new_member_candidate`, all 641 new-member candidates were created in controlled batches.

Important:

- This created new rows in `public.members`.
- This did not create or assign `household_id`.
- The created rows carry MDB identity fields:
  - `name`
  - `phone`
  - `birth_date`
  - `address`
  - `gender`
  - `legacy_kyoin_id`
  - `legacy_family_num`
  - `relationship_in_household`
- Created members have `review_status = 'unreviewed'`.
- The staging match rows were moved to `match_status = 'applied'`.
- Logs were written to:
  - `public.mdb_review_new_member_create_runs`
  - `public.mdb_review_new_member_create_items`

SQL file:

- `C:\csh\project\chflow\MS_AX\chflow-project\supabase\migrations\20260515020000_mdb_review_bulk_create_new_members.sql`

Execution runs:

1. First test batch
   - run id: `6641a297-d19a-4eb0-8540-bf6d62d372ac`
   - requested limit: 10
   - target: 10
   - created: 10
   - skipped: 0
   - status: completed

2. Second controlled batch
   - run id: `f7f430fc-1e4f-4e34-b0b9-7ef468bbcb8f`
   - requested limit: 100
   - target: 100
   - created: 100
   - skipped: 0
   - status: completed

3. Remaining batch
   - run id: `9407017f-85cd-43c0-9afe-eacba340396b`
   - requested limit: 1000
   - target: 531
   - created: 531
   - skipped: 0
   - status: completed

Final verification:

- Total new members created from this path: 641
- Total skipped: 0
- Remaining `new_member_candidate`: 0

Final review distribution after new-member creation:

- `applied`: 652
- `matched`: 719
- `hold`: 197
- `needs_review`: 0
- `new_member_candidate`: 0

Operational note:

- During verification, Supabase CLI DB connections hit pooler circuit-breaker auth throttling again.
- The data creation continued via Supabase REST/service-role calls instead of direct CLI DB connections.
- This was an access-throttling issue for the CLI path, not a data corruption issue.

#### Step 5. Triage `hold`

Current hold buckets:

- `second_pass_multiple_same_name`: 106
- `second_pass_name_only_collision`: 76

Goal:

- These require manual or smarter context-assisted review.

Recommended next UI:

- Show collision reason more explicitly.
- For duplicate-name collisions, group by candidate member and staging name.
- Let admin mark:
  - same person
  - new member
  - keep hold
  - ignore

#### Step 6. Clean deployment workflow

Current state:

- Vercel deploy worked from repo root after temporarily moving `chflow-app\.next` and `chflow-app\node_modules`.
- `.vercelignore` files were added to reduce upload noise, but repository still has many untracked files.

Recommended:

- Commit only the relevant app page, SQL migration, `.vercelignore`, and handoff document.
- Do not accidentally include large local artifacts under `MS_AX`.

#### Step 7. Fix project lint separately

Current state:

- `npm run build` passes.
- `npm run lint` fails due unrelated pre-existing errors in pages/components outside `review-mdb`.

Recommended:

- Treat lint cleanup as a separate task.
- Do not mix it with MDB merge logic changes.

## Final Operational State - 2026-05-16

MDB merge review is complete and the review page is no longer part of normal daily operation.

Final distribution:

- `applied`: 1,568
- `hold`: 0
- `matched`: 0
- other review statuses: 0

Finalization policy used:

- Remaining hold rows were not applied over existing members.
- Ambiguous hold rows were created as new members and marked `applied`.
- This intentionally favors later duplicate cleanup over accidental overwriting of existing member records.

Phone cleanup:

- Member `phone` should hold mobile numbers only.
- MDB/local landline-looking numbers are stored in `members.home_phone`.
- Final check after cleanup: home-phone-like values remaining in `members.phone` = 0.

UI state:

- `/admin/review-mdb` remains available by direct URL for audit/debug/history.
- The `MDB 병합검수` button was hidden from the admin members page.
- Do not delete MDB staging/review tables yet; keep them for tracing why members were created or matched.

Deployment note:

- Always deploy through the `chflow-app` Vercel project.
- Use `C:\csh\project\chflow\scripts\deploy-chflow-app.ps1`.

## Data Review Automation - 2026-05-16

The `/admin/review` page was updated to separate PDF-backed review from MDB-only review.

DB changes:

- Added MDB-aware review flags.
- MDB-only members are no longer flagged as missing PDF page/photo.
- Added `needs_household`, `duplicate_name_birth`, and `duplicate_legacy` flags.
- `admin_review_pasture_members` now uses member address first, falling back to household address.
- Added `admin_review_mdb_members(p_filter text)`.
- Added `admin_review_auto_classify(p_apply boolean)`.

UI changes:

- `/admin/review` now has `PDF 검수` and `MDB 검수` modes.
- MDB mode shows MDB-only members without forcing PDF comparison.
- Added flag filters for 목장배정필요, 이름+생일중복, 교인번호중복.
- Added `자동검수 실행` button with preview/confirm before applying.

Auto-classification applied:

- `needs_check`: 132
- `pdf_verified`: 1,108
- `mdb_verified`: 665

Note:

- MDB preview originally showed 687, but 22 of those overlapped with rows first marked `needs_check` by the higher-priority duplicate/relation/phone rules.

Resulting review distribution by source bucket:

- MDB-only: 665 verified, 38 needs_check, 151 unreviewed
- PDF-backed: 1,195 verified, 90 needs_check, 0 unreviewed
- Other: 17 needs_check, 1 unreviewed

Overall resulting review distribution:

- verified: 1,860
- needs_check: 145
- unreviewed: 152
- total: 2,157

Deployment:

- Production deployment id: `dpl_Ep84aj6qV8MA9gcL4YQKXyyYDTE2`
- Production alias: `https://chflow-app.vercel.app`

Next recommended steps:

1. Review the 145 `needs_check` rows first. These are real risk buckets: duplicates, bad phone, spouse mismatch, or orphan child.
2. Review the 152 remaining `unreviewed` rows next. Most are MDB-only rows without enough automatic evidence.
3. Start the photo/person matching workflow after data review is stable. Some people will intentionally have no photo, so the workflow needs an explicit `no_photo` state rather than forcing a match.

## Data Review Safe Auto-Cleanup - 2026-05-16

Additional conservative automation was applied after re-checking whether manual review was truly necessary.

Applied functions:

- `admin_review_safe_auto_cleanup(true)`
- `admin_review_safe_auto_cleanup_v2(true)`

Applied changes:

- MDB-only members linked to an existing household when their MDB family number mapped to exactly one existing household: 424 members
- PDF child-parent relation links added inside the same household: 119 relation rows
- PDF child rows automatically marked verified after safe parent-link cleanup: 59 members
- MDB child-parent relation links added from the same MDB family number: 34 relation rows
- MDB child rows automatically marked verified after safe parent-link cleanup: 17 members
- MDB low-risk unreviewed rows marked verified; `needs_household` remains as an operational assignment flag where applicable: 151 members

Final review distribution after safe cleanup:

- verified: 2,087
- needs_check: 69
- unreviewed: 1
- total: 2,157

Remaining review buckets:

- PDF needs_check: 31
  - spouse mismatch: 14
  - no photo + spouse mismatch: 2
  - no current auto flag but human/legacy notes remain: 15
- MDB needs_check: 21
  - duplicate name + birth + needs household: 16
  - bad phone: 1
  - orphan child / needs household residue: 4
- MDB unreviewed: 0
- Other unreviewed: 1 (`정순남`, no PDF/MDB source identifiers)

Interpretation:

- The user does not need to review hundreds of rows.
- The remaining human review set is about 69 rows, mostly spouse mismatch, true duplicate name+birth pairs, legacy notes, and a few relationship/phone leftovers.
- MDB members without household are not all manual review problems. Many are now verified records with `needs_household` remaining as a later 목장배정 task.

## Review Rule Refinements - 2026-05-17

Spouse rule:

- Previous rule required a spouse to be in the same household.
- Updated rule accepts spouse records when the relationship is reciprocal anywhere in `members`.
- Example: `송장호` and `이금선` are valid even though they are in different households/pastures because they point to each other as spouses.

Child photo rule:

- Missing profile photos should not be treated as a review problem for child/dependent rows.
- Updated `admin_review_member_flags` so `no_photo` is only emitted for PDF-backed non-child members.
- Verified after applying: child rows flagged as `no_photo` = 0.

송장호 note:

- The `자녀 송신예, 송예리?? / 사진깨짐` text was an existing `review_note`, not a new inference.
- MDB source confirms `송신예` under family `753` with `송장호/이금선`.
- MDB source has `송예리` under family `804` with a different household/address, which likely explains the historical `??`.
- Do not use child photo absence as a reason to keep a row in review.

Follow-up from 송장호 rule discussion:

- MDB is treated as the stronger source for registered-member family composition.
- Missing real-world children are not automatically a data error because the DB tracks registered members, not every biological child.
- `송지예` and `송미예` exist in MDB full export family `753` but were not present in staging/current members, so they were not created from this review pass.
- `송신예` was linked to `송장호` as father and `이금선` as mother.
- `송예리` was not linked to `송장호`; MDB family number `804` places her under a different household.
- `송장호` was left needs_check only for photo rematching: `photo_url = null`, `photo_status = match_failed`.
- Applying these rules cleared 13 additional PDF review holds whose current flags were empty and whose notes were resolved by the new spouse/family policy.
- Final review distribution after this cleanup: verified 2,100, needs_check 56, unreviewed 1.

## Review Relation Display Fix - 2026-05-17

Issue found from `임소라` / `임혜성`:

- PDF/OCR parsing treated a sibling relation as if it were parent/child.
- The review RPCs were also displaying every non-spouse relation as parent/child, so `sibling` rows appeared in `parent_names` / `child_names`.
- This made siblings look like children in `/admin/review`.

Fix applied:

- `admin_review_member_flags`, `admin_review_pasture_members`, `admin_review_mdb_members`, and `admin_review_pdf_members` now treat only `parent`, `grandparent`, and `great_grandparent` as parent/child evidence.
- `sibling` no longer appears in parent/child display.

MDB source for family `2860`:

- `전민자`: 세대주
- `임태섭`: 남편
- `임소라`: 장녀
- `임혜성`: 장남

Action:

- `임소라` and `임혜성` were marked verified after confirming MDB family relation and fixing the display rule.
- Final review distribution after this cleanup: verified 2,102, needs_check 54, unreviewed 1.

## Review UI Safety - 2026-05-17

- The visible \자동검수 실행\ button was removed from \/admin/review\.
- Reason: current review is now in manual/two-reviewer operation, and a global auto-status button can confuse active reviewers even though it does not overwrite source member data.
- The underlying RPC remains for controlled admin/script use if needed later.

## Deletion And Remaining Review Cleanup - 2026-05-17

Deletion policy agreed with user:

- A row can be deleted when MDB/current DB comparison supports a clear logic that it is an OCR/PDF-derived duplicate or invalid row.
- Ambiguous rows must be brought back to the user with the reason instead of being deleted blindly.

Actions performed:

- Deleted `성도` after backup. Reason: OCR/name error; MDB family `110922` has `문인식` and `김영자`, not a member named `성도`.
- Deleted the duplicate child-row `안동철` after backup. Reason: the real `안동철` exists separately with MDB `legacy_kyoin_id=14784`, family `2821`; the PDF child row was an extra duplicate under the parent household.
- Did not delete `신용훈`. MDB comparison showed the PDF 48 child row belongs to `김외숙` family `130197`; it was a merge case, not deletion.
- Merged PDF 48 `김외숙` household rows with MDB family `130197`: kept PDF rows for `김외숙`, `신용남`, `신용훈`, copied MDB legacy/family data onto them, and removed the extra MDB-only duplicate rows.
- Corrected spouse-name errors from MDB:
  - `김건식`: `박명애` -> `박정애`
  - `김효중`: `김희영` -> `이창희`
  - `하경순`: `이종구` -> `이중구`
  - Added reciprocal spouse links for `김정수/김지수`, `박이서/김수진`, `주완종/김영숙`.
- Cleared `홍혜숙` and `정도남`; MDB family `271737` confirms `정도남` as `사위`.
- Added MDB-backed parent links for `원서진`, `정해인`, `정해진`; kept `박라온` in review because only parent links were resolved and phone format remains invalid.

Backups written:

- `MS_AX/chflow-project/db-backups/2026-05-17_review_deletions/delete_candidates_*.json`
- `MS_AX/chflow-project/db-backups/2026-05-17_review_deletions/spouse_corrections_*.json`
- `MS_AX/chflow-project/db-backups/2026-05-17_review_deletions/family_271737_clear_*.json`
- `MS_AX/chflow-project/db-backups/2026-05-17_review_deletions/family_130197_merge_*.json`
- `MS_AX/chflow-project/db-backups/2026-05-17_review_deletions/child_parent_links_*.json`

Current review distribution after this cleanup:

- `verified`: 2,112
- `needs_check`: 39
- `unreviewed`: 1
- total members: 2,152

Remaining needs_check categories:

- Photo-related, leave out of data review for now: `김철주`, `박현상`, `송장호`, `이종훈` (also spouse mismatch).
- No PDF/MDB source and no household child rows: `김로아`, `김새윤`, `김서우`, `김하율`, `류아남`, `박재성`, `배민엽`, `안소민`, `안소이`, `이아윤`, `이태인`, `임필운`, `정하민`, `정현`, `채효은`, `최정현`, `황로아`.
- MDB duplicate-name/birth family-context rows needing policy decision: `김외숙`, `박미현` x2, `이보람` x2, `이분선` x2, `조현지` x2, `진영우` x2, `허이든` x2, `허이레` x2.
- Single issue rows: `박라온` invalid phone `010494514021`; `박수아` MDB family `240836` role `장녀` but birth/household context is odd; `주성철` spouse mismatch has no MDB confirmation.

Follow-up duplicate merge action:

- User approved immediate merge of MDB duplicate-name/birth rows.
- Merged 8 duplicate pairs after backup:
  - Kept `김외숙` family `130197`; removed duplicate family `1954`.
  - Kept `박미현` family `83376`; removed duplicate family `1246`.
  - Kept `이보람` family `165031`; removed duplicate family `163234`.
  - Kept `이분선` family `84623`; removed duplicate family `1246`.
  - Kept `조현지` family `113634`; removed duplicate family `37261`.
  - Kept `진영우` family `42066`; removed duplicate family `41342`.
  - Kept `허이든` family `83376`; removed duplicate family `1246`.
  - Kept `허이레` family `83376`; removed duplicate family `1246`.
- Backup written: `MS_AX/chflow-project/db-backups/2026-05-17_review_deletions/mdb_duplicate_merges_*.json`.
- Review distribution after this merge: `verified` 2,119, `needs_check` 24, `unreviewed` 1, total members 2,144.

Education-only child source refinement:

- User clarified that some children are real education-department students even when parents do not attend church and MDB/PDF has no matching household.
- Rechecked the 17 "no PDF/MDB source, no household child" rows against `edu_students`.
- All 17 were linked to active education student rows, so they are not deletion candidates.
- Marked those 17 rows verified with note: education student source confirmed; parent church registration/MDB absence is not a deletion reason.
- Backup written: `MS_AX/chflow-project/db-backups/2026-05-17_review_deletions/edu_child_verified_*.json`.
- Review distribution after this refinement: `verified` 2,136, `needs_check` 7, `unreviewed` 1, total members 2,144.

Follow-up single-case cleanup:

- `이종훈`: Treated as PDF/OCR duplicate of existing MDB family `96295` (`이종론`/`김순례` with children `이은정`, `이진호`). Deleted duplicate `이종훈` row and combined child row `이은정 이진호`; strengthened canonical family relations. Backup: `lee_jonghun_duplicate_cleanup_*.json`.
- `박라온`: Fixed invalid child phone by using parent `임선용` phone `010-4941-4021`; marked verified. Backup: `park_raon_phone_cleanup_*.json`.
- `박수아`: Confirmed education-student source, removed name-only MDB adult/family-number attachment, cleared MDB birth/family fields, kept as education child; marked verified. Backup: `park_sua_edu_cleanup_*.json`.
- Review distribution after these updates: `verified` 2,137, `needs_check` 4, `unreviewed` 1, total members 2,142.
- Remaining non-photo/manual item: `주성철` spouse mismatch. Current DB has `김은선` as spouse of `설수환` in MDB family `2021`, so do not link that `김은선` to `주성철`. Recommended handling: keep `spouse_name='김은선'` as free-text spouse from PDF, mark verified with note that existing registered `김은선` is a homonym/different person and no relation should be created.

