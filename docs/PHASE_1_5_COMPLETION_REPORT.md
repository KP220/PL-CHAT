# Archived: Phase 1.5 Completion Report

This report is retained as implementation history and is not production user-facing copy.

## Features Completed

- Team-style group chat foundation
- Private direct chat foundation
- Message edit and soft delete
- Edited/deleted visual states
- Enter to send, Shift+Enter newline, Esc cancel edit
- Online/away/busy/offline presence
- Last seen and heartbeat storage
- Unread room counts
- Notification dropdown, unread badge, mark as read, mark all as read
- Activity/audit records in trial state
- File attachment open/download support

## Data Added

The local trial state now supports:

- `readReceipts`
- `notifications`
- `auditLog`
- `presence`
- message `editedAt`, `deletedAt`, `deletedById`, and `editHistory`

## API Routes Added

- `PATCH /api/messages/:messageId`
- `DELETE /api/messages/:messageId`
- `POST /api/rooms/:roomId/read`
- `GET /api/rooms/:roomId/unread-count`
- `GET /api/presence`
- `POST /api/presence/heartbeat`
- `PATCH /api/presence/status`
- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `POST /api/notifications/read-all`

## UI Added

- Message action buttons: copy, edit, delete
- Edit mode with cancel button
- Presence dots in the member list
- Notification button and dropdown
- Room unread badges
- Status selector

## Security Notes

- The trial server enforces basic authentication on all collaboration APIs.
- Direct rooms are restricted by member IDs.
- Deleted messages are soft-deleted.
- Attachments are served from the uploads directory with path traversal protection.
- This trial is not a production security boundary and should not be exposed broadly without a hardened production backend.

## Known Issues

- Data is stored in a local JSON file, not PostgreSQL.
- Admin/owner permissions are simplified to room owner checks.
- Presence uses heartbeat plus polling fallback, not Redis TTL.
- Notifications are in-app only.
- Browser `confirm()` is used for delete confirmation in the trial UI.

## Readiness For Phase 2

Phase 1.5 is ready for small-group trial testing. Before Phase 2, move the feature set into the production Prisma/PostgreSQL backend, add organization scoping, add automated tests, and run multi-user browser verification.
