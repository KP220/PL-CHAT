import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootDir = resolve(apiDir, '..', '..');

function argValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((item) => item.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const apply = process.argv.includes('--apply');
const verify = process.argv.includes('--verify');
const organizationId = argValue('organization-id', process.env.PL_CHAT_ORGANIZATION_ID || 'default-org');
const organizationName = argValue('organization-name', process.env.PL_CHAT_ORGANIZATION_NAME || 'PL CHAT Internal Workspace');
const jsonPath = resolve(rootDir, argValue('json', process.env.PL_CHAT_DATA_FILE || join('pl-chat-data', 'pl-chat-workspace.json')));

function array(value) {
  return Array.isArray(value) ? value : [];
}

function date(value) {
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function nullableDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function roomType(type) {
  const value = String(type || '').toLowerCase();
  if (value === 'private' || value === 'direct') return 'DIRECT';
  if (value === 'channel') return 'CHANNEL';
  return 'GROUP';
}

function role(user) {
  return user?.isAdmin ? 'ADMIN' : 'USER';
}

function safeUsername(user, used) {
  const base = String(user.username || user.name || user.email || user.id || 'user')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 24) || `user-${String(user.id).slice(0, 6)}`;
  let candidate = base;
  let index = 1;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 24)}-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function fileExtension(upload) {
  return String(upload.extension || extname(upload.name || '') || '').toLowerCase();
}

function fileStorageKey(upload) {
  return upload.storageKey || basename(String(upload.url || '').replace(/^\/uploads\//, '')) || upload.id;
}

function roomMembers(room, users) {
  if (Array.isArray(room.memberIds)) return room.memberIds;
  return users.map((user) => user.id);
}

function counts(state) {
  return {
    users: array(state.users).length,
    sessions: array(state.sessions).length,
    rooms: array(state.rooms).length,
    messages: array(state.messages).length,
    uploads: array(state.uploads).length,
    fileShareLinks: array(state.fileShareLinks).length,
    posts: array(state.posts).length,
    postComments: array(state.postComments).length,
    postReactions: array(state.postReactions).length,
    notifications: array(state.notifications).length,
    activityLog: array(state.auditLog).length
  };
}

function uniqueCount(items, keyFn) {
  return new Set(items.map(keyFn).filter(Boolean)).size;
}

function expectedImportCounts(state) {
  const users = array(state.users);
  const rooms = array(state.rooms);
  const uploads = array(state.uploads);
  const messages = array(state.messages);
  const posts = array(state.posts);
  const userIds = new Set(users.map((user) => user.id));
  const roomIds = new Set(rooms.map((room) => room.id));
  const uploadIds = new Set(uploads.map((upload) => upload.id));
  const postIds = new Set(posts.map((post) => post.id));
  const firstUserId = users[0]?.id;

  return {
    users: users.length,
    sessions: array(state.sessions).filter((session) => userIds.has(session.userId)).length,
    chatRooms: rooms.length,
    conversations: rooms.length,
    messages: messages.filter((message) => roomIds.has(message.roomId) && (userIds.has(message.userId) || firstUserId)).length,
    files: uploads.filter((upload) => userIds.has(upload.userId)).length,
    fileShareLinks: uniqueCount(
      array(state.fileShareLinks).filter((share) => uploadIds.has(share.fileId) && userIds.has(share.createdById)),
      (share) => share.tokenHash
    ),
    profilePosts: posts.filter((post) => userIds.has(post.userId)).length,
    profilePostComments: array(state.postComments).filter((comment) => postIds.has(comment.postId) && userIds.has(comment.userId)).length,
    profilePostReactions: uniqueCount(
      array(state.postReactions).filter((reaction) => postIds.has(reaction.postId) && userIds.has(reaction.userId)),
      (reaction) => `${reaction.postId}:${reaction.userId}:${reaction.emoji || reaction.type || 'like'}`
    ),
    notifications: array(state.notifications).filter((item) => userIds.has(item.userId)).length,
    activityLogs: array(state.auditLog).length
  };
}

async function loadState() {
  if (!existsSync(jsonPath)) throw new Error(`Workspace JSON not found: ${jsonPath}`);
  return JSON.parse(await readFile(jsonPath, 'utf8'));
}

async function importState(state) {
  const prisma = new PrismaClient();
  const importedAt = new Date();
  const users = array(state.users);
  const rooms = array(state.rooms);
  const uploads = array(state.uploads);
  const messages = array(state.messages);
  const posts = array(state.posts);
  const usedUsernames = new Set();

  try {
    await prisma.organization.upsert({
      where: { id: organizationId },
      update: { name: organizationName },
      create: { id: organizationId, name: organizationName, slug: organizationId }
    });

    for (const user of users) {
      await prisma.user.upsert({
        where: { id: user.id },
        update: {
          organizationId,
          email: String(user.email || '').toLowerCase(),
          role: role(user),
          emailVerifiedAt: nullableDate(user.emailVerifiedAt),
          deletedAt: nullableDate(user.deletedAt)
        },
        create: {
          id: user.id,
          organizationId,
          email: String(user.email || '').toLowerCase(),
          passwordHash: user.passwordHash || 'imported-password-disabled',
          role: role(user),
          emailVerifiedAt: nullableDate(user.emailVerifiedAt),
          createdAt: date(user.createdAt),
          updatedAt: date(user.updatedAt || user.createdAt)
        }
      });

      await prisma.userProfile.upsert({
        where: { userId: user.id },
        update: {
          displayName: user.name || user.displayName || String(user.email || '').split('@')[0],
          avatarUrl: user.avatar || user.avatarUrl || null,
          bio: user.bio || null,
          statusText: user.status || user.statusText || null
        },
        create: {
          userId: user.id,
          displayName: user.name || user.displayName || String(user.email || '').split('@')[0],
          username: safeUsername(user, usedUsernames),
          avatarUrl: user.avatar || user.avatarUrl || null,
          bio: user.bio || null,
          statusText: user.status || user.statusText || null
        }
      });
    }

    for (const session of array(state.sessions)) {
      await prisma.session.upsert({
        where: { id: session.id || hashToken(session.token).slice(0, 24) },
        update: { lastSeenAt: importedAt },
        create: {
          id: session.id || hashToken(session.token).slice(0, 24),
          organizationId,
          userId: session.userId,
          refreshTokenHash: session.token ? hashToken(session.token) : null,
          lastSeenAt: date(session.createdAt),
          createdAt: date(session.createdAt)
        }
      }).catch(() => {});
    }

    for (const room of rooms) {
      await prisma.chatRoom.upsert({
        where: { id: room.id },
        update: { title: room.name || room.title || null, deletedAt: nullableDate(room.deletedAt) },
        create: {
          id: room.id,
          type: roomType(room.type),
          title: room.name || room.title || null,
          description: room.description || null,
          createdAt: date(room.createdAt),
          updatedAt: date(room.updatedAt || room.createdAt)
        }
      });

      await prisma.conversation.upsert({
        where: { legacyRoomId: room.id },
        update: {
          title: room.name || room.title || null,
          archivedAt: nullableDate(room.archivedAt),
          deletedAt: nullableDate(room.deletedAt)
        },
        create: {
          organizationId,
          type: roomType(room.type),
          title: room.name || room.title || null,
          description: room.description || null,
          ownerId: users.some((user) => user.id === room.ownerId) ? room.ownerId : null,
          legacyRoomId: room.id,
          createdAt: date(room.createdAt),
          updatedAt: date(room.updatedAt || room.createdAt)
        }
      });

      const conversation = await prisma.conversation.findUniqueOrThrow({ where: { legacyRoomId: room.id } });
      for (const memberId of roomMembers(room, users)) {
        if (!users.some((user) => user.id === memberId)) continue;
        await prisma.groupMember.upsert({
          where: { roomId_userId: { roomId: room.id, userId: memberId } },
          update: {},
          create: { roomId: room.id, userId: memberId, role: memberId === room.ownerId ? 'OWNER' : 'MEMBER' }
        });
        await prisma.conversationMember.upsert({
          where: { conversationId_userId: { conversationId: conversation.id, userId: memberId } },
          update: {},
          create: {
            organizationId,
            conversationId: conversation.id,
            userId: memberId,
            role: memberId === room.ownerId ? 'OWNER' : 'MEMBER'
          }
        });
      }
    }

    for (const upload of uploads) {
      if (!users.some((user) => user.id === upload.userId)) continue;
      const roomId = Array.isArray(upload.roomIds) ? upload.roomIds[0] : upload.roomId || null;
      const conversation = roomId ? await prisma.conversation.findUnique({ where: { legacyRoomId: roomId } }) : null;
      await prisma.file.upsert({
        where: { id: upload.id },
        update: {
          originalName: upload.name || upload.originalName || upload.id,
          mimeType: upload.mimeType || 'application/octet-stream',
          byteSize: BigInt(upload.size || upload.byteSize || 0),
          deletedAt: nullableDate(upload.deletedAt),
          deletedById: upload.deletedById || null
        },
        create: {
          id: upload.id,
          organizationId,
          uploaderId: upload.userId,
          conversationId: conversation?.id || null,
          postId: upload.postId || null,
          originalName: upload.name || upload.originalName || upload.id,
          safeName: upload.safeName || upload.name || upload.id,
          extension: fileExtension(upload),
          mimeType: upload.mimeType || 'application/octet-stream',
          byteSize: BigInt(upload.size || upload.byteSize || 0),
          storageDriver: 'LOCAL',
          storageKey: fileStorageKey(upload),
          scanStatus: upload.deletedAt ? 'DELETED' : 'READY',
          uploadedAt: date(upload.createdAt),
          deletedAt: nullableDate(upload.deletedAt),
          deletedById: upload.deletedById || null
        }
      });
    }

    for (const message of messages) {
      const senderId = users.some((user) => user.id === message.userId) ? message.userId : users[0]?.id;
      if (!senderId || !rooms.some((room) => room.id === message.roomId)) continue;
      await prisma.message.upsert({
        where: { id: message.id },
        update: { body: message.text || null, editedAt: nullableDate(message.editedAt), deletedAt: nullableDate(message.deletedAt) },
        create: {
          id: message.id,
          roomId: message.roomId,
          senderId,
          type: message.attachment || message.attachmentId ? 'FILE' : 'TEXT',
          body: message.text || null,
          clientNonce: `imported:${message.id}`,
          editedAt: nullableDate(message.editedAt),
          deletedAt: nullableDate(message.deletedAt),
          createdAt: date(message.createdAt),
          updatedAt: date(message.updatedAt || message.createdAt)
        }
      });

      const attachmentId = message.attachmentId || message.attachment?.id;
      if (attachmentId && uploads.some((upload) => upload.id === attachmentId)) {
        await prisma.messageAttachment.upsert({
          where: { messageId_fileId: { messageId: message.id, fileId: attachmentId } },
          update: {},
          create: { organizationId, messageId: message.id, fileId: attachmentId, uploaderId: senderId }
        });
      }
    }

    for (const post of posts) {
      if (!users.some((user) => user.id === post.userId)) continue;
      await prisma.profilePost.upsert({
        where: { id: post.id },
        update: { text: post.text || '', deletedAt: nullableDate(post.deletedAt) },
        create: {
          id: post.id,
          organizationId,
          userId: post.userId,
          text: post.text || '',
          attachmentFileId: uploads.some((upload) => upload.id === post.attachmentId) ? post.attachmentId : null,
          pinnedAt: nullableDate(post.pinnedAt),
          deletedAt: nullableDate(post.deletedAt),
          createdAt: date(post.createdAt),
          updatedAt: date(post.updatedAt || post.createdAt)
        }
      });
    }

    for (const comment of array(state.postComments)) {
      if (!posts.some((post) => post.id === comment.postId) || !users.some((user) => user.id === comment.userId)) continue;
      await prisma.profilePostComment.upsert({
        where: { id: comment.id },
        update: { text: comment.text || '', deletedAt: nullableDate(comment.deletedAt) },
        create: {
          id: comment.id,
          organizationId,
          postId: comment.postId,
          userId: comment.userId,
          text: comment.text || '',
          deletedAt: nullableDate(comment.deletedAt),
          createdAt: date(comment.createdAt),
          updatedAt: date(comment.updatedAt || comment.createdAt)
        }
      });
    }

    for (const reaction of array(state.postReactions)) {
      if (!posts.some((post) => post.id === reaction.postId) || !users.some((user) => user.id === reaction.userId)) continue;
      await prisma.profilePostReaction.upsert({
        where: { postId_userId_emoji: { postId: reaction.postId, userId: reaction.userId, emoji: reaction.emoji || reaction.type || 'like' } },
        update: {},
        create: { organizationId, postId: reaction.postId, userId: reaction.userId, emoji: reaction.emoji || reaction.type || 'like' }
      });
    }

    for (const share of array(state.fileShareLinks)) {
      if (!uploads.some((upload) => upload.id === share.fileId) || !users.some((user) => user.id === share.createdById)) continue;
      await prisma.fileShareLink.upsert({
        where: { tokenHash: share.tokenHash },
        update: { revokedAt: nullableDate(share.revokedAt), expiresAt: date(share.expiresAt) },
        create: {
          id: share.id,
          organizationId,
          fileId: share.fileId,
          tokenHash: share.tokenHash,
          createdById: share.createdById,
          expiresAt: date(share.expiresAt),
          revokedAt: nullableDate(share.revokedAt),
          createdAt: date(share.createdAt)
        }
      });
    }

    for (const item of array(state.notifications)) {
      if (!users.some((user) => user.id === item.userId)) continue;
      const conversation = item.roomId ? await prisma.conversation.findUnique({ where: { legacyRoomId: item.roomId } }) : null;
      await prisma.notification.upsert({
        where: { id: item.id },
        update: { readAt: nullableDate(item.readAt), targetUrl: item.targetUrl || null },
        create: {
          id: item.id,
          organizationId,
          userId: item.userId,
          roomId: rooms.some((room) => room.id === item.roomId) ? item.roomId : null,
          messageId: messages.some((message) => message.id === item.messageId) ? item.messageId : null,
          conversationId: conversation?.id || null,
          targetType: item.targetType || null,
          targetId: item.targetId || null,
          targetUrl: item.targetUrl || null,
          title: item.title || 'PL CHAT',
          body: item.body || item.text || '',
          readAt: nullableDate(item.readAt),
          createdAt: date(item.createdAt)
        }
      });
    }

    for (const item of array(state.auditLog)) {
      await prisma.activityLog.upsert({
        where: { id: item.id },
        update: {},
        create: {
          id: item.id,
          organizationId,
          actorId: users.some((user) => user.id === item.actorId || user.id === item.userId) ? (item.actorId || item.userId) : null,
          action: item.action || 'imported.event',
          entityType: item.entityType || item.targetType || 'unknown',
          entityId: item.entityId || item.targetId || item.id,
          metadata: item.metadata || {},
          createdAt: date(item.createdAt)
        }
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyImport(state) {
  const prisma = new PrismaClient();
  const expected = expectedImportCounts(state);
  const userIds = array(state.users).map((user) => user.id);
  const roomIds = array(state.rooms).map((room) => room.id);
  const messageIds = array(state.messages).map((message) => message.id);
  const uploadIds = array(state.uploads).map((upload) => upload.id);
  const postIds = array(state.posts).map((post) => post.id);
  const commentIds = array(state.postComments).map((comment) => comment.id);
  const notificationIds = array(state.notifications).map((item) => item.id);
  const auditIds = array(state.auditLog).map((item) => item.id);

  try {
    const actual = {
      users: await prisma.user.count({ where: { organizationId, id: { in: userIds } } }),
      sessions: await prisma.session.count({ where: { organizationId, userId: { in: userIds } } }),
      chatRooms: await prisma.chatRoom.count({ where: { id: { in: roomIds } } }),
      conversations: await prisma.conversation.count({ where: { organizationId, legacyRoomId: { in: roomIds } } }),
      messages: await prisma.message.count({ where: { id: { in: messageIds } } }),
      files: await prisma.file.count({ where: { organizationId, id: { in: uploadIds } } }),
      fileShareLinks: await prisma.fileShareLink.count({ where: { organizationId } }),
      profilePosts: await prisma.profilePost.count({ where: { organizationId, id: { in: postIds } } }),
      profilePostComments: await prisma.profilePostComment.count({ where: { organizationId, id: { in: commentIds } } }),
      profilePostReactions: await prisma.profilePostReaction.count({ where: { organizationId, postId: { in: postIds } } }),
      notifications: await prisma.notification.count({ where: { organizationId, id: { in: notificationIds } } }),
      activityLogs: await prisma.activityLog.count({ where: { organizationId, id: { in: auditIds } } })
    };
    const mismatches = Object.keys(expected)
      .filter((key) => expected[key] !== actual[key])
      .map((key) => ({ key, expected: expected[key], actual: actual[key] }));
    return { expected, actual, matched: mismatches.length === 0, mismatches };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const state = await loadState();
  console.log('PL CHAT JSON import plan');
  console.log(JSON.stringify({ jsonPath, organizationId, organizationName, counts: counts(state), mode: apply ? 'apply' : 'dry-run' }, null, 2));

  if (apply) {
    await importState(state);
    console.log('Import completed.');
  }

  if (verify || apply) {
    console.log('Database verification');
    const result = await verifyImport(state);
    console.log(JSON.stringify(result, null, 2));
    if (!result.matched) {
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
