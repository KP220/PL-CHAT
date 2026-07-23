# Archived: Phase 1.5 Collaboration Foundation

This document is retained as an implementation history note. User-facing production wording is now tracked in the Phase 1.7 production conversion report.

Phase 1.5 adds the collaboration layer required before a wider launch: team chat, message editing, soft delete, read state, presence, notifications, and audit records.

## Scope Completed In Trial Server

- Group rooms and private direct rooms
- Message send, edit, copy, and soft delete
- Edited and deleted message display states
- Enter to send, Shift+Enter for newline, Esc to cancel edit/close dropdown
- Presence heartbeat with online, away, busy, and offline states
- Last seen data stored in local trial state
- Unread count per room
- Notification dropdown with read and read-all actions
- Activity log records for message, room, presence, notification, login, and profile actions
- File attachments with open and download actions

## Trial Implementation Files

- `trial-server/server.mjs`
- `trial-server/public/index.html`
- `trial-data/pl-chat-small-group.json`

## Production Direction

The trial implementation uses a local JSON file so a small group can test quickly. Production should move these concepts to PostgreSQL/Prisma models with organization scoping, row-level permission checks, and persistent background workers for notifications and cleanup.

## Phase 2 Gate

Do not start Phase 2 public scaling until Phase 1.5 has been tested with multiple users and the production API/database version is implemented.
