# Notification System

## Features

- New message notifications
- Notification dropdown in the top bar
- Unread notification badge
- Mark a notification as read
- Mark all notifications as read
- Notification events are persisted in local trial state

## API Routes

- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `POST /api/notifications/read-all`

## Trigger Rules

- When a user sends a message, other room participants receive a notification.
- Group rooms notify all signed-in trial users except the sender.
- Private rooms notify only the other member.

## Production Direction

Production should split notifications into:

- in-app notifications in PostgreSQL
- realtime delivery through Socket.IO or WebSocket
- push notifications through FCM/APNs
- email notifications for important account events

Notification writes should be queued for high traffic so chat delivery is never blocked by push providers.
