# Codex Handoff

Date: 2026-06-18
Repo cwd used: `C:\csh\project\chflow\MS_AX`
Main app: `C:\csh\project\chflow\chflow-app`

## Current State

Bible backend foundation has been added and applied to the linked Supabase project `chflow` (`klsrjvvdwtofialqknng`).

Latest relevant commits:

- `0c1b2fd feat(signup): add naver kakao identity oauth`
- `a981baf feat(signup): restrict identity providers`
- `8c25d9d feat(signup): add verified and pending signup paths`

## Bible Backend Work Completed

- Added Supabase migration:
  - `chflow-project/supabase/migrations/20260709100000_bible_core.sql`
- Added KRV seed migration:
  - `chflow-project/supabase/migrations/20260709101000_bible_krv_seed.sql`
- Added implementation notes:
  - `chflow-project/docs/bible_feature.md`
- Applied migrations to remote Supabase with:
  - `npx supabase db push`
- Remote DB verification passed:
  - `public.bible_verses` has `31,103` rows for `KRV`.
  - `public.get_bible_reference('요 3:16-17', 'KRV')` returns John 3:16-17.
  - `public.search_bible('사랑', 'KRV', null, 3, 0)` returns search results.

Created core tables:

- `bible_versions`
- `bible_books`
- `bible_book_aliases`
- `bible_verses`
- `user_bible_bookmarks`
- `user_bible_highlights`
- `user_bible_notes`
- `user_bible_reading_progress`

Created RPCs:

- `list_bible_versions()`
- `list_bible_books()`
- `get_bible_chapter(p_version, p_book_id, p_chapter)`
- `get_bible_passage(p_version, p_book_id, p_chapter_start, p_verse_start, p_chapter_end, p_verse_end)`
- `parse_bible_reference(p_ref)`
- `get_bible_reference(p_ref, p_version)`
- `search_bible(p_query, p_version, p_book_id, p_limit, p_offset)`
- `save_bible_reading_progress(p_version, p_book_id, p_chapter)`

Example frontend calls:

```ts
await supabase.rpc('get_bible_reference', {
  p_ref: '요 3:16-17',
  p_version: 'KRV',
})

await supabase.rpc('get_bible_chapter', {
  p_version: 'KRV',
  p_book_id: 43,
  p_chapter: 3,
})

await supabase.rpc('search_bible', {
  p_query: '사랑',
  p_version: 'KRV',
  p_limit: 50,
})
```

Practical feature foundation now available:

- Bulletin/sermon scripture reference click -> passage popup.
- Direct Bible reader by book/chapter.
- Bible text search.
- Future bookmark/highlight/note/reading-progress UI.

Recommended next Bible steps:

1. Add frontend helper for scripture refs such as `요 3:16-17`.
2. Render references in bulletin/sermon fields as clickable chips/links.
3. Open passage results in modal or bottom sheet.
4. Add a basic Bible reader screen using `list_bible_books` + `get_bible_chapter`.
5. Add bookmark/highlight/note UI after the reader is usable.

## Signup Identity Work Completed

- Signup first screen has two paths:
  - Verified signup using identity provider.
  - Manual info entry with admin approval pending.
- PASS is not exposed.
- Google was intentionally removed because Google OpenID basic profile does not reliably provide a verified phone number.
- Current supported signup identity providers are Naver and Kakao only.
- OAuth start route implemented:
  - `chflow-app/app/api/signup/identity/start/route.ts`
- OAuth callback route implemented:
  - `chflow-app/app/api/signup/identity/[provider]/callback/route.ts`
- Shared OAuth helper implemented:
  - `chflow-app/lib/server/signup-identity-oauth.ts`
- Signup page consumes callback result:
  - `identity_token`
  - `identity_name`
  - `identity_phone`
- Existing signup API already verifies the identity token and only auto-approves when provider name/phone matches the selected church DB member.
- Build verification passed with:
  - `npm run build`

## Required Production Setup

Register these Redirect URIs in provider consoles:

- Naver: `https://chflow-app.vercel.app/api/signup/identity/naver/callback`
- Kakao: `https://chflow-app.vercel.app/api/signup/identity/kakao/callback`

Set Vercel environment variables:

- `NEXT_PUBLIC_SITE_URL=https://chflow-app.vercel.app`
- `SIGNUP_IDENTITY_NAVER_CLIENT_ID`
- `SIGNUP_IDENTITY_NAVER_CLIENT_SECRET`
- `SIGNUP_IDENTITY_KAKAO_CLIENT_ID` or `KAKAO_REST_API_KEY`
- Optional, depending on Kakao app setting: `SIGNUP_IDENTITY_KAKAO_CLIENT_SECRET`

Provider consent requirements:

- Naver must provide name and mobile phone from profile API.
- Kakao must provide `name` and `phone_number` consent items.

## Recommended Next Steps

1. Add Naver/Kakao app settings and Vercel env vars.
2. Deploy web app.
3. Test `/signup` verified flow with real provider accounts.
4. Confirm these cases:
   - Existing church DB member with matching name/phone becomes auto-approved.
   - Provider identity without DB match falls into new-member signup flow.
   - Missing phone/name shows an error and does not auto-approve.
   - Manual info entry remains approval-pending.
5. If mobile app uses embedded web/signup, rebuild AAB only if native wrapper changes are needed; this signup OAuth change itself is web-side.
