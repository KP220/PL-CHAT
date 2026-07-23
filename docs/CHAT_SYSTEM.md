# Chat System

## Features

- Organization-style general room in the trial server
- User-created group rooms
- Private direct rooms
- Text messages
- File and image attachments
- Message edit with `editedAt`
- Soft delete with `deletedAt` and `deletedById`
- Deleted messages remain visible as a placeholder
- Read state per room
- Unread count per room

## API Routes In Trial Server

- `GET /api/rooms`
- `POST /api/rooms`
- `POST /api/direct`
- `GET /api/rooms/:roomId/messages`
- `POST /api/rooms/:roomId/messages`
- `PATCH /api/messages/:messageId`
- `DELETE /api/messages/:messageId`
- `POST /api/rooms/:roomId/read`
- `GET /api/rooms/:roomId/unread-count`
- `POST /api/uploads`

## Permission Rules

- A user can edit and delete their own messages.
- The owner of a room can manage messages in that room in the server foundation.
- Deleted messages cannot be edited again.
- Private rooms are visible only to their member IDs.
- Group rooms are visible to all signed-in trial users.

## Keyboard UX

- Enter sends a message.
- Shift+Enter inserts a newline.
- Esc cancels edit mode.
- Confirm dialogs can be accepted with Enter by the browser default behavior.

## Production Schema Target

Production should use Prisma models equivalent to:

- `ChatRoom`
- `ChatMessage`
- `ChatMessageEditHistory`
- `ChatReadReceipt`
- `Attachment`
- `ActivityLog`

Each production table should include `organizationId` when running a multi-organization product.
