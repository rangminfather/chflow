# Messenger Tasks - 2026-06-25

## Start Here For The Next Agent

If the user says "메신저 기능 작업 이어서 수행해야할것 알려줘" or asks to continue messenger work, do this first:

1. Read this file completely.
2. Check the current branch and dirty worktree:

```powershell
git status --short --branch
```

3. Do not revert or include unrelated user changes.
4. Confirm whether the remote Supabase database has the messenger migrations applied:

```powershell
cd C:\csh\project\chflow\MS_AX\chflow-project
npx supabase migration list
```

5. If messenger migrations are still pending, start with "Phase 1 - Database Rollout Gate".
6. If DB rollout is already done, start with "Phase 2 - Real Account QA".
7. If the user wants another implementation task instead of QA, the best next feature is "Phase 3 - Admin Diagnostics".

Recommended first response to the user:

> 현재 메신저는 MVP 이후 단계까지 구현되어 있고, 다음 우선순위는 원격 DB 마이그레이션 반영 상태 확인입니다. 먼저 `npx supabase migration list`로 미적용 마이그레이션 범위를 확인한 뒤, 적용 가능하면 알림 중복 방지/푸시 토큰 정리/그룹 관리 RPC부터 DB에 반영하겠습니다. DB가 이미 반영되어 있으면 3인 그룹방 실계정 QA와 관리자 진단 화면 구현으로 넘어가겠습니다.

Important context:

- The messenger code was committed in `a2d2fb1 feat(messenger): harden messaging rollout`.
- The attendance layout follow-up was committed in `b0275b8 fix(attendance): move class summary above checklist`.
- `main` on GitHub contains these commits if the other laptop has pulled after 2026-06-25.
- Do not run a blind `npx supabase db push` until the pending migration list is reviewed.
- The most useful next implementation after DB/QA is `/admin/messenger-diagnostics`.

## Current Position

The messenger is past a basic MVP. It now covers direct chats, group chats, attachments, replies, edits, deletes, forwarding, reactions, read status, search, conversation state, reporting, blocking, group management, mobile push registration, logout push cleanup, and attachment authorization hardening.

It is suitable for controlled internal QA, but it should not be considered equivalent to a mature commercial messenger until the database rollout and real-device reliability checks are complete.

## Recently Implemented

- Hardened `messenger-attachments` upload/read/delete authorization.
- Added duplicate `message_new` notification protection.
- Added push-token cleanup by stable device identity.
- Added native logout push-token unregister flow.
- Added group management RPCs and UI:
  - rename group
  - add participants
  - remove participants
- Changed read status to show on all messages, not only messages sent by the current user.
- Added read-status details:
  - read count against target participant count
  - read users
  - unread users
- Changed message search result clicks to open and highlight the matching message.

## Phase 1 - Database Rollout Gate

Priority: Critical

Goal: safely apply the messenger-related migrations without accidentally pushing unrelated pending migrations.

Tasks:

- Review remote/local migration drift with `npx supabase migration list`.
- Decide whether all pending migrations from `20260609110000` onward are intended for production.
- If not, split or repair migration history before pushing.
- Apply these messenger-critical migrations when the rollout set is approved:
  - `20260625130000_messenger_notification_dedupe.sql`
  - `20260625131000_push_token_device_dedupe.sql`
  - `20260625132000_messenger_group_management.sql`
- After rollout, verify that these RPCs exist remotely:
  - `rename_group_conversation`
  - `add_group_participants`
  - `remove_group_participant`
- Verify the unique duplicate-notification index exists:
  - `ux_notifications_message_new_user_message`

Exit criteria:

- Remote DB has the required RPCs and indexes.
- No unintended migration batch was pushed.
- Existing login, notification, and messenger flows still work.

## Phase 2 - Real Account QA

Priority: Critical

Goal: validate the flows that cannot be proven by build/type checks.

Status as of 2026-06-30:

- DB-level smoke passed against existing production messenger data.
- `diagnose_messenger_delivery(<message_id>, 10)` returned the expected conversation, participants, message notifications, active push tokens, and `sent` push delivery rows.
- The tested 3-person group message had:
  - 3 participants
  - 2 `message_new` notification rows for non-senders
  - 2 push delivery rows with `status = sent`
  - 0 diagnostic flags
- Remaining work is physical-device verification: confirm what users actually see on Android/web sessions.

Test setup:

- Use at least 3 real user accounts.
- Use at least 2 physical mobile devices for push checks.
- Include one web session and one Expo app session when possible.

Scenarios:

- Create a 3-person group room.
- Send one message from user A.
- Confirm users B and C each receive only one notification.
- Confirm user A does not receive a push for their own message.
- Open the conversation as user B.
- Confirm user A and user C can see read count changes correctly.
- Click read status on messages sent by A, B, and C.
- Confirm read and unread user lists are correct.
- Search for an older message.
- Click the search result.
- Confirm the room opens and the matched message is highlighted.
- Logout from the Expo app.
- Send a message to that user.
- Confirm the logged-out device does not receive a push.
- Login again and confirm push registration works again.

Exit criteria:

- No duplicate push or in-app notification for one message.
- Logged-out devices do not receive messenger push.
- Read status is correct in 3-person rooms.
- Search-to-message navigation works.

## Phase 3 - Admin Diagnostics

Priority: High

Goal: give operators a way to inspect messenger delivery issues without direct database access.

Recommended route:

- `/admin/messenger-diagnostics`

Status as of 2026-06-30:

- Implemented and pushed in `4b67b94 feat(messenger): add admin delivery diagnostics`.
- Remote DB function applied:
  - `diagnose_messenger_delivery(text, int)`
- `/admin/messenger-reports` has a `진단` button linking to the diagnostics page.

Recommended capabilities:

- Search by conversation ID, message ID, or user.
- Show message row and sender.
- Show conversation participants.
- Show generated `message_new` notification rows.
- Show notification metadata, created time, read time, and route.
- Show active push tokens for each recipient.
- Show recent push delivery rows or dispatch attempts if available.
- Flag likely problems:
  - duplicate notifications for one user/message
  - multiple active tokens for the same user/device
  - muted conversation but push attempted
  - missing participant row
  - missing notification row

Exit criteria:

- An admin can diagnose "why did I get two alerts?" and "why did I get no alert?" from the UI.

Implemented capabilities:

- Search by message ID, conversation ID, or user name/username/email/phone.
- Show resolved conversation and message.
- Show conversation participants.
- Show generated `message_new` notification rows.
- Show active and inactive push tokens for participants.
- Show push delivery rows and Expo ticket IDs.
- Flag likely problems:
  - duplicate notifications for one user/message
  - missing notification row for a non-sender participant
  - muted conversation with notification row
  - multiple active tokens for the same user/device
  - push delivery rows not marked `sent`

## Phase 4 - UX Hardening

Priority: Medium

Status as of 2026-06-30:

- Image attachment preview modal implemented in `7074bf6 feat(messenger): improve attachment preview UX`.
- Image preview supports next/previous within the same message and download.
- File attachment rows now show file type and size.
- Remaining browser `window.confirm` inside messenger was replaced with the app confirm dialog.

Tasks:

- Add "jump to first unread" inside a room.
- Add message pagination or infinite scroll for older rooms.
- Add stronger empty/loading/error states for group management actions.
- Add mobile-specific QA for long names, long messages, many attachments, and small screens.

Exit criteria:

- Long conversations remain usable.
- Common mobile layouts do not overlap or truncate critical controls.

## Phase 4A - Messenger Visual Refresh

Priority: High

Goal: raise the messenger from "internal tool" to a product-quality UI before adding many more features.

Recommended order:

1. Message surface polish
   - Done: replaced tiny inline action buttons with a cleaner contextual action pill/menu.
   - Done: added message copy action.
   - Tighten read-time/read-status typography.
   - Partial: improved chat surface spacing, date dividers, and message-list background.
2. Conversation list polish
   - Done: added all/unread/favorite conversation filters.
   - Clarify unread emphasis further.
   - Show attachment/file/photo labels in the last-message preview.
   - Partial: added pin/favorite/mute state badges in the active chat header.
   - Improve selected/hover states.
3. Composer polish
   - Improve reply/edit context preview.
   - Done: improved pending attachment chips with size metadata.
   - Done: made send/attach controls stable on small screens.
   - Done: added drag-and-drop attachment support and composer status row.
4. Modal/bottom-sheet consistency
   - Unify new conversation, forwarding, group management, read status, and image preview surface rules.
   - Prefer bottom-sheet behavior on narrow screens where appropriate.

Exit criteria:

- `/messenger` feels visually comparable to a modern mobile-first messenger for internal church use.
- Common actions are discoverable without crowding the message row.
- PC and mobile layouts have clear hierarchy and consistent spacing.

## Phase 4B - Long Conversation Performance

Priority: High

Goal: keep large active group rooms usable.

Tasks:

- Done: added message pagination with `p_before`.
- Done: added "load older messages".
- Done: preserved scroll position when older messages are inserted.
- Partial: added "new messages" / jump-to-latest notice when the user is reading older messages.
- Add "jump to first unread".
- Avoid full conversation reload for every realtime event where possible.

Exit criteria:

- Rooms with hundreds or thousands of messages remain usable.
- Opening a room does not require loading the entire history.

## Phase 4C - Push Reliability & Receipts

Priority: High

Goal: make "why did I get/no get a notification?" answerable and self-healing.

Tasks:

- Fetch Expo push receipts after ticket creation.
- Done: mark Expo `DeviceNotRegistered` tokens disabled during dispatch.
- Surface receipt failures in `/admin/messenger-diagnostics`.
- Add a controlled retry path for failed push deliveries.
- Confirm Supabase Vault dispatch URL/secret values in production.

Exit criteria:

- Failed native pushes have an actionable reason.
- Dead tokens stop generating repeated failed deliveries.

## Phase 5 - Commercial Messenger Gap Features

Priority: Medium to Low

Potential features:

- Message copy action.
- Mentions with `@name`.
- Pinned messages inside a room.
- Room notice.
- Room owner transfer.
- Per-room notification preferences.
- Unread members list shortcut.
- Attachment cleanup job visibility.
- Export conversation for admins, if policy allows.

These should wait until Phases 1 and 2 are complete.

## Validation Commands

Run before merging or deploying:

```powershell
cd C:\csh\project\chflow\chflow-app
npm run build

cd C:\csh\project\chflow\chflow-expo
npx tsc --noEmit

cd C:\csh\project\chflow\MS_AX\chflow-project
npx supabase migration list
```

## Current Caution

As of 2026-06-25, `npx supabase migration list` shows several local migrations that are not present remotely, starting before the new messenger migrations. Do not run a blind `npx supabase db push` unless the full pending migration set has been reviewed and approved.
