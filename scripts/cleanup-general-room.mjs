import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dataFile = path.join(root, 'pl-chat-data', 'pl-chat-workspace.json');
const uploadsDir = path.join(root, 'pl-chat-data', 'uploads');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(root, '.backups', `general-room-cleanup-${stamp}`);
const backupUploadsDir = path.join(backupDir, 'uploads');

fs.mkdirSync(backupUploadsDir, { recursive: true });

const raw = fs.readFileSync(dataFile, 'utf8');
fs.writeFileSync(path.join(backupDir, 'pl-chat-workspace.before-cleanup.json'), raw);
const state = JSON.parse(raw);

const hasGeneralRoom = (item = {}) => (
  item.roomId === 'general'
  || item.conversationId === 'general'
  || (Array.isArray(item.roomIds) && item.roomIds.includes('general'))
  || (typeof item.targetUrl === 'string' && (item.targetUrl.includes('/chats/general') || item.targetUrl.includes('/general')))
);

const generalMessages = new Set((state.messages || []).filter((item) => item.roomId === 'general').map((item) => item.id));
const generalUploads = new Set((state.uploads || []).filter(hasGeneralRoom).map((item) => item.id));
const storageKeysToMove = new Set();

state.messages = (state.messages || []).filter((item) => item.roomId !== 'general');
state.uploads = (state.uploads || []).filter((item) => {
  if (!generalUploads.has(item.id)) return true;
  if (item.storageKey) storageKeysToMove.add(item.storageKey);
  return false;
});
state.fileShareLinks = (state.fileShareLinks || []).filter((item) => !hasGeneralRoom(item) && !generalUploads.has(item.fileId) && !generalUploads.has(item.uploadId));
state.notifications = (state.notifications || []).filter((item) => (
  !hasGeneralRoom(item)
  && !generalMessages.has(item.entityId)
  && !generalMessages.has(item.targetId)
  && !generalUploads.has(item.entityId)
  && !generalUploads.has(item.targetId)
  && !generalUploads.has(item.targetFileId)
));
state.activityLog = (state.activityLog || []).filter((item) => (
  !hasGeneralRoom(item)
  && item.entityId !== 'general'
  && !generalMessages.has(item.entityId)
  && !generalUploads.has(item.entityId)
));
state.activityLogs = (state.activityLogs || []).filter((item) => (
  !hasGeneralRoom(item)
  && item.entityId !== 'general'
  && !generalMessages.has(item.entityId)
  && !generalUploads.has(item.entityId)
));
state.roomPins = (state.roomPins || []).filter((item) => item.roomId !== 'general');
state.readReceipts = (state.readReceipts || []).filter((item) => item.roomId !== 'general');
state.typing = (state.typing || []).filter((item) => item.roomId !== 'general');

let movedFiles = 0;
let missingFiles = 0;
for (const storageKey of storageKeysToMove) {
  const source = path.join(uploadsDir, storageKey);
  const target = path.join(backupUploadsDir, storageKey);
  if (!fs.existsSync(source)) {
    missingFiles += 1;
    continue;
  }
  fs.renameSync(source, target);
  movedFiles += 1;
}

fs.writeFileSync(dataFile, JSON.stringify(state, null, 2));

const remaining = {
  messages: (state.messages || []).filter((item) => item.roomId === 'general').length,
  uploads: (state.uploads || []).filter(hasGeneralRoom).length,
  notifications: (state.notifications || []).filter(hasGeneralRoom).length,
  fileShareLinks: (state.fileShareLinks || []).filter(hasGeneralRoom).length,
  activityLog: (state.activityLog || []).filter((item) => hasGeneralRoom(item) || item.entityId === 'general').length,
  activityLogs: (state.activityLogs || []).filter((item) => hasGeneralRoom(item) || item.entityId === 'general').length,
  pins: (state.roomPins || []).filter((item) => item.roomId === 'general').length,
  reads: (state.readReceipts || []).filter((item) => item.roomId === 'general').length
};

console.log(JSON.stringify({
  backupDir,
  removed: {
    messages: generalMessages.size,
    uploads: generalUploads.size,
    movedFiles,
    missingFiles
  },
  remaining
}, null, 2));
