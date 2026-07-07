# Messenger Operating Policy

Last updated: 2026-07-07

## Scope

This document is the standing policy for the first PC/web messenger release. Treat it as the source of truth unless a later dated policy replaces it.

## UI Finish Rules

- Long user names, room names, file names, and message previews must truncate with ellipsis in list/header/chip contexts.
- Message body text and links must wrap with `overflow-wrap: anywhere` or equivalent so controls are never pushed off screen.
- Attachment rows must show the file name and compact metadata when available: file type, image dimensions, and size.
- Image previews must open in an in-app overlay, support Escape/close, and expose a download action.
- Mobile layouts must preserve the composer, close buttons, and primary actions inside safe areas.

## Attachment Retention

- Messenger attachments are retained for 30 days from upload.
- The existing `/api/cron/storage-cleanup` job deletes `messenger_message_attachments` rows and matching `messenger-attachments` storage objects older than 30 days.
- Message text remains after attachment cleanup. Missing/deleted attachment files should be treated as expired content, not as message corruption.
- Do not increase retention without checking Supabase/R2 storage cost and privacy impact.

## Attachment Limits

- Bucket: `messenger-attachments`
- Visibility: private
- Access path: app storage proxy with conversation participant checks
- Max file size: 25 MB
- Allowed types: common images, PDF, text, Word, Excel, PowerPoint

## Report Handling

- All message reports start as `open`.
- Admin/office/pastor reviewers may move a report to `reviewing` when triage begins.
- Use `resolved` when action was taken or the report was accepted as valid.
- Use `dismissed` when the report is invalid, accidental, duplicate, or does not require action.
- Every `resolved` or `dismissed` report should include a short note explaining the decision.
- Severe abuse, privacy exposure, or safety issues should be escalated outside the app to church leadership before deleting evidence.
- Report records should remain for audit. Do not bulk-delete reports during normal cleanup.

## Release Status

The first PC/web messenger release is considered functionally complete after:

- production DB messenger objects are present,
- build passes,
- real account send/receive works,
- read state works,
- search works,
- in-app notification is created once per recipient/message,
- a real mobile push is received for an active push token.

This was verified on 2026-07-07 with `clyawy` and `sunsetrome`.
