import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  open,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const baseUrl = process.env.PL_CHAT_SMOKE_URL || 'http://localhost:8788';
const statePath = join(root, 'pl-chat-data', 'pl-chat-workspace.json');
const smokeRoot = join(root, '.smoke-data', `file-transfer-${Date.now()}`);
const createdFileIds = [];
const createdMessageIds = [];
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}

async function api(path, { token, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !(body instanceof Uint8Array) && !Buffer.isBuffer(body)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...headers
    },
    body: body === undefined
      ? undefined
      : (body instanceof Uint8Array || Buffer.isBuffer(body) ? body : JSON.stringify(body))
  });
  const contentType = response.headers.get('content-type') || '';
  const value = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(value?.error || value?.message || `${response.status} ${response.statusText}`);
    error.status = response.status;
    error.body = value;
    throw error;
  }
  return { response, value };
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function downloadToFile(path, token, destination, range = '') {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(range ? { Range: range } : {})
    }
  });
  if (!response.ok) throw new Error(`download_failed_${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
  return response;
}

async function directUpload(path, token, roomId, mimeType) {
  const info = await stat(path);
  const response = await fetch(`${baseUrl}/api/uploads/binary?name=${encodeURIComponent(basename(path))}&roomId=${encodeURIComponent(roomId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': mimeType,
      'Content-Length': String(info.size)
    },
    body: createReadStream(path),
    duplex: 'half'
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || body.message || `upload_failed_${response.status}`);
  createdFileIds.push(body.attachment.id);
  return body.attachment;
}

async function initChunkUpload(path, token, roomId, overrides = {}) {
  const info = await stat(path);
  const { value } = await api('/api/uploads/chunk/init', {
    token,
    method: 'POST',
    body: {
      name: basename(path),
      mimeType: overrides.mimeType || 'application/octet-stream',
      size: overrides.size || info.size,
      roomId
    }
  });
  return value.upload;
}

async function uploadChunkPart(path, upload, index, token) {
  const handle = await open(path, 'r');
  try {
    const start = index * upload.chunkSize;
    const expected = Math.min(upload.chunkSize, upload.size - start);
    const buffer = Buffer.allocUnsafe(expected);
    const { bytesRead } = await handle.read(buffer, 0, expected, start);
    const { value } = await api(`/api/uploads/chunk/${upload.uploadId}/part?index=${index}`, {
      token,
      method: 'POST',
      body: buffer.subarray(0, bytesRead),
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bytesRead)
      }
    });
    return value;
  } finally {
    await handle.close();
  }
}

async function completeChunkUpload(path, token, roomId, mimeType) {
  const upload = await initChunkUpload(path, token, roomId, { mimeType });
  for (let index = 0; index < upload.totalParts; index += 1) {
    await uploadChunkPart(path, upload, index, token);
  }
  const { value } = await api(`/api/uploads/chunk/${upload.uploadId}/complete`, {
    token,
    method: 'POST',
    body: {}
  });
  createdFileIds.push(value.attachment.id);
  return value.attachment;
}

async function cancelChunkUpload(uploadId, token) {
  await api(`/api/uploads/chunk/${uploadId}/cancel`, { token, method: 'POST', body: {} });
}

async function createMessage(roomId, attachmentId, batchId, token) {
  const { value } = await api(`/api/rooms/${roomId}/messages`, {
    token,
    method: 'POST',
    body: {
      attachmentId,
      batchId,
      clientNonce: `smoke-${Date.now()}-${attachmentId}`
    }
  });
  createdMessageIds.push(value.message.id);
  return value.message;
}

async function main() {
  await mkdir(smokeRoot, { recursive: true });
  const workspace = JSON.parse(await readFile(statePath, 'utf8'));
  const now = Date.now();
  const session = [...(workspace.sessions || [])]
    .filter((item) => new Date(item.expiresAt).getTime() > now)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (!session) throw new Error('No active PL CHAT user session is available.');
  const token = session.token;

  const { value: me } = await api('/api/me', { token });
  const { value: roomsResult } = await api('/api/rooms', { token });
  const room = (roomsResult.rooms || []).find((item) => !item.deletedAt && !item.archivedAt);
  if (!room) throw new Error('No accessible chat room is available.');
  record('authenticated real user session', true, me.user.name);
  record('accessible chat room', true, room.name);

  const samples = [
    ['smoke-image.png', 'image/png'],
    ['smoke-image.jpg', 'image/jpeg'],
    ['smoke-image.jpeg', 'image/jpeg']
  ];
  for (const [name] of samples) await copyFile(join(root, 'assets', 'logo.png'), join(smokeRoot, name));
  await writeFile(join(smokeRoot, 'smoke-design.tiff'), Buffer.from('49492a000800000000000000', 'hex'));
  await writeFile(join(smokeRoot, 'smoke-design.psd'), Buffer.from('38425053000100000000000000030000000100000001', 'hex'));
  await writeFile(join(smokeRoot, 'smoke-design.ai'), Buffer.from('%!PS-Adobe-3.0\n%%Title: PL CHAT smoke AI\n%%EOF\n'));
  await writeFile(join(smokeRoot, 'smoke-archive.zip'), Buffer.from('504b0506000000000000000000000000000000000000', 'hex'));

  const imageFiles = await Promise.all(samples.map(([name, mime]) => directUpload(join(smokeRoot, name), token, room.id, mime)));
  const batchId = `smoke-album-${Date.now()}`;
  for (const file of imageFiles) await createMessage(room.id, file.id, batchId, token);
  record('jpg/jpeg/png multi-image album upload', imageFiles.length === 3, `${imageFiles.length} original files`);

  const workFiles = [];
  for (const [name, mime] of [
    ['smoke-design.tiff', 'image/tiff'],
    ['smoke-design.psd', 'image/vnd.adobe.photoshop'],
    ['smoke-design.ai', 'application/postscript'],
    ['smoke-archive.zip', 'application/zip']
  ]) {
    workFiles.push(await directUpload(join(smokeRoot, name), token, room.id, mime));
  }
  record('tiff/psd/ai/zip upload', workFiles.length === 4, `${workFiles.length} original files`);

  const safePreview = await fetch(`${baseUrl}/api/files/${imageFiles[0].id}/preview`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const blockedPreview = await fetch(`${baseUrl}/api/files/${workFiles.at(-1).id}/preview`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  record('safe image preview', safePreview.ok, String(safePreview.status));
  record('unsafe ZIP preview blocked', !blockedPreview.ok, String(blockedPreview.status));

  for (const file of [...imageFiles, ...workFiles]) {
    const original = join(smokeRoot, file.name);
    const downloaded = join(smokeRoot, `download-${file.name}`);
    await downloadToFile(`/api/files/${file.id}/download`, token, downloaded);
    record(`download hash ${file.extension}`, await sha256(original) === await sha256(downloaded));
  }

  const largePath = join(smokeRoot, 'smoke-large-256mb.zip');
  const largeHandle = await open(largePath, 'w');
  await largeHandle.truncate(256 * 1024 * 1024);
  await largeHandle.close();
  const largeFile = await completeChunkUpload(largePath, token, room.id, 'application/zip');
  record('256MB ZIP chunk upload', Number(largeFile.size) === 256 * 1024 * 1024, `${largeFile.size} bytes`);

  const largeDownload = join(smokeRoot, 'download-smoke-large-256mb.zip');
  await downloadToFile(`/api/files/${largeFile.id}/download`, token, largeDownload);
  record('256MB ZIP full download hash', await sha256(largePath) === await sha256(largeDownload));
  const rangeDownload = join(smokeRoot, 'range-smoke-large-256mb.zip');
  const rangeResponse = await downloadToFile(`/api/files/${largeFile.id}/download`, token, rangeDownload, 'bytes=1048576-2097151');
  record('large-file HTTP range/resume', rangeResponse.status === 206 && (await stat(rangeDownload)).size === 1048576, String(rangeResponse.status));

  const retryPath = join(smokeRoot, 'smoke-resume-128mb.zip');
  const retryHandle = await open(retryPath, 'w');
  await retryHandle.truncate(128 * 1024 * 1024);
  await retryHandle.close();
  const retryUpload = await initChunkUpload(retryPath, token, room.id);
  await uploadChunkPart(retryPath, retryUpload, 0, token);
  const retryResult = await uploadChunkPart(retryPath, retryUpload, 0, token);
  record('chunk retry/resume', retryResult.part?.resumed === true);
  await cancelChunkUpload(retryUpload.uploadId, token);
  let cancelledBlocked = false;
  try {
    await api(`/api/uploads/chunk/${retryUpload.uploadId}/status`, { token });
  } catch (error) {
    cancelledBlocked = error.status === 404;
  }
  record('chunk cancel', cancelledBlocked);

  for (const gigabytes of [10, 20]) {
    const virtualPath = join(smokeRoot, `virtual-${gigabytes}gb.zip`);
    await writeFile(virtualPath, Buffer.alloc(1));
    const upload = await initChunkUpload(virtualPath, token, room.id, {
      mimeType: 'application/zip',
      size: gigabytes * 1024 * 1024 * 1024
    });
    record(`${gigabytes}GB upload initialization`, upload.totalParts > 0, `${upload.totalParts} parts`);
    await cancelChunkUpload(upload.uploadId, token);
  }

  const unauthDownload = await fetch(`${baseUrl}/api/files/${largeFile.id}/download`);
  record('unauthenticated download blocked', unauthDownload.status === 401, String(unauthDownload.status));

  const { value: fileList } = await api(`/api/files?q=smoke-&limit=120`, { token });
  record('Files Center search finds smoke files', (fileList.files || []).length >= createdFileIds.length);
}

async function cleanup() {
  let workspace = null;
  try {
    workspace = JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    workspace = null;
  }
  const session = [...(workspace?.sessions || [])]
    .filter((item) => new Date(item.expiresAt).getTime() > Date.now())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const token = session?.token;
  if (token) {
    for (const messageId of createdMessageIds) {
      await api(`/api/messages/${messageId}`, { token, method: 'DELETE' }).catch(() => {});
    }
    for (const fileId of createdFileIds) {
      await api(`/api/files/${fileId}`, { token, method: 'DELETE' }).catch(() => {});
    }
  }
  await rm(smokeRoot, { recursive: true, force: true }).catch(() => {});
}

try {
  await main();
} catch (error) {
  record('smoke test execution', false, error.message);
  process.exitCode = 1;
} finally {
  await cleanup();
  const passed = results.filter((item) => item.ok).length;
  console.log(JSON.stringify({ passed, total: results.length, failed: results.filter((item) => !item.ok).map((item) => item.name) }, null, 2));
}
