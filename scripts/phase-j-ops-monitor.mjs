import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, statfs, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = new Set(process.argv.slice(2));
const jsonOnly = args.has('--json');
const now = new Date();

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [name, ...rest] = trimmed.split('=');
    values[name.trim()] = rest.join('=').trim().replace(/^"|"$/g, '');
  }
  return values;
}

async function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

function ageMinutes(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.round(((Date.now() - time) / 60000) * 10) / 10;
}

function bytesToGb(bytes) {
  return Math.round((Number(bytes || 0) / 1024 / 1024 / 1024) * 100) / 100;
}

async function diskSummary(path) {
  try {
    const stats = await statfs(path);
    const total = Number(stats.blocks) * Number(stats.bsize);
    const free = Number(stats.bavail) * Number(stats.bsize);
    const used = Math.max(0, total - free);
    return {
      path,
      totalGb: bytesToGb(total),
      freeGb: bytesToGb(free),
      usedGb: bytesToGb(used),
      usedPercent: total ? Math.round((used / total) * 10000) / 100 : null
    };
  } catch (error) {
    return { path, error: error.message };
  }
}

async function httpCheck(url) {
  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}phaseJ=${crypto.randomUUID()}`, {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      signal: AbortSignal.timeout(5000)
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
    return {
      ok: response.ok,
      status: response.status,
      headers: {
        accessControlAllowOrigin: response.headers.get('access-control-allow-origin') || '',
        xFrameOptions: response.headers.get('x-frame-options') || '',
        referrerPolicy: response.headers.get('referrer-policy') || '',
        permissionsPolicy: response.headers.get('permissions-policy') || '',
        crossOriginResourcePolicy: response.headers.get('cross-origin-resource-policy') || ''
      },
      body
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function taskStatus(name) {
  try {
    const { stdout } = await execFileAsync('schtasks.exe', ['/Query', '/TN', name, '/FO', 'LIST'], { windowsHide: true });
    return { exists: true, raw: stdout };
  } catch (error) {
    return { exists: false, error: String(error.stderr || error.message || error) };
  }
}

async function listenerStatus(port) {
  try {
    const { stdout } = await execFileAsync('netstat.exe', ['-ano'], { windowsHide: true });
    const line = stdout.split(/\r?\n/).find((item) => item.includes(`:${port}`) && item.includes('LISTENING'));
    if (!line) return { listening: false };
    const parts = line.trim().split(/\s+/);
    return { listening: true, raw: line.trim(), pid: parts[parts.length - 1] };
  } catch (error) {
    return { listening: false, error: error.message };
  }
}

async function activeLocalUploadGap(dataDir) {
  const workspacePath = join(dataDir, 'pl-chat-workspace.json');
  const state = await readJsonIfExists(workspacePath);
  if (!state) return { readable: false, missing: null };
  const uploads = Array.isArray(state.uploads) ? state.uploads : [];
  const missing = [];
  for (const upload of uploads) {
    if (upload.deletedAt || (upload.storageDriver || 'local') !== 'local') continue;
    const key = upload.storageKey || String(upload.url || '').split('/').pop();
    if (!key) continue;
    const file = join(dataDir, 'uploads', key);
    if (!existsSync(file)) missing.push({ id: upload.id, key, bytes: Number(upload.size || 0) });
  }
  return {
    readable: true,
    activeLocalUploads: uploads.filter((item) => !item.deletedAt && (item.storageDriver || 'local') === 'local').length,
    missing: missing.length,
    missingBytesGb: bytesToGb(missing.reduce((sum, item) => sum + item.bytes, 0))
  };
}

function renderMarkdown(report) {
  const checks = report.checks;
  return [
    '# Phase J Ops Monitor Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: ${report.gate.status}`,
    '',
    '## Health',
    '',
    `- PL CHAT HTTP: ${checks.plChat.ok ? `PASS (${checks.plChat.status})` : 'FAIL'}`,
    `- MinIO HTTP: ${checks.minio.ok ? `PASS (${checks.minio.status})` : 'FAIL'}`,
    `- Live Phase I headers active: ${checks.phaseILiveActive ? 'PASS' : 'HOLD'}`,
    `- Active local upload gap: ${checks.uploadGap.missing === 0 ? 'PASS' : 'FAIL'} (${checks.uploadGap.missing ?? 'unknown'} missing)`,
    '',
    '## Gates',
    '',
    `- Phase G storage safety latest: ${checks.phaseG?.ok ? 'PASS' : 'HOLD'} (${checks.phaseG?.ageMinutes ?? 'n/a'} min old)`,
    `- Phase H backup latest: ${checks.phaseH?.ok ? 'PASS' : 'HOLD'} (${checks.phaseH?.ageMinutes ?? 'n/a'} min old)`,
    `- Phase I security source/audit: ${checks.phaseI?.ok ? 'PASS' : 'HOLD'} (${checks.phaseI?.ageMinutes ?? 'n/a'} min old)`,
    '',
    '## Scheduled Tasks',
    '',
    `- Phase G storage safety: ${checks.tasks.phaseG.exists ? 'installed' : 'not detected'}`,
    `- Phase H backup DR: ${checks.tasks.phaseH.exists ? 'installed' : 'not detected'}`,
    `- Phase J ops monitor: ${checks.tasks.phaseJ.exists ? 'installed' : 'not detected'}`,
    '',
    '## Disk',
    '',
    `- Project/data disk used: ${checks.disk.usedPercent ?? 'n/a'}%`,
    `- Free: ${checks.disk.freeGb ?? 'n/a'} GB`,
    '',
    '## Attention',
    '',
    report.attention.length
      ? report.attention.map((item) => `- ${item.level.toUpperCase()}: ${item.message}`).join('\n')
      : '- No current attention items.',
    '',
    '## Notes',
    '',
    '- This monitor intentionally reports operational status only and does not print secret values.',
    checks.phaseILiveActive
      ? '- Live Phase I hardening is active on `/api/health`.'
      : '- Live Phase I remains HOLD until the old PL CHAT process is restarted and the hardened headers are visible on `/api/health`.',
    '- Phase H is considered local-DR ready, but off-device backup is still a separate requirement.'
  ].join('\n');
}

async function main() {
  const envPath = join(root, '.env.production');
  const env = existsSync(envPath) ? parseEnv(await readFile(envPath, 'utf8')) : {};
  const dataDir = resolve(root, env.PL_CHAT_DATA_DIR || 'pl-chat-data');
  const reportDir = join(dataDir, 'ops-monitoring');

  const plChat = await httpCheck(`http://127.0.0.1:${env.PL_CHAT_PORT || 8788}/api/health`);
  const minio = await httpCheck('http://127.0.0.1:9000/minio/health/live');
  const phaseG = await readJsonIfExists(join(dataDir, 'storage-safety', 'latest.json'));
  const phaseH = await readJsonIfExists(join(dataDir, 'backup-dr', 'latest-backup.json'));
  const phaseI = await readJsonIfExists(join(dataDir, 'security-hardening', 'latest.json'));
  const uploadGap = await activeLocalUploadGap(dataDir);
  const listener = await listenerStatus(env.PL_CHAT_PORT || 8788);
  const disk = await diskSummary(dataDir);
  const tasks = {
    phaseG: await taskStatus('PL CHAT Phase G Storage Safety'),
    phaseH: await taskStatus('PL CHAT Phase H Backup DR'),
    phaseJ: await taskStatus('PL CHAT Phase J Ops Monitor')
  };

  const phaseILiveActive = Boolean(
    plChat.headers?.xFrameOptions &&
    plChat.headers?.referrerPolicy &&
    plChat.headers?.accessControlAllowOrigin &&
    !String(plChat.headers.accessControlAllowOrigin).includes('*') &&
    plChat.body &&
    typeof plChat.body === 'object' &&
    !('urls' in plChat.body)
  );

  const checks = {
    plChat,
    minio,
    listener,
    disk,
    uploadGap,
    phaseILiveActive,
    phaseG: phaseG ? { ok: Boolean(phaseG.ok || phaseG.gate?.diskNotCritical), ageMinutes: ageMinutes(phaseG.generatedAt) } : null,
    phaseH: phaseH ? { ok: Boolean(phaseH.gate?.pass), ageMinutes: ageMinutes(phaseH.createdAt || phaseH.generatedAt) } : null,
    phaseI: phaseI ? { ok: Boolean(phaseI.gate?.pass), ageMinutes: ageMinutes(phaseI.generatedAt) } : null,
    tasks
  };

  const attention = [];
  if (!plChat.ok) attention.push({ level: 'critical', message: 'PL CHAT health check is failing.' });
  if (!minio.ok) attention.push({ level: 'critical', message: 'MinIO health check is failing.' });
  if (!phaseILiveActive) attention.push({ level: 'high', message: 'Phase I hardening is present in source but not active in the live PL CHAT process.' });
  if (uploadGap.missing !== 0) attention.push({ level: 'high', message: `Active local upload gap detected: ${uploadGap.missing} missing file(s).` });
  if (!checks.phaseH?.ok) attention.push({ level: 'high', message: 'Latest Phase H backup gate is missing or not passing.' });
  if (!tasks.phaseH.exists) attention.push({ level: 'medium', message: 'Phase H scheduled backup task is not detected.' });
  if (!tasks.phaseJ.exists) attention.push({ level: 'medium', message: 'Phase J scheduled ops monitor task is not detected.' });
  if (Number(disk.usedPercent || 0) >= 85) attention.push({ level: 'medium', message: `Disk usage is ${disk.usedPercent}%.` });

  const critical = attention.some((item) => item.level === 'critical');
  const high = attention.some((item) => item.level === 'high');
  const gate = {
    status: critical ? 'FAIL' : high ? 'HOLD' : attention.length ? 'PASS_WITH_NOTES' : 'PASS',
    pass: !critical && !high,
    critical,
    high
  };

  const report = {
    phase: 'J',
    generatedAt: now.toISOString(),
    checks,
    attention,
    gate
  };

  await mkdir(reportDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  await writeFile(join(reportDir, `phase-j-ops-monitor-${stamp}.json`), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(join(reportDir, 'latest.json'), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(join(reportDir, 'latest.md'), renderMarkdown(report), 'utf8');

  if (jsonOnly) console.log(JSON.stringify(report, null, 2));
  else console.log(renderMarkdown(report));
  process.exitCode = critical ? 2 : high ? 1 : 0;
}

main().catch((error) => {
  console.error(`Phase J ops monitor failed: ${error.message}`);
  process.exitCode = 3;
});
