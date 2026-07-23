import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1');
const token = 'phase-t-kaveep-service-token';
const kaveepPort = 18765;
const plChatPort = 18788;
const kaveepBaseUrl = `http://127.0.0.1:${kaveepPort}`;
const plChatBaseUrl = `http://127.0.0.1:${plChatPort}`;
let jobPolls = 0;
let cancelledRemoteTask = '';

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); } });
  });
}

async function waitFor(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function api(path, { method = 'GET', token: authToken, body } = {}) {
  const response = await fetch(`${plChatBaseUrl}${path}`, {
    method,
    headers: { ...(authToken ? { authorization: `Bearer ${authToken}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { response, payload: await response.json() };
}

async function waitForTask(authToken, taskId, expected) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const { payload } = await api(`/api/ai/tasks/${taskId}`, { token: authToken });
    if (payload.task?.status === expected) return payload.task;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Task ${taskId} did not reach ${expected}`);
}

const kaveep = createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { error: 'unauthorized' });
  if (request.method === 'GET' && request.url === '/health') return json(response, 200, { ok: true });
  if (request.method === 'POST' && request.url === '/api/integrations/pl-chat/chat') {
    const body = await readBody(request);
    assert.equal(body.consent, true);
    assert.ok(body.taskId && body.roomId && body.userId);
    assert.equal(Object.hasOwn(body, 'repository'), false);
    if (body.message === 'bad token') return json(response, 401, { error: 'unauthorized' });
    if (body.message === 'fail KAVEEP') return json(response, 503, { error: 'unavailable' });
    if (body.message === 'slow KAVEEP') await new Promise((resolve) => setTimeout(resolve, 1200));
    return json(response, 200, { message: `KAVEEP: ${body.message}` });
  }
  if (request.method === 'POST' && request.url === '/api/integrations/pl-chat/images') {
    const body = await readBody(request);
    assert.equal(body.consent, true);
    assert.ok(body.taskId && body.roomId && body.userId);
    return json(response, 202, { taskId: body.message === 'cancel image' ? 'image-task-cancel' : 'image-task-1', status: 'queued' });
  }
  if (request.method === 'GET' && request.url.startsWith('/api/integrations/pl-chat/tasks/')) {
    const url = new URL(request.url, 'http://127.0.0.1');
    assert.equal(url.searchParams.get('consent'), 'true');
    assert.ok(url.searchParams.get('taskId') && url.searchParams.get('roomId') && url.searchParams.get('userId'));
    if (url.pathname.endsWith('image-task-cancel')) return json(response, 200, { taskId: 'image-task-cancel', status: 'generating' });
    jobPolls += 1;
    return json(response, 200, jobPolls < 2 ? { taskId: 'image-task-1', status: 'generating' } : { taskId: 'image-task-1', status: 'completed', imageUrl: 'https://example.invalid/kaveep.png', thumbnailUrl: 'https://example.invalid/kaveep-thumb.png' });
  }
  if (request.method === 'POST' && request.url.startsWith('/api/integrations/pl-chat/tasks/') && request.url.endsWith('/cancel')) {
    const body = await readBody(request);
    assert.equal(body.consent, true);
    assert.ok(body.taskId && body.roomId && body.userId);
    cancelledRemoteTask = body.taskId;
    return json(response, 200, { ok: true });
  }
  return json(response, 404, { error: 'not_found' });
});

const dataDir = await mkdtemp(join(tmpdir(), 'plchat-kaveep-'));
let plChat;
try {
  await new Promise((resolve) => kaveep.listen(kaveepPort, '127.0.0.1', resolve));
  plChat = spawn(process.execPath, ['trial-server/server.mjs'], {
    cwd: root,
    env: { ...process.env, APP_ENV: 'test', NODE_ENV: 'test', PL_CHAT_PORT: String(plChatPort), PL_CHAT_HOST: '127.0.0.1', PL_CHAT_DATA_DIR: dataDir, PL_CHAT_LAN_ONLY: 'false', EMAIL_VERIFICATION_REQUIRED: 'false', KAVEEP_BASE_URL: kaveepBaseUrl, KAVEEP_SERVICE_TOKEN: token, KAVEEP_REQUEST_TIMEOUT_MS: '300' },
    stdio: 'pipe'
  });
  await waitFor(`${plChatBaseUrl}/health`);
  assert.equal((await api('/health')).payload.kaveepConfigured, true);

  const email = `phase-t-${Date.now()}@example.test`;
  assert.equal((await api('/api/auth/register', { method: 'POST', body: { name: 'Phase T User', email, password: 'phase-t-password' } })).response.status, 201);
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: 'phase-t-password' } });
  const authToken = login.payload.token;
  assert.ok(authToken);

  const noConsent = await api('/api/ai/tasks', { method: 'POST', token: authToken, body: { roomId: 'general', mode: 'chat', trigger: 'ask', message: 'hello', consent: false } });
  assert.equal(noConsent.response.status, 403);
  assert.equal(noConsent.payload.error, 'ai_consent_required');
  const chat = await api('/api/ai/tasks', { method: 'POST', token: authToken, body: { roomId: 'general', mode: 'chat', trigger: 'ask', message: 'hello', consent: true } });
  assert.match((await waitForTask(authToken, chat.payload.task.id, 'completed')).result.text, /KAVEEP: hello/);
  const image = await api('/api/ai/tasks', { method: 'POST', token: authToken, body: { roomId: 'general', mode: 'image', trigger: 'image', message: 'studio image', consent: true } });
  assert.match((await waitForTask(authToken, image.payload.task.id, 'completed')).result.imageUrl, /kaveep\.png$/);
  const upload = await api('/api/uploads', { method: 'POST', token: authToken, body: { roomId: 'general', name: 'reference.png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9mAAAAABJRU5ErkJggg==' } });
  assert.equal(upload.response.status, 201);
  const reference = await api('/api/ai/tasks', { method: 'POST', token: authToken, body: { roomId: 'general', mode: 'reference_image', trigger: 'reference_image', message: 'reference image', consent: true, attachmentIds: [upload.payload.attachment.id] } });
  assert.equal(reference.response.status, 202);
  assert.match((await waitForTask(authToken, reference.payload.task.id, 'completed')).result.imageUrl, /kaveep\.png$/);
  const unauthorized = await api('/api/ai/tasks', { method: 'POST', token: authToken, body: { roomId: 'general', mode: 'chat', trigger: 'ask', message: 'bad token', consent: true } });
  assert.equal((await waitForTask(authToken, unauthorized.payload.task.id, 'failed')).error, 'kaveep_auth_failed');
  const failed = await api('/api/ai/tasks', { method: 'POST', token: authToken, body: { roomId: 'general', mode: 'chat', trigger: 'ask', message: 'fail KAVEEP', consent: true } });
  const failedTask = await waitForTask(authToken, failed.payload.task.id, 'failed');
  assert.equal(failedTask.error, 'kaveep_request_failed');
  const retried = await api(`/api/ai/tasks/${failedTask.id}/retry`, { method: 'POST', token: authToken });
  assert.notEqual(retried.payload.task.id, failedTask.id);
  const slow = await api('/api/ai/tasks', { method: 'POST', token: authToken, body: { roomId: 'general', mode: 'chat', trigger: 'ask', message: 'slow KAVEEP', consent: true } });
  assert.equal((await waitForTask(authToken, slow.payload.task.id, 'failed')).error, 'kaveep_timeout');
  const cancel = await api('/api/ai/tasks', { method: 'POST', token: authToken, body: { roomId: 'general', mode: 'image', trigger: 'image', message: 'cancel image', consent: true } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await api(`/api/ai/tasks/${cancel.payload.task.id}/cancel`, { method: 'POST', token: authToken })).response.status, 200);
  assert.equal((await waitForTask(authToken, cancel.payload.task.id, 'cancelled')).status, 'cancelled');
  assert.equal(cancelledRemoteTask, 'image-task-cancel');
  console.log('PASS: chat, image, 401, 403, timeout, cancellation, retry, and health.');
} finally {
  if (plChat && !plChat.killed) plChat.kill('SIGTERM');
  await new Promise((resolve) => kaveep.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}
