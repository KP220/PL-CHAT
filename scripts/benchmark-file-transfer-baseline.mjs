import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const baseUrl = process.env.PL_CHAT_BENCHMARK_URL || 'http://localhost:8788';
const directMb = positiveNumber('PL_CHAT_BENCHMARK_DIRECT_MB', 8);
const chunkMb = positiveNumber('PL_CHAT_BENCHMARK_CHUNK_MB', 128);
const rangeMb = positiveNumber('PL_CHAT_BENCHMARK_RANGE_MB', 8);
const runs = Math.max(1, Math.floor(positiveNumber('PL_CHAT_BENCHMARK_RUNS', 1)));
const statePath = join(root, 'pl-chat-data', 'pl-chat-workspace.json');
const reportDir = join(root, 'docs', 'benchmarks');
const workDir = join(root, '.benchmark-data', `file-transfer-${Date.now()}`);
const createdFileIds = [];
const results = [];
const startedAt = new Date();
let token;
let roomId;
let currentUser;
let health;
let errorMessage = null;

function positiveNumber(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

const bytesFromMb = (value) => Math.floor(value * 1024 * 1024);
const formatMb = (bytes) => Number((bytes / 1024 / 1024).toFixed(2));
const speedMbps = (bytes, elapsedMs) => Number((formatMb(bytes) / (elapsedMs / 1000)).toFixed(2));
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

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
  const value = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(value?.error || value?.message || `${response.status} ${response.statusText}`);
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

async function measure(label, bytes, operation, metadata = {}) {
  const memoryBefore = process.memoryUsage();
  const start = performance.now();
  const value = await operation();
  const elapsedMs = Number((performance.now() - start).toFixed(2));
  const result = {
    label,
    bytes,
    sizeMb: formatMb(bytes),
    elapsedMs,
    throughputMbPerSecond: speedMbps(bytes, elapsedMs),
    clientRssDeltaMb: formatMb(process.memoryUsage().rss - memoryBefore.rss),
    ...metadata
  };
  results.push(result);
  console.log(`${label}: ${result.sizeMb} MB in ${elapsedMs} ms (${result.throughputMbPerSecond} MB/s)`);
  return { value, result };
}

async function prepareContext() {
  health = (
    await measure('health-check', 0, async () => {
      const response = await fetch(`${baseUrl}/api/health`);
      if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
      return response.json();
    })
  ).value;
  const state = await readWorkspaceState();
  const active = (state.sessions || [])
    .filter((session) => session?.token && !session.revokedAt)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0];
  if (!active) throw new Error('ไม่พบบัญชีที่เข้าสู่ระบบอยู่ กรุณาเข้าสู่ระบบ PL CHAT ก่อนรัน Benchmark');
  token = active.token;
  currentUser = (await api('/api/me')).value;
  const roomsValue = (await api('/api/rooms')).value;
  const rooms = roomsValue?.rooms || roomsValue || [];
  const room = rooms.find((item) => !item.archivedAt) || rooms[0];
  if (!room?.id) throw new Error('ไม่พบห้องแชทที่บัญชีนี้เข้าถึงได้');
  roomId = room.id;
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
        'Content-Length': String(info.size)
      },
      body: createReadStream(path),
      duplex: 'half'
    }
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || body?.message || `Direct upload failed: ${response.status}`);
  const attachment = body.attachment || body.file;
  if (!attachment?.id) throw new Error('Direct upload did not return a file id');
  createdFileIds.push(attachment.id);
  return attachment;
}

async function chunkUpload(path) {
  const info = await stat(path);
  const upload = (
    await api('/api/uploads/chunk/init', {
      method: 'POST',
      body: { name: basename(path), mimeType: 'application/octet-stream', size: info.size, roomId }
    })
  ).value.upload;
  const handle = await open(path, 'r');
  try {
    for (let index = 0; index < upload.totalParts; index += 1) {
      const start = index * upload.chunkSize;
      const length = Math.min(upload.chunkSize, info.size - start);
      const buffer = Buffer.allocUnsafe(length);
      await handle.read(buffer, 0, length, start);
      await api(`/api/uploads/chunk/${upload.uploadId}/part?index=${index}`, {
        method: 'POST',
        body: buffer,
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(length) }
      });
    }
  } catch (error) {
    await api(`/api/uploads/chunk/${upload.uploadId}/cancel`, { method: 'POST', body: {} }).catch(() => {});
    throw error;
  } finally {
    await handle.close();
  }
  const completed = await api(`/api/uploads/chunk/${upload.uploadId}/complete`, { method: 'POST', body: {} });
  const attachment = completed.value.attachment || completed.value.file;
  if (!attachment?.id) throw new Error('Chunk upload did not return a file id');
  createdFileIds.push(attachment.id);
  return attachment;
}

async function download(fileId, destination, rangeBytes) {
  const headers = { Authorization: `Bearer ${token}` };
  if (rangeBytes) headers.Range = `bytes=0-${rangeBytes - 1}`;
  const response = await fetch(`${baseUrl}/api/files/${fileId}/download`, { headers });
  const expectedStatus = rangeBytes ? 206 : 200;
  if (response.status !== expectedStatus || !response.body) {
    throw new Error(`Download failed: expected ${expectedStatus}, received ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(destination));
  return stat(destination);
}

async function runBenchmark() {
  await mkdir(workDir, { recursive: true });
  await prepareContext();
  const directPath = join(workDir, `direct-${directMb}mb.bin`);
  const chunkPath = join(workDir, `chunk-${chunkMb}mb.bin`);
  await createSparseFile(directPath, bytesFromMb(directMb));
  await createSparseFile(chunkPath, bytesFromMb(chunkMb));
  const directHash = await hashFile(directPath);

  for (let run = 1; run <= runs; run += 1) {
    const direct = await measure(`direct-upload-run-${run}`, bytesFromMb(directMb), () => directUpload(directPath), {
      transport: 'direct'
    });
    const directDownloadPath = join(workDir, `direct-download-${run}.bin`);
    await measure(`full-download-run-${run}`, bytesFromMb(directMb), () => download(direct.value.id, directDownloadPath), {
      transport: 'download'
    });
    if ((await hashFile(directDownloadPath)) !== directHash) throw new Error('Full download hash mismatch');

    const chunked = await measure(`chunk-upload-run-${run}`, bytesFromMb(chunkMb), () => chunkUpload(chunkPath), {
      transport: 'chunked',
      chunkSizeMb: health?.chunkSizeMb
    });
    const rangeBytes = Math.min(bytesFromMb(rangeMb), bytesFromMb(chunkMb));
    const range = await measure(
      `range-download-run-${run}`,
      rangeBytes,
      () => download(chunked.value.id, join(workDir, `range-download-${run}.bin`), rangeBytes),
      { transport: 'range' }
    );
    if (range.value.size !== rangeBytes) throw new Error('Range download size mismatch');
  }
}

async function cleanup() {
  for (const fileId of createdFileIds) {
    await api(`/api/files/${fileId}`, { method: 'DELETE' }).catch((error) =>
      console.warn(`Unable to clean benchmark file ${fileId}: ${error.message}`)
    );
  }
  await rm(workDir, { recursive: true, force: true });
}

function averages() {
  return Object.fromEntries(
    [...new Set(results.map((item) => item.transport).filter(Boolean))].map((transport) => {
      const matching = results.filter((item) => item.transport === transport);
      return [
        transport,
        {
          runs: matching.length,
          averageMbPerSecond: Number(
            (matching.reduce((sum, item) => sum + item.throughputMbPerSecond, 0) / matching.length).toFixed(2)
          )
        }
      ];
    })
  );
}

async function writeReports() {
  await mkdir(reportDir, { recursive: true });
  const timestamp = startedAt.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
  const report = {
    title: 'PL CHAT File Transfer Benchmark Baseline',
    status: errorMessage ? 'failed' : 'passed',
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    scope: 'Local loopback baseline only; no chat messages created and no user files modified.',
    baseUrl,
    user: currentUser ? { id: currentUser.id, name: currentUser.displayName || currentUser.name } : null,
    roomId,
    configuration: {
      directMb,
      chunkMb,
      rangeMb,
      runs,
      serverChunkSizeMb: health?.chunkSizeMb,
      serverUploadMaxMb: health?.uploadMaxMb,
      serverDirectUploadMaxMb: health?.directUploadMaxMb
    },
    averages: averages(),
    results,
    cleanup: {
      uploadedBenchmarkFiles: createdFileIds.length,
      requestedSoftDeleteForAll: true,
      localTemporaryFilesRemoved: true
    },
    error: errorMessage
  };
  const jsonPath = join(reportDir, `file-transfer-baseline-${timestamp}.json`);
  const markdownPath = join(reportDir, `file-transfer-baseline-${timestamp}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const rows = results
    .map((item) => `| ${item.label} | ${item.sizeMb} | ${item.elapsedMs} | ${item.throughputMbPerSecond} |`)
    .join('\n');
  const averageRows = Object.entries(report.averages)
    .map(([transport, value]) => `- ${transport}: ${value.averageMbPerSecond} MB/s (${value.runs} run)`)
    .join('\n');
  await writeFile(
    markdownPath,
    `# PL CHAT File Transfer Benchmark Baseline

- Status: **${report.status}**
- URL: \`${baseUrl}\`
- Scope: Local loopback baseline only
- Direct upload sample: ${directMb} MB
- Chunk upload sample: ${chunkMb} MB
- Range download sample: ${rangeMb} MB
- Chat messages created: 0
- User files modified: 0

## Average Throughput

${averageRows || '- No completed measurements'}

## Measurements

| Test | Size (MB) | Time (ms) | Throughput (MB/s) |
| --- | ---: | ---: | ---: |
${rows || '| No completed measurements | 0 | 0 | 0 |'}

## Cleanup

- Benchmark uploads requested for soft deletion: ${createdFileIds.length}
- Temporary local files removed: yes

## Limitation

This is a baseline on the same computer through localhost. It does not represent external internet speed or prove 10-20 GB transfer stability.

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
  console.error(`Benchmark failed: ${errorMessage}`);
  process.exitCode = 1;
} finally {
  await cleanup().catch((error) => {
    errorMessage ||= `Cleanup failed: ${error.message}`;
    process.exitCode = 1;
  });
  await writeReports();
}
