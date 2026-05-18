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

1. Commit or otherwise archive the current worktree changes.
2. Add a permanent operational smoke-check script so future deploys can re-run login/admin/member CRUD checks.
3. Start the next product area: person-photo matching for remaining future photos, including support for people who have no photo.
4. Add a lightweight DB health dashboard or admin-only status page showing:
   - review flags count
   - duplicate counts
   - temp test leftovers
   - recent deployment/env status
5. Clean up old temporary/import scripts after confirming which ones are still needed.

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
