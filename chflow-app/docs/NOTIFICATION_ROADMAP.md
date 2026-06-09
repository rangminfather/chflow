# Notification Roadmap

## Current State

The app already has a web-first notification base:

- `public.notifications` table with unread/read state
- RPCs for list, unread count, mark read, mark all read, and manual send
- Supabase Realtime enabled for `public.notifications`
- `NotificationBell` fetches notifications, subscribes to inserts, polls as backup, shows toast, updates unread count, and navigates to `link_url`
- notification rows are already created by several workflows:
  - signup approval/rejection
  - department join request/approval/rejection
  - department appointment/role/removal
  - promotion transfer
  - feedback post/comment/status events

## Completed

### 1. Global Notification Center Base

Implemented on 2026-06-09.

- Added `components/GlobalNotifications.tsx`
- Mounted it from `app/layout.tsx`
- Removed the home-only notification bell from `app/home/page.tsx`
- Added dock placement support to `components/NotificationBell.tsx`
- Added type chips for signup, department, feedback, notice, message, and general notification types
- Added `.global-notification-dock` CSS in `app/globals.css`

Verification:

```powershell
cd C:\csh\project\chflow\chflow-app
npm run build
```

## Next Process

### 2. PC Dock Panel

Implemented on 2026-06-09.

Goal:

- turn the bottom-right dock into the PC notification/messenger entry point
- use tabs for `알림`, `메시지`, `공지`
- keep existing `notifications` rows as the data source for now
- filter message-like notifications by `type = message` or `type` prefix `message_`
- filter notices by `type = notice` or `type` prefix `notice_`
- keep PC behavior focused on a right-bottom panel
- avoid blocking mobile push work on full messenger implementation

Recommended first implementation:

- add local tab state to `NotificationBell`
- when `placement === "dock"`, render a larger panel with tabs
- keep inline placement backward compatible
- do not create a full messenger DB yet

Current implementation:

- `NotificationBell` now has dock placement and panel tabs
- `알림` tab shows all notification rows
- `메시지` tab filters `message` and `message_*` notification types
- `공지` tab filters `notice` and `notice_*` notification types
- notification list items show type chips
- this is still notification-row based; full messenger tables are not created yet

Verification:

```powershell
cd C:\csh\project\chflow\chflow-app
npm run build
```

### 3. Expo Android Push Token Registration

Implemented on 2026-06-09.

Goal:

- add native Android push capability to `chflow-expo`
- install and configure `expo-notifications`
- request notification permission after login/session is available
- obtain Expo push token
- send the token to the web/backend

Needed DB/API:

- `user_push_tokens` table
- `POST /api/mobile/push-token`
- token fields: `user_id`, `expo_push_token`, `platform`, `device_id`, `enabled`, `last_seen_at`

Current implementation:

- Added migration `20260609100000_user_push_tokens.sql`
- Applied the migration to the linked remote Supabase DB with:

```powershell
cd C:\csh\project\chflow\MS_AX\chflow-project
npx supabase db query --linked --file supabase\migrations\20260609100000_user_push_tokens.sql
```

- Verified remote table exists with:

```sql
select to_regclass('public.user_push_tokens') as table_name;
```

- Added `POST /api/mobile/push-token`
- Added `expo-notifications` and `expo-constants` to `chflow-expo`
- Added Android `POST_NOTIFICATIONS` permission
- Expo app now:
  - requests notification permission
  - gets an Expo push token
  - receives Supabase access token from the WebView via `window.__chflowSupabase`
  - registers the token through `/api/mobile/push-token`

Verification:

```powershell
cd C:\csh\project\chflow\chflow-expo
npx tsc --noEmit

cd C:\csh\project\chflow\chflow-app
npm run build
```

### 4. Server Push Dispatch

Implemented on 2026-06-09.

Goal:

- whenever a notification row is created, send an Expo push to active tokens
- preserve web notification rows as the source of truth
- server push should be additive, not a replacement for `notifications`

Recommended path:

- add Next API or Supabase Edge Function for push dispatch
- add `notification_push_deliveries` table for success/failure audit
- initially dispatch from explicit server endpoints/RPC callers
- later consider DB trigger only after delivery/error handling is stable

Current implementation:

- Added migration `20260609110000_notification_push_deliveries.sql`
- Applied the migration to the linked remote Supabase DB with:

```powershell
cd C:\csh\project\chflow\MS_AX\chflow-project
npx supabase db query --linked --file supabase\migrations\20260609110000_notification_push_deliveries.sql
```

- Added `notification_push_deliveries` queue/log table
- Added trigger `trg_enqueue_notification_push_deliveries` on `public.notifications`
- Any new notification row now creates queued push delivery rows for the user's active push tokens
- Added `GET/POST /api/mobile/push-dispatch`
- Dispatch endpoint:
  - picks queued/failed deliveries with fewer than 3 attempts
  - sends them to Expo Push API
  - records `sent`, `failed`, `expo_ticket_id`, attempts, and error messages
  - requires `Authorization: Bearer <PUSH_DISPATCH_SECRET|CRON_SECRET|SUPABASE_SERVICE_ROLE_KEY>`

Important:

- Vercel cron frequency depends on the Vercel plan. The endpoint is implemented, but minute-level automatic dispatch should be wired only after confirming the deployment plan or using an external scheduler.
- Manual dispatch for verification can call `/api/mobile/push-dispatch` with the service role key or dispatch secret.

Verification:

```powershell
cd C:\csh\project\chflow\chflow-app
npm run build

cd C:\csh\project\chflow\chflow-expo
npx tsc --noEmit
```

### 5. Mobile Badge, Tap Routing, Real Device Verification

Goal:

- badge count follows unread count
- tapping an OS notification opens the app and moves WebView to `link_url`
- verify on a real Android device with an EAS APK

Verification requirements:

- app foreground notification behavior
- background notification display
- notification tap route handoff
- unread count and badge behavior
- Android status bar and lock-screen display
- EAS APK install after native changes

## Caution

- Vercel deploy verifies `chflow-app` only.
- Android push, badge, native permissions, launcher assets, and notification tap routing require `chflow-expo` EAS APK verification.
- Do not use archived TWA builds under `archive/mobile-legacy` as the current Android path.
- Existing unrelated dirty files may appear in `git status`; commit only notification-related files unless explicitly requested.
