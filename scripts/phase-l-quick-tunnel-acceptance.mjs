import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const statusPath = join(root, 'pl-chat-data', 'tunnels', 'quick-tunnel-status.json');
const reportDir = join(root, 'pl-chat-data', 'quick-tunnel-acceptance');
const args = new Set(process.argv.slice(2));
const jsonOnly = args.has('--json');

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function check(name, pass, level, detail) {
  return { name, pass: Boolean(pass), level, detail };
}

async function fetchWithTimeout(url, options = {}, ms = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readTunnelStatus() {
  if (!existsSync(statusPath)) return {};
  return JSON.parse((await readFile(statusPath, 'utf8')).replace(/^\uFEFF/, ''));
}

async function main() {
  const status = await readTunnelStatus();
  const appUrl = normalizeUrl(process.env.PL_CHAT_TUNNEL_URL || status.appUrl);
  const minioUrl = normalizeUrl(process.env.PL_CHAT_MINIO_TUNNEL_URL || status.minioTransferUrl);
  const checks = [];

  checks.push(check(
    'Quick Tunnel status exists',
    Boolean(appUrl && minioUrl),
    'critical',
    'Requires current appUrl and minioTransferUrl from quick-tunnel-status.json or environment.'
  ));

  if (appUrl) {
    const health = await fetchWithTimeout(`${appUrl}/api/health`, {
      headers: { Origin: appUrl }
    }).catch((error) => ({ error }));
    const cors = health?.headers?.get?.('access-control-allow-origin') || '';
    checks.push(check('App tunnel health HTTP 200', health.status === 200, 'critical', `status=${health.status || health.error?.message || 'none'}`));
    checks.push(check('CORS reflects current app tunnel origin', cors === appUrl, 'critical', `access-control-allow-origin=${cors || 'missing'}`));
    checks.push(check('Security header X-Frame-Options active', health?.headers?.get?.('x-frame-options') === 'DENY', 'high', 'Must be checked through tunnel.'));
    checks.push(check('HTTPS tunnel origin', appUrl.startsWith('https://'), 'critical', appUrl));
  }

  if (minioUrl) {
    const minio = await fetchWithTimeout(`${minioUrl}/minio/health/live`).catch((error) => ({ error }));
    checks.push(check('MinIO transfer tunnel health HTTP 200', minio.status === 200, 'critical', `status=${minio.status || minio.error?.message || 'none'}`));
    checks.push(check('MinIO transfer tunnel is HTTPS', minioUrl.startsWith('https://'), 'critical', minioUrl));
  }

  const email = process.env.PL_CHAT_ACCEPTANCE_EMAIL || '';
  const password = process.env.PL_CHAT_ACCEPTANCE_PASSWORD || '';
  if (appUrl && email && password) {
    const login = await fetchWithTimeout(`${appUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: appUrl },
      body: JSON.stringify({ email, password, rememberDevice: false })
    }).catch((error) => ({ error }));
    const body = login.json ? await login.json().catch(() => ({})) : {};
    checks.push(check('Tunnel login works', login.status === 200 && body.token, 'critical', `status=${login.status || login.error?.message || 'none'}`));

    if (body.token) {
      const events = await fetchWithTimeout(`${appUrl}/api/events?token=${encodeURIComponent(body.token)}`, {
        headers: { Accept: 'text/event-stream', Origin: appUrl }
      }, 5000).catch((error) => ({ error }));
      checks.push(check('SSE opens through tunnel', events.status === 200, 'high', `status=${events.status || events.error?.message || 'none'}`));
      events.body?.cancel?.().catch?.(() => {});
    } else {
      checks.push(check('SSE opens through tunnel', false, 'high', 'Login token was not available.'));
    }
  } else {
    checks.push(check('Authenticated tunnel workflow', false, 'high', 'Set PL_CHAT_ACCEPTANCE_EMAIL and PL_CHAT_ACCEPTANCE_PASSWORD to verify login and SSE through tunnel.'));
  }

  checks.push(check(
    'URL rotation policy documented',
    existsSync(statusPath),
    'high',
    'Current tunnel URL is recorded; rerun this acceptance after every tunnel restart.'
  ));

  const failed = checks.filter((item) => !item.pass);
  const report = {
    phase: 'L',
    generatedAt: new Date().toISOString(),
    status: failed.length ? 'HOLD' : 'PASS',
    appUrl,
    minioUrl,
    checks
  };

  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, 'latest.json'), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(join(reportDir, 'latest.md'), [
    '# Phase L Quick Tunnel Acceptance',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    `App URL: ${appUrl || 'missing'}`,
    `MinIO transfer URL: ${minioUrl || 'missing'}`,
    '',
    '| Check | Result | Level | Detail |',
    '| --- | --- | --- | --- |',
    ...checks.map((item) => `| ${item.name} | ${item.pass ? 'PASS' : 'HOLD'} | ${item.level} | ${String(item.detail || '').replaceAll('|', '/')} |`)
  ].join('\n'), 'utf8');

  if (jsonOnly) console.log(JSON.stringify(report, null, 2));
  else console.log(`${report.status}: ${checks.filter((item) => item.pass).length}/${checks.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error(`Quick Tunnel acceptance failed: ${error.message}`);
  process.exitCode = 2;
});
