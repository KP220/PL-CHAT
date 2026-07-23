import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const baseUrl = String(process.env.PL_CHAT_BENCHMARK_URL || 'http://localhost:8788').replace(/\/+$/, '');
const sizeMbList = parseSizeList(process.env.PL_CHAT_BENCHMARK_SIZES_MB || '100,1024,10240,20480');
const runs = Math.max(1, Math.floor(numberEnv('PL_CHAT_BENCHMARK_RUNS', 1)));
const realLargeTransfer = boolEnv('PL_CHAT_BENCHMARK_REAL_LARGE', false);
const maxDefaultRealTransferMb = numberEnv('PL_CHAT_BENCHMARK_MAX_DEFAULT_REAL_MB', 1024);
const strategy = String(process.env.PL_CHAT_BENCHMARK_STRATEGY || 'auto').toLowerCase();
const downloadMode = String(process.env.PL_CHAT_BENCHMARK_DOWNLOAD_MODE || 'server').toLowerCase();
const multipartConcurrencyOverride = numberEnv('PL_CHAT_BENCHMARK_MULTIPART_CONCURRENCY', 0);
const statePath = join(root, process.env.PL_CHAT_BENCHMARK_STATE_PATH || 'pl-chat-data/pl-chat-workspace.json');
const reportDir = join(root, 'docs', 'benchmarks');
const workDir = join(root, '.benchmark-data', `file-transfer-v2-${Date.now()}`);
const createdFileIds = [];
const createdMultipartUploadIds = [];
const measurements = [];
const capabilityChecks = [];
const startedAt = new Date();

let token = String(process.env.PL_CHAT_BENCHMARK_TOKEN || '');
let roomId = String(process.env.PL_CHAT_BENCHMARK_ROOM_ID || '');
let currentUser = null;
let health = null;
let transferCapabilities = null;
let errorMessage = null;

function numberEnv(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a valid number`);
  return value;
}

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function parseSizeList(value) {
  const values = String(value)
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
  if (!values.length) throw new Error('PL_CHAT_BENCHMARK_SIZES_MB must include at least one positive size.');
  return values;
}

const bytesFromMb = (value) => Math.floor(value * 1024 * 1024);
const mbFromBytes = (bytes) => Number((Number(bytes || 0) / 1024 / 1024).toFixed(2));
const throughput = (bytes, elapsedMs) => elapsedMs > 0 ? Number((mbFromBytes(bytes) / (elapsedMs / 1000)).toFixed(2)) : 0;
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function routeKind() {
  try {
    const url = new URL(baseUrl);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return 'localhost';
    if (url.hostname.endsWith('.trycloudflare.com')) return 'quick_tunnel';
    return url.protocol === 'https:' ? 'https_remote' : 'http_remote';
  } catch {
    return 'unknown';
  }
}

function recordCapability(name, pass, detail = {}) {
  const item = { name, pass: Boolean(pass), detail };
  capabilityChecks.push(item);
  console.log(`${item.pass ? 'PASS' : 'HOLD'} ${name}`);
  return item;
}

function transferCapabilitySummary(value = {}) {
  return {
    ok: Boolean(value.ok),
    service: value.service || '',
    appPublicUrl: value.appPublicUrl || '',
    uploadMaxMb: value.uploadMaxMb,
    directUploadMaxMb: value.directUploadMaxMb,
    fileUploadMode: value.fileUploadMode || value.mode || '',
    filePreviewMode: value.filePreviewMode || value.previewMode || '',
    enableChunkUpload: Boolean(value.enableChunkUpload),
    enableMultipartUpload: Boolean(value.enableMultipartUpload),
    enableResumableUpload: Boolean(value.enableResumableUpload),
    enablePersistentUploadQueue: Boolean(value.enablePersistentUploadQueue),
    enableSignedDirectDownload: Boolean(value.enableSignedDirectDownload),
    s3PublicTransferReady: Boolean(value.s3PublicTransferReady),
    enableDesktopParallelDownload: Boolean(value.enableDesktopParallelDownload),
    signedDownloadExpiresMinutes: value.signedDownloadExpiresMinutes,
    chunkSizeMb: value.chunkSizeMb,
    chunkSizeBytes: value.chunkSizeBytes,
    multipartMinFileSizeMb: value.multipartMinFileSizeMb,
    multipartThresholdBytes: value.multipartThresholdBytes,
    multipartDefaultPartSizeMb: value.multipartDefaultPartSizeMb,
    multipartMinPartSizeMb: value.multipartMinPartSizeMb,
    multipartMaxPartSizeMb: value.multipartMaxPartSizeMb,
    maxMultipartUploadMb: value.maxMultipartUploadMb,
    uploadQueueConcurrency: value.uploadQueueConcurrency,
    uploadRetryLimit: value.uploadRetryLimit,
    chunkUploadExpiresHours: value.chunkUploadExpiresHours,
    repository: value.repository ? {
      mode: value.repository.mode,
      enabled: Boolean(value.repository.enabled),
      connected: Boolean(value.repository.connected),
      source: value.repository.source || '',
      reason: value.repository.reason || ''
    } : undefined
  };
}

async function readWorkspaceState(retries = 5) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return JSON.parse(await readFile(statePath, 'utf8'));
    } catch (error) {
      lastError = error;
      if (attempt < retries) await delay(attempt * 150);
    }
  }
  throw lastError;
}

async function api(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !(body instanceof Uint8Array) && !Buffer.isBuffer(body)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...headers
    },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body)
  });
  const contentType = response.headers.get('content-type') || '';
  const value = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const error = new Error(value?.error || value?.message || `${response.status} ${response.statusText}`);
    error.status = response.status;
    error.value = value;
    throw error;
  }
  return { response, value };
}

async function createSparseFile(path, bytes) {
  const handle = await open(path, 'w');
  try {
    await handle.truncate(bytes);
  } finally {
    await handle.close();
  }
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function timed(label, bytes, fn, metadata = {}) {
  const memoryBefore = process.memoryUsage();
  const started = performance.now();
  const value = await fn();
  const elapsedMs = Number((performance.now() - started).toFixed(2));
  const item = {
    label,
    route: routeKind(),
    baseUrl,
    strategy,
    bytes,
    sizeMb: mbFromBytes(bytes),
    elapsedMs,
    throughputMbPerSecond: throughput(bytes, elapsedMs),
    clientRssDeltaMb: mbFromBytes(process.memoryUsage().rss - memoryBefore.rss),
    ...metadata
  };
  measurements.push(item);
  const sourceSuffix = item.sourceSizeMb && item.sourceSizeMb !== item.sizeMb
    ? ` from ${item.sourceSizeMb} MB file`
    : '';
  console.log(`${label}: ${item.sizeMb} MB${sourceSuffix} in ${elapsedMs} ms (${item.throughputMbPerSecond} MB/s)`);
  return { value, measurement: item };
}

async function prepareContext() {
  health = (await timed('health-check', 0, async () => {
    const response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: baseUrl } });
    if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
    return response.json();
  }, { phase: 'preflight' })).value;

  if (!token) {
    const state = await readWorkspaceState();
    const active = (state.sessions || [])
      .filter((session) => session?.token && !session.revokedAt && new Date(session.expiresAt || 0).getTime() > Date.now())
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0];
    if (!active) throw new Error('No active PL CHAT session found. Log in once or set PL_CHAT_BENCHMARK_TOKEN.');
    token = active.token;
  }

  currentUser = (await api('/api/me')).value.user || (await api('/api/me')).value;
  const authenticatedHealth = (await api('/api/health', { headers: { Origin: baseUrl } })).value;
  const fileSettings = (await api('/api/files?limit=1', { headers: { Origin: baseUrl } })).value;
  transferCapabilities = {
    ...transferCapabilitySummary(authenticatedHealth),
    ...transferCapabilitySummary(fileSettings),
    unauthenticatedHealth: health
  };
  health = transferCapabilities;
  if (!roomId) {
    const roomsValue = (await api('/api/rooms')).value;
    const rooms = roomsValue?.rooms || roomsValue || [];
    const room = rooms.find((item) => !item.archivedAt && !item.deletedAt) || rooms[0];
    if (!room?.id) throw new Error('No accessible PL CHAT room found for benchmark uploads.');
    roomId = room.id;
  }

  recordCapability('benchmark route classified', true, { route: routeKind(), baseUrl });
  recordCapability('health endpoint reachable', Boolean(health), health || {});
  recordCapability('runtime origin benchmark target', !/your-real-domain\.com/i.test(baseUrl), { baseUrl });
  recordCapability('MinIO/S3 public transfer capability detected', Boolean(health?.s3PublicTransferReady), {
    s3PublicTransferReady: Boolean(health?.s3PublicTransferReady),
    enableMultipartUpload: Boolean(health?.enableMultipartUpload),
    enableSignedDirectDownload: Boolean(health?.enableSignedDirectDownload),
    maxMultipartUploadMb: health?.maxMultipartUploadMb,
    multipartMinFileSizeMb: health?.multipartMinFileSizeMb,
    bucketIsPrivateExpected: true
  });
}

async function directUpload(path) {
  const info = await stat(path);
  const response = await fetch(
    `${baseUrl}/api/uploads/binary?name=${encodeURIComponent(basename(path))}&roomId=${encodeURIComponent(roomId)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(info.size),
        Origin: baseUrl
      },
      body: createReadStream(path),
      duplex: 'half'
    }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || body?.message || `Direct upload failed: ${response.status}`);
  const attachment = body.attachment || body.file;
  if (!attachment?.id) throw new Error('Direct upload did not return a file id');
  createdFileIds.push(attachment.id);
  return attachment;
}

async function chunkUpload(path) {
  const info = await stat(path);
  const upload = (await api('/api/uploads/chunk/init', {
    method: 'POST',
    body: { name: basename(path), mimeType: 'application/octet-stream', size: info.size, roomId },
    headers: { Origin: baseUrl }
  })).value.upload;

  const handle = await open(path, 'r');
  try {
    for (let index = 0; index < upload.totalParts; index += 1) {
      const start = index * upload.chunkSize;
      const length = Math.min(upload.chunkSize, info.size - start);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      await api(`/api/uploads/chunk/${upload.uploadId}/part?index=${index}`, {
        method: 'POST',
        body: buffer.subarray(0, bytesRead),
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(bytesRead),
          Origin: baseUrl
        }
      });
    }
  } catch (error) {
    await api(`/api/uploads/chunk/${upload.uploadId}/cancel`, { method: 'POST', body: {}, headers: { Origin: baseUrl } }).catch(() => {});
    throw error;
  } finally {
    await handle.close();
  }

  const completed = await api(`/api/uploads/chunk/${upload.uploadId}/complete`, {
    method: 'POST',
    body: {},
    headers: { Origin: baseUrl }
  });
  const attachment = completed.value.attachment || completed.value.file;
  if (!attachment?.id) throw new Error('Chunk upload did not return a file id');
  createdFileIds.push(attachment.id);
  return attachment;
}

async function multipartInit(sizeMb) {
  const upload = (await api('/api/uploads/multipart/init', {
    method: 'POST',
    body: {
      name: `benchmark-v2-${sizeMb}mb.bin`,
      mimeType: 'application/octet-stream',
      size: bytesFromMb(sizeMb),
      roomId
    },
    headers: { Origin: baseUrl }
  })).value.upload;
  if (upload?.uploadId) createdMultipartUploadIds.push(upload.uploadId);
  return upload;
}

async function multipartPartUrl(uploadId, partNumber = 1) {
  return (await api(`/api/uploads/multipart/${encodeURIComponent(uploadId)}/part-url`, {
    method: 'POST',
    body: { partNumber },
    headers: { Origin: baseUrl }
  })).value.part;
}

async function uploadSignedPart(path, upload, partNumber) {
  const part = await multipartPartUrl(upload.uploadId, partNumber);
  if (!/^https?:\/\//i.test(part?.url || '')) throw new Error(`Signed part URL missing for part ${partNumber}`);
  const signedOrigin = new URL(part.url).origin;
  if (partNumber === 1) {
    recordCapability('signed MinIO upload URL issued', true, {
      origin: signedOrigin,
      expiresAt: part.expiresAt || '',
      urlRedacted: true
    });
  }
  const start = (partNumber - 1) * upload.partSizeBytes;
  const end = Math.min(start + upload.partSizeBytes, upload.size) - 1;
  const contentLength = end - start + 1;
  let response;
  try {
    response = await fetch(part.url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(contentLength)
      },
      body: createReadStream(path, { start, end }),
      duplex: 'half'
    });
  } catch (error) {
    throw new Error(`Signed MinIO part upload could not reach ${signedOrigin}: ${error.cause?.message || error.message}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Signed part upload failed: part=${partNumber} status=${response.status} ${text.slice(0, 160)}`);
  }
  const etag = response.headers.get('etag');
  if (!etag) throw new Error(`Signed part upload did not return ETag for part ${partNumber}`);
  await api(`/api/uploads/multipart/${encodeURIComponent(upload.uploadId)}/part-complete`, {
    method: 'POST',
    body: { partNumber, etag },
    headers: { Origin: baseUrl }
  });
  return { partNumber, etag };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function multipartUpload(path) {
  const info = await stat(path);
  const upload = await multipartInit(mbFromBytes(info.size));
  const concurrency = Math.max(1, Math.floor(
    multipartConcurrencyOverride
      || upload.concurrency
      || health?.uploadQueueConcurrency
      || 3
  ));
  recordCapability('multipart upload concurrency selected', true, {
    concurrency,
    serverRecommendedConcurrency: upload.concurrency || null,
    serverFallbackConcurrency: upload.concurrencyFallback || [],
    route: upload.concurrencyRoute || health?.multipartUploadConcurrencyRoute || routeKind(),
    reason: upload.concurrencyReason || health?.multipartUploadConcurrencyReason || 'benchmark_override_or_default',
    override: multipartConcurrencyOverride || null
  });
  try {
    const partNumbers = Array.from({ length: upload.totalParts }, (_, index) => index + 1);
    const parts = await mapWithConcurrency(partNumbers, concurrency, (partNumber) => uploadSignedPart(path, upload, partNumber));
    const completed = await api(`/api/uploads/multipart/${encodeURIComponent(upload.uploadId)}/complete`, {
      method: 'POST',
      body: { parts },
      headers: { Origin: baseUrl }
    });
    const attachment = completed.value.attachment || completed.value.file;
    if (!attachment?.id) throw new Error('Multipart upload did not return a file id');
    createdFileIds.push(attachment.id);
    const trackedIndex = createdMultipartUploadIds.indexOf(upload.uploadId);
    if (trackedIndex >= 0) createdMultipartUploadIds.splice(trackedIndex, 1);
    return attachment;
  } catch (error) {
    await api(`/api/uploads/multipart/${encodeURIComponent(upload.uploadId)}/cancel`, {
      method: 'POST',
      body: {},
      headers: { Origin: baseUrl }
    }).catch(() => {});
    throw error;
  }
}

async function serverDownload(fileId, destination, bytes, range = false) {
  const headers = { Authorization: `Bearer ${token}`, Origin: baseUrl };
  if (range) headers.Range = `bytes=0-${bytes - 1}`;
  const response = await fetch(`${baseUrl}/api/files/${fileId}/download`, { headers });
  const expected = range ? 206 : 200;
  if (response.status !== expected || !response.body) {
    throw new Error(`Server download failed: expected ${expected}, received ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(destination));
  return stat(destination);
}

async function signedDownload(fileId, destination, bytes = 0, range = false) {
  const signed = (await api(`/api/files/${fileId}/signed-download`, { headers: { Origin: baseUrl } })).value;
  if (!/^https:\/\//i.test(signed?.url || '')) throw new Error('Signed download did not return an HTTPS URL');
  const headers = {};
  if (range) headers.Range = `bytes=0-${bytes - 1}`;
  const response = await fetch(signed.url, { headers });
  const expected = range ? 206 : 200;
  if (response.status !== expected || !response.body) throw new Error(`Signed download failed: expected ${expected}, received ${response.status}`);
  await pipeline(response.body, createWriteStream(destination));
  return stat(destination);
}

function shouldTransfer(sizeMb) {
  return realLargeTransfer || sizeMb <= maxDefaultRealTransferMb;
}

function chooseUploadPath(sizeMb) {
  if (strategy === 'direct') return 'direct';
  if (strategy === 'chunk') return 'chunk';
  if (strategy === 'multipart') return 'multipart';
  const directMax = Number(health?.directUploadMaxMb || 100);
  const multipartReady = Boolean(health?.enableMultipartUpload || health?.s3PublicTransferReady);
  if (multipartReady && sizeMb >= Number(health?.multipartMinFileSizeMb || 100)) return 'multipart';
  if (sizeMb <= directMax) return 'direct';
  return 'chunk';
}

async function benchmarkSize(sizeMb, run) {
  const bytes = bytesFromMb(sizeMb);
  const uploadPath = chooseUploadPath(sizeMb);
  const canSendBytes = shouldTransfer(sizeMb);
  recordCapability(`size ${sizeMb} MB selected strategy`, true, { uploadPath, canSendBytes });

  if (!canSendBytes) {
    if (uploadPath === 'multipart') {
      const init = await timed(`multipart-init-${sizeMb}mb-run-${run}`, 0, () => multipartInit(sizeMb), {
        phase: 'capability',
        sizeMb,
        transport: 'multipart-init',
        measuredThroughput: false
      });
      if (init.value?.uploadId) {
        await timed(`multipart-part-url-${sizeMb}mb-run-${run}`, 0, () => multipartPartUrl(init.value.uploadId, 1), {
          phase: 'capability',
          sizeMb,
          transport: 'signed-upload-url',
          measuredThroughput: false
        });
      }
      return;
    }

    const upload = await timed(`chunk-init-${sizeMb}mb-run-${run}`, 0, () => api('/api/uploads/chunk/init', {
      method: 'POST',
      body: { name: `benchmark-v2-${sizeMb}mb.bin`, mimeType: 'application/octet-stream', size: bytes, roomId },
      headers: { Origin: baseUrl }
    }), {
      phase: 'capability',
      sizeMb,
      transport: 'chunk-init',
      measuredThroughput: false
    });
    const uploadId = upload.value?.value?.upload?.uploadId;
    if (uploadId) {
      await api(`/api/uploads/chunk/${uploadId}/cancel`, { method: 'POST', body: {}, headers: { Origin: baseUrl } }).catch(() => {});
    }
    return;
  }

  const path = join(workDir, `benchmark-v2-${sizeMb}mb-run-${run}.bin`);
  await createSparseFile(path, bytes);
  const originalHash = await hashFile(path);
  const upload = await timed(`${uploadPath}-upload-${sizeMb}mb-run-${run}`, bytes, () => {
    if (uploadPath === 'direct') return directUpload(path);
    if (uploadPath === 'chunk') return chunkUpload(path);
    if (uploadPath === 'multipart') return multipartUpload(path);
    throw new Error(`Unknown upload strategy: ${uploadPath}`);
  }, {
    phase: 'transfer',
    sizeMb,
    transport: uploadPath,
    measuredThroughput: true
  });

  const fullDownloadPath = join(workDir, `download-${sizeMb}mb-run-${run}.bin`);
  const downloadFn = downloadMode === 'signed'
    ? () => signedDownload(upload.value.id, fullDownloadPath)
    : () => serverDownload(upload.value.id, fullDownloadPath, bytes, false);
  await timed(`${downloadMode}-download-${sizeMb}mb-run-${run}`, bytes, downloadFn, {
    phase: 'transfer',
    sizeMb,
    transport: `${downloadMode}-download`,
    measuredThroughput: true
  });
  if ((await hashFile(fullDownloadPath)) !== originalHash) throw new Error(`Hash mismatch after ${sizeMb} MB download.`);

  const rangeBytes = Math.min(bytes, 16 * 1024 * 1024);
  const rangePath = join(workDir, `range-${sizeMb}mb-run-${run}.bin`);
  const rangeTransport = downloadMode === 'signed' ? 'signed-range-download' : 'server-range-download';
  const rangeFn = downloadMode === 'signed'
    ? () => signedDownload(upload.value.id, rangePath, rangeBytes, true)
    : () => serverDownload(upload.value.id, rangePath, rangeBytes, true);
  await timed(`range-download-${mbFromBytes(rangeBytes)}mb-of-${sizeMb}mb-run-${run}`, rangeBytes, rangeFn, {
    phase: 'transfer',
    sourceSizeMb: sizeMb,
    transport: rangeTransport,
    measuredThroughput: true,
    rangeBytes
  });
}

async function runBenchmark() {
  await mkdir(workDir, { recursive: true });
  await prepareContext();
  for (let run = 1; run <= runs; run += 1) {
    for (const sizeMb of sizeMbList) {
      await benchmarkSize(sizeMb, run);
    }
  }
}

async function cleanup() {
  for (const fileId of createdFileIds) {
    await api(`/api/files/${fileId}`, { method: 'DELETE', headers: { Origin: baseUrl } }).catch((error) => {
      console.warn(`Unable to clean benchmark file ${fileId}: ${error.message}`);
    });
  }
  for (const uploadId of createdMultipartUploadIds) {
    await api(`/api/uploads/multipart/${encodeURIComponent(uploadId)}/cancel`, {
      method: 'POST',
      body: {},
      headers: { Origin: baseUrl }
    }).catch(() => {});
  }
  await rm(workDir, { recursive: true, force: true });
}

function averages() {
  const measured = measurements.filter((item) => item.measuredThroughput);
  return Object.fromEntries(
    [...new Set(measured.map((item) => `${item.transport}:${item.sizeMb}`))].map((key) => {
      const matching = measured.filter((item) => `${item.transport}:${item.sizeMb}` === key);
      const [transport, sizeMb] = key.split(':');
      return [
        key,
        {
          transport,
          sizeMb: Number(sizeMb),
          runs: matching.length,
          averageMbPerSecond: Number((matching.reduce((sum, item) => sum + item.throughputMbPerSecond, 0) / matching.length).toFixed(2))
        }
      ];
    })
  );
}

async function writeReports() {
  await mkdir(reportDir, { recursive: true });
  const timestamp = startedAt.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
  const report = {
    title: 'PL CHAT File Transfer Benchmark V2',
    status: errorMessage ? 'failed' : 'passed',
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    route: routeKind(),
    baseUrl,
    user: currentUser ? { id: currentUser.id, name: currentUser.displayName || currentUser.name } : null,
    roomId,
    configuration: {
      sizesMb: sizeMbList,
      runs,
      strategy,
      downloadMode,
      realLargeTransfer,
      maxDefaultRealTransferMb,
      server: health || null
    },
    capabilityChecks,
    averages: averages(),
    measurements,
    cleanup: {
      uploadedBenchmarkFiles: createdFileIds.length,
      multipartSessionsCancelled: createdMultipartUploadIds.length,
      localTemporaryFilesRemoved: true
    },
    warning: realLargeTransfer
      ? null
      : `Transfers larger than ${maxDefaultRealTransferMb} MB are capability checks only unless PL_CHAT_BENCHMARK_REAL_LARGE=true.`,
    error: errorMessage
  };
  const jsonPath = join(reportDir, `file-transfer-v2-${timestamp}.json`);
  const markdownPath = join(reportDir, `file-transfer-v2-${timestamp}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const measuredRows = measurements
    .map((item) => `| ${item.label} | ${item.route} | ${item.transport || ''} | ${item.sourceSizeMb || item.sizeMb} | ${item.sizeMb} | ${item.elapsedMs} | ${item.measuredThroughput ? item.throughputMbPerSecond : 'n/a'} | ${item.measuredThroughput ? 'yes' : 'no'} |`)
    .join('\n');
  const averageRows = Object.values(report.averages)
    .map((item) => `| ${item.transport} | ${item.sizeMb} | ${item.runs} | ${item.averageMbPerSecond} |`)
    .join('\n');
  const capabilityRows = capabilityChecks
    .map((item) => `| ${item.name} | ${item.pass ? 'PASS' : 'HOLD'} | ${JSON.stringify(item.detail).replaceAll('|', '/')} |`)
    .join('\n');

  await writeFile(
    markdownPath,
    `# PL CHAT File Transfer Benchmark V2

- Status: **${report.status}**
- Route: **${report.route}**
- URL: \`${baseUrl}\`
- Sizes: ${sizeMbList.join(', ')} MB
- Runs: ${runs}
- Strategy: ${strategy}
- Download mode: ${downloadMode}
- Real large transfer enabled: ${realLargeTransfer ? 'yes' : 'no'}

${report.warning ? `> ${report.warning}\n` : ''}

## Capability Checks

| Check | Result | Detail |
| --- | --- | --- |
${capabilityRows || '| No checks | HOLD | {} |'}

## Average Throughput

| Transport | Size (MB) | Runs | Average MB/s |
| --- | ---: | ---: | ---: |
${averageRows || '| No measured transfers | 0 | 0 | 0 |'}

## Measurements

| Test | Route | Transport | Source Size (MB) | Measured Size (MB) | Time (ms) | Throughput (MB/s) | Counts As Throughput |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
${measuredRows || '| No measurements | ${report.route} | none | 0 | 0 | 0 | n/a | no |'}

## Cleanup

- Benchmark uploads requested for soft deletion: ${createdFileIds.length}
- Multipart sessions cancelled: ${createdMultipartUploadIds.length}
- Temporary local files removed: yes

## Rule

Only rows marked "Counts As Throughput = yes" may be used as before/after speed evidence.

${errorMessage ? `## Error\n\n\`${errorMessage}\`\n` : ''}
`,
    'utf8'
  );
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);
}

try {
  await runBenchmark();
} catch (error) {
  errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`Benchmark V2 failed: ${errorMessage}`);
  process.exitCode = 1;
} finally {
  await cleanup().catch((error) => {
    errorMessage ||= `Cleanup failed: ${error.message}`;
    process.exitCode = 1;
  });
  await writeReports();
}
