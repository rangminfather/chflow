# Messenger Tasks - 2026-06-25

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
