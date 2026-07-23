import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceState = join(root, 'pl-chat-data', 'pl-chat-workspace.json');
const smokeRoot = join(root, '.smoke-data', `direct-multipart-${Date.now()}`);
const dataDir = join(smokeRoot, 'data');
const appPort = 18788;
const s3Port = 18789;
const appUrl = `http://127.0.0.1:${appPort}`;
const s3Url = `http://127.0.0.1:${s3Port}`;
const uploads = new Map();
const objects = new Map();
const results = [];
let appProcess;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function fakeS3() {
  return createServer(async (request, response) => {
    const url = new URL(request.url, s3Url);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Expose-Headers', 'ETag');
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      });
      response.end();
      return;
    }
    if (request.method === 'POST' && url.searchParams.has('uploads')) {
      const uploadId = randomUUID();
      uploads.set(uploadId, { key: url.pathname, parts: new Map(), completed: false, aborted: false });
      response.writeHead(200, { 'Content-Type': 'application/xml' });
      response.end(`<InitiateMultipartUploadResult><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`);
      return;
    }
    if (request.method === 'GET') {
      const body = objects.get(url.pathname);
      if (!body) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': url.searchParams.get('response-content-type') || 'application/octet-stream',
        'Content-Length': body.length,
        'Content-Disposition': url.searchParams.get('response-content-disposition') || 'attachment'
      });
      response.end(body);
      return;
    }
    const uploadId = url.searchParams.get('uploadId') || '';
    const upload = uploads.get(uploadId);
    if (!upload) {
      response.writeHead(404);
      response.end();
      return;
    }
    if (request.method === 'PUT') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const partNumber = Number(url.searchParams.get('partNumber') || 0);
      const etag = `"${createHash('md5').update(body).digest('hex')}"`;
      upload.parts.set(partNumber, { body, etag });
      response.writeHead(200, { ETag: etag });
      response.end();
      return;
    }
    if (request.method === 'POST') {
      upload.completed = true;
      objects.set(
        upload.key,
        Buffer.concat([...upload.parts.entries()].sort(([left], [right]) => left - right).map(([, part]) => part.body))
      );
      response.writeHead(200, { 'Content-Type': 'application/xml' });
      response.end('<CompleteMultipartUploadResult><ETag>"complete"</ETag></CompleteMultipartUploadResult>');
      return;
    }
    if (request.method === 'DELETE') {
      upload.aborted = true;
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(405);
    response.end();
  });
}

async function api(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${appUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const contentType = response.headers.get('content-type') || '';
  const value = contentType.includes('application/json') ? await response.json() : null;
  return { response, value };
}

async function waitForHealth() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const { response, value } = await api('/api/health');
      if (response.ok && value?.ok) return value;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('PL CHAT multipart smoke server did not become healthy.');
}

async function main() {
  await mkdir(dataDir, { recursive: true });
  await copyFile(sourceState, join(dataDir, 'pl-chat-workspace.json'));
  const workspace = JSON.parse(await readFile(sourceState, 'utf8'));
  const session = [...(workspace.sessions || [])]
    .filter((item) => new Date(item.expiresAt).getTime() > Date.now())
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
  if (!session) throw new Error('No active PL CHAT session is available.');

  const s3Server = fakeS3();
  await new Promise((resolveListen) => s3Server.listen(s3Port, '127.0.0.1', resolveListen));
  appProcess = spawn(process.execPath, [join(root, 'trial-server', 'server.mjs')], {
    cwd: root,
    env: {
      ...process.env,
      APP_ENV: 'production',
      NODE_ENV: 'test',
      PL_CHAT_PORT: String(appPort),
      PL_CHAT_HOST: '127.0.0.1',
      PL_CHAT_DATA_DIR: dataDir,
      FILE_STORAGE_DRIVER: 's3',
      ENABLE_DIRECT_UPLOAD: 'true',
      ENABLE_MULTIPART_UPLOAD: 'true',
      ENABLE_CHUNK_UPLOAD: 'true',
      MULTIPART_MIN_FILE_SIZE_MB: '1',
      MULTIPART_DEFAULT_PART_SIZE_MB: '5',
      MULTIPART_MIN_PART_SIZE_MB: '5',
      MULTIPART_MAX_PART_SIZE_MB: '8',
      MAX_UPLOAD_SIZE_MB: '64',
      MAX_UPLOAD_SIZE_GB: '1',
      S3_ENDPOINT: s3Url,
      S3_BUCKET: 'pl-chat-smoke',
      S3_REGION: 'test',
      S3_ACCESS_KEY_ID: 'smoke-access',
      S3_SECRET_ACCESS_KEY: 'smoke-secret',
      S3_FORCE_PATH_STYLE: 'true'
    },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  try {
    await waitForHealth();

    const token = session.token;
    const { value: me } = await api('/api/me', { token });
    const { value: roomList } = await api('/api/rooms', { token });
    const { value: filesSettings } = await api('/api/files?limit=1', { token });
    const room = (roomList.rooms || []).find((item) => !item.deletedAt && !item.archivedAt);
    record('authenticated multipart session', Boolean(me?.user && room), me?.user?.name || '');
    record(
      'authenticated multipart capability enabled',
      filesSettings?.enableMultipartUpload === true,
      `threshold=${filesSettings?.multipartMinFileSizeMb || 'n/a'}MB`
    );

    const { response: initResponse, value: initResult } = await api('/api/uploads/multipart/init', {
      token,
      method: 'POST',
      body: {
        name: 'phase-b-direct-multipart.zip',
        mimeType: 'application/zip',
        size: 12 * 1024 * 1024,
        roomId: room.id,
        concurrency: 3
      }
    });
    const upload = initResult?.upload;
    record('multipart initialization', initResponse.status === 201 && Boolean(upload?.providerUploadId), `${upload?.totalParts || 0} parts`);

    const completedParts = [];
    for (let partNumber = 1; partNumber <= upload.totalParts; partNumber += 1) {
      const { response: signedResponse, value: signedResult } = await api(`/api/uploads/multipart/${upload.uploadId}/part-url`, {
        token,
        method: 'POST',
        body: { partNumber }
      });
      const expectedBytes = partNumber === upload.totalParts
        ? upload.size - ((partNumber - 1) * upload.partSizeBytes)
        : upload.partSizeBytes;
      const partBody = Buffer.alloc(expectedBytes, partNumber);
      const partResponse = await fetch(signedResult.part.url, { method: 'PUT', body: partBody });
      completedParts.push({ partNumber, etag: partResponse.headers.get('etag') });
      record(`multipart signed part ${partNumber}`, signedResponse.ok && partResponse.ok && Boolean(completedParts.at(-1).etag));
    }

    const { response: completeResponse, value: completeResult } = await api(`/api/uploads/multipart/${upload.uploadId}/complete`, {
      token,
      method: 'POST',
      body: { parts: completedParts }
    });
    const file = completeResult?.attachment;
    const completedState = JSON.parse(await readFile(join(dataDir, 'pl-chat-workspace.json'), 'utf8'));
    const internalFile = (completedState.uploads || []).find((item) => item.id === file?.id);
    record(
      'multipart completion and file metadata',
      completeResponse.status === 201
        && internalFile?.uploadMethod === 'multipart'
        && internalFile?.storageDriver === 's3'
        && Number(file?.size) === upload.size,
      `status=${completeResponse.status} method=${internalFile?.uploadMethod || 'n/a'} storage=${internalFile?.storageDriver || 'n/a'} size=${file?.size || 'n/a'}`
    );

    const { response: fileResponse, value: fileResult } = await api(`/api/files/${file.id}`, { token });
    record('multipart file visible after completion', fileResponse.ok && fileResult?.file?.id === file.id);

    const { response: downloadResponse } = await api(`/api/files/${file.id}/download`, { token });
    const downloadedBytes = Number(downloadResponse.headers.get('content-length') || 0);
    record(
      'secure S3 download returns original bytes',
      downloadResponse.ok && downloadedBytes === upload.size,
      `status=${downloadResponse.status} bytes=${downloadedBytes}`
    );

    const { response: unauthResponse } = await api('/api/uploads/multipart/init', {
      method: 'POST',
      body: { name: 'blocked.zip', mimeType: 'application/zip', size: 12 * 1024 * 1024, roomId: room.id }
    });
    record('unauthenticated multipart blocked', unauthResponse.status === 401, String(unauthResponse.status));

    const { value: cancelInit } = await api('/api/uploads/multipart/init', {
      token,
      method: 'POST',
      body: { name: 'cancel.zip', mimeType: 'application/zip', size: 12 * 1024 * 1024, roomId: room.id }
    });
    const { response: cancelResponse } = await api(`/api/uploads/multipart/${cancelInit.upload.uploadId}/cancel`, {
      token,
      method: 'POST',
      body: {}
    });
    record('multipart cancel', cancelResponse.ok);
  } finally {
    appProcess?.kill();
    await new Promise((resolveClose) => s3Server.close(resolveClose));
  }
}

try {
  await main();
} catch (error) {
  record('direct multipart smoke execution', false, error.message);
  process.exitCode = 1;
} finally {
  appProcess?.kill();
  await rm(smokeRoot, { recursive: true, force: true }).catch(() => {});
  const failed = results.filter((item) => !item.ok);
  console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, failed: failed.map((item) => item.name) }, null, 2));
}
