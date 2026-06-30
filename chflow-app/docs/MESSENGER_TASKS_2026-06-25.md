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

Current implementation:

- Added `/api/admin/messenger-diagnostics` for admin/office/pastor diagnostics.
- Added `/admin/messenger-diagnostics` UI and linked it from the admin home menu.
- The diagnostics view searches by message ID, conversation ID, notification ID, or message text.
- It shows related messages, conversation participants, message notifications, push delivery rows, push tokens, and generated risk flags.
- Diagnostics now also supports user name/username/user ID lookup for real-account QA.
- Diagnostics UI shows matched user profiles so QA can verify the searched real account before reading delivery rows.
- Added flags for multiple active push tokens on one user/device and push delivery rows created while a conversation is muted.

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

## Phase 4 - UX Hardening

Priority: Medium

Current implementation:

- Added older-message paging inside a room with a stable `p_before` cursor.
- Added in-app image preview modal with ESC close and download action.
- Replaced remaining native `window.confirm` usage in messenger group management with the app confirm dialog.
- Composer supports paste/drop attachments and realtime typing state.
- Added message copy action and automatic link rendering for `http`/`https` URLs.

Tasks:

- Add "jump to first unread" inside a room.
- Improve image preview:
  - larger preview modal
  - next/previous image navigation
  - download action
- Improve file preview metadata.
- Add message pagination or infinite scroll for older rooms.
- Add empty/loading/error states for group management actions.
- Replace remaining browser `window.confirm` usage inside messenger with the app confirm dialog.
- Add mobile-specific QA for long names, long messages, many attachments, and small screens.

Exit criteria:

- Long conversations remain usable.
- Common mobile layouts do not overlap or truncate critical controls.

## Phase 5 - Commercial Messenger Gap Features

Priority: Medium to Low

Potential features:

- Mentions with `@name`.
- Pinned messages inside a room.
- Room notice.
- Room owner transfer.
- Per-room notification preferences.
- Message copy action.
- Unread members list shortcut.
- Attachment cleanup job visibility.
- Export conversation for admins, if policy allows.

These should wait until Phases 1 and 2 are complete.

## Deferred Direction - PC Desktop Messenger

Priority: Strategic, after messenger QA and core completion

Decision note:

- Do not finalize the PC messenger launch model while core messenger QA is still in progress.
- The long-term product direction is not just opening `/messenger` in the browser.
- Desired PC experience: a PC user clicks the messenger entry, installs a dedicated messenger app/shortcut, and then uses messenger in a separate app-like window from the desktop.
- Consider PWA install first for a lightweight desktop shortcut and standalone window.
- Consider Tauri/Electron later if the product needs a real Windows installer, tray behavior, auto-start, richer desktop notifications, or a stronger native-app feel.
- Existing bottom-right dock and `/messenger` page behavior should be treated as current interim entry points, not the final PC desktop UX.

Use this note when deciding future PC messenger architecture.

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
