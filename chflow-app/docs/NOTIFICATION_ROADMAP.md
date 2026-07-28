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
- keep existing `notifications` rows as the data source for push/toast routing
- filter message-like notifications by `type = message` or `type` prefix `message_`
- filter notices by `type = notice` or `type` prefix `notice_`
- keep PC behavior focused on a right-bottom panel
- avoid blocking mobile push work on full messenger implementation

Recommended first implementation:

- add local tab state to `NotificationBell`
- when `placement === "dock"`, render a larger panel with tabs
- keep inline placement backward compatible
- full messenger DB is now implemented separately from notification rows

Current implementation:

- `NotificationBell` now has dock placement and panel tabs
- `알림` tab shows all notification rows
- `메시지` tab filters `message` and `message_*` notification types
- `공지` tab filters `notice` and `notice_*` notification types
- notification list items show type chips
- Full messenger tables/RPCs were added on 2026-06-15:
  - `messenger_conversations`
  - `messenger_participants`
  - `messenger_messages`
  - `/messenger` UI for direct and group text conversations
  - `message_new` notifications route to `/messenger?c=<conversation_id>`

Commercial messenger upgrade added on 2026-06-15:

- Private `messenger-attachments` Storage bucket
- Participant-checked storage proxy for messenger attachments
- Image/file attachments with preview/download
- Message replies
- Sender edit/delete
- Read receipt counts and reader names
- `send_messenger_message_v2`, `get_messenger_messages_v2`, `edit_messenger_message`, `delete_messenger_message`

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
- Added migration `20260701120000_push_delivery_receipts.sql`
- Applied the migration to the linked remote Supabase DB with:

```powershell
cd C:\csh\project\chflow\MS_AX\chflow-project
npx supabase db query --linked --file supabase\migrations\20260609110000_notification_push_deliveries.sql
```

- Added `notification_push_deliveries` queue/log table
- Added trigger `trg_enqueue_notification_push_deliveries` on `public.notifications`
- Any new notification row now creates queued push delivery rows for the user's active push tokens
- Added `GET/POST /api/mobile/push-dispatch`
- Added `GET/POST /api/mobile/push-receipts`
- Added `GET/POST /api/cron/push-maintenance` to run dispatch and receipt polling from one scheduler call
- Dispatch endpoint:
  - picks queued/failed deliveries with fewer than 3 attempts
  - sends them to Expo Push API
  - records `sent`, `failed`, `expo_ticket_id`, attempts, and error messages
  - requires `Authorization: Bearer <PUSH_DISPATCH_SECRET|CRON_SECRET|SUPABASE_SERVICE_ROLE_KEY>`
- Receipt endpoint:
  - checks Expo receipts for `sent` deliveries with ticket IDs
  - records successful receipts as `delivered`
  - records receipt errors as `failed`
  - disables push tokens when Expo returns `DeviceNotRegistered`

Important:

- Vercel cron frequency depends on the Vercel plan. The endpoint is implemented, but minute-level automatic dispatch should be wired only after confirming the deployment plan or using an external scheduler.
- Manual dispatch for verification can call `/api/mobile/push-dispatch` with the service role key or dispatch secret.
- Production cron can call `/api/cron/push-maintenance` with the same bearer secret. Use `dispatch_limit` and `receipt_limit` query params only if the defaults need tuning.
- Before deploying receipt polling, apply `20260701120000_push_delivery_receipts.sql` so `notification_push_deliveries.status = 'delivered'` is accepted.

Verification:

```powershell
cd C:\csh\project\chflow\chflow-app
npm run build

cd C:\csh\project\chflow\chflow-expo
npx tsc --noEmit
```

### 5. Mobile Badge, Tap Routing, Real Device Verification

Implemented in code on 2026-06-11.

Goal:

- badge count follows unread count
- tapping an OS notification opens the app and moves WebView to `link_url`
- verify on a real Android device with an EAS APK

Current implementation:

- `chflow-expo/App.tsx` handles `getLastNotificationResponseAsync()` for cold-start notification taps
- `chflow-expo/App.tsx` handles `addNotificationResponseReceivedListener()` for active/background taps
- notification payload `data.linkUrl` is normalized and only the production app origin is allowed
- `/api/mobile/push-dispatch` includes unread badge count in Expo payload
- Expo receives badge values and applies them with `Notifications.setBadgeCountAsync()`

### 6. Supabase-triggered Immediate Push Dispatch

Implemented in code on 2026-06-11.

Goal:

- make push dispatch start immediately when Supabase creates queued delivery rows
- keep notification rows and delivery rows as the source of truth
- avoid hardcoding secrets in SQL migrations

Current implementation:

- Added migration `20260611300000_push_dispatch_webhook.sql`
- Trigger: `trg_dispatch_notification_push_deliveries`
- Trigger source table: `public.notification_push_deliveries`
- The trigger calls `/api/mobile/push-dispatch` through `pg_net`
- Dispatch URL and bearer secret are read from Supabase Vault:
  - `chflow_push_dispatch_url`
  - `chflow_push_dispatch_secret`

Operational requirement:

- Set `PUSH_DISPATCH_SECRET` in Vercel
- Store the same value in Supabase Vault as `chflow_push_dispatch_secret`
- Store `https://chflow-app.vercel.app/api/mobile/push-dispatch` as `chflow_push_dispatch_url`

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

## 예배 생방송 시작 알림 (2026-07-29)

유튜브 라이브가 시작되면 가입된 전 성도에게 "예배 생방송이 시작되었습니다" 알림을 보낸다.

### 왜 외부 스케줄러인가
Vercel Hobby 플랜은 Cron 이 **하루 1회**로 제한된다(`*/5 * * * *` 는 배포 자체가 거부됨:
`deploy_failed — Hobby accounts are limited to daily cron jobs`). 방송 시작을 분 단위로
감지해야 하므로 Cloudflare Workers Cron(1분, 무료)이 chflow 를 호출하는 구조를 쓴다.

```
Cloudflare Worker (매 1분)
  → GET https://smartms.kr/api/live/poll   Authorization: Bearer LIVE_POLL_SECRET
      → YouTube 조회(uploads playlist 1유닛 + videos.list 1유닛 = 2유닛/회)
      → 새 라이브면 status=active 전원에게 notifications 삽입
      → 기존 트리거 → notification_push_deliveries → 웹훅 → Expo 푸시
```

### 필요한 설정
| 위치 | 이름 | 비고 |
|---|---|---|
| Vercel (Production) | `YOUTUBE_API_KEY` | YouTube Data API v3 키. 없으면 폴러가 skip |
| Vercel (Production) | `LIVE_POLL_SECRET` | 폴러 인증. 미설정 시 `/api/live/poll` 은 503 |
| Cloudflare Worker | `LIVE_POLL_SECRET` | Vercel 값과 동일해야 함 |
| Cloudflare Worker | Cron Trigger | `* * * * *` |

워커 스크립트: `chflow-app/public/cloudflare-worker-live-poll.js` (배포 절차 주석 포함)

### 중복·오발송 방지
- `youtube_live_status.notified_video_id` 조건부 갱신으로 **한 방송당 1회만** 발송
- 방송 시작 후 30분 초과 시 알림 생략 (폴러 중단 후 재개될 때 늦은 알림 방지)
- 알림 저장 실패 시 선점 기록을 되돌려 다음 폴링에서 재시도
- `?dry=1` — 실제 발송 없이 대상자 수만 확인 (예배 전 사전 점검)

### 제약
- 아이폰은 네이티브 앱이 나오기 전까지 잠금화면 푸시를 받지 못한다(앱 내 종 아이콘만).
  iOS 앱에서 `expo-notifications` 토큰이 `user_push_tokens` 에 등록되면 자동으로 함께 받는다.
- 환경변수를 추가·변경한 뒤에는 **재배포해야** 런타임에 반영된다.
