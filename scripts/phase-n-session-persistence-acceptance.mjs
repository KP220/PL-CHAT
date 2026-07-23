import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const reportDir = join(root, 'pl-chat-data', 'session-persistence-acceptance');
const tunnelStatusPath = join(root, 'pl-chat-data', 'tunnels', 'quick-tunnel-status.json');
const webPath = join(root, 'trial-server', 'public', 'index.html');
const serverPath = join(root, 'trial-server', 'server.mjs');

function check(name, pass, level, detail) {
  return { name, pass: Boolean(pass), level, detail };
}

async function readJson(path) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
}

async function fetchWithTimeout(url, options = {}, ms = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function markdown(report) {
  return [
    '# Phase N Session Persistence Acceptance',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    `App URL: ${report.appUrl || 'missing'}`,
    '',
    '| Check | Result | Level | Detail |',
    '| --- | --- | --- | --- |',
    ...report.checks.map((item) => `| ${item.name} | ${item.pass ? 'PASS' : 'HOLD'} | ${item.level} | ${String(item.detail || '').replaceAll('|', '/')} |`),
    '',
    '## Decision',
    '',
    report.status === 'PASS'
      ? 'Refresh/session persistence is accepted for the current Quick Tunnel runtime origin. URL rotation still requires normal login or re-link because browser storage is origin-scoped.'
      : 'Refresh/session persistence is not accepted yet. Resolve HOLD items and rerun this check after restarting PL CHAT.'
  ].join('\n');
}

async function main() {
  const checks = [];
  const status = existsSync(tunnelStatusPath) ? await readJson(tunnelStatusPath).catch(() => ({})) : {};
  const appUrl = String(process.env.PL_CHAT_TUNNEL_URL || status.appUrl || '').replace(/\/+$/, '');
  const email = process.env.PL_CHAT_ACCEPTANCE_EMAIL || '';
  const password = process.env.PL_CHAT_ACCEPTANCE_PASSWORD || '';
  const web = existsSync(webPath) ? await readFile(webPath, 'utf8') : '';
  const server = existsSync(serverPath) ? await readFile(serverPath, 'utf8') : '';

  checks.push(check('Quick Tunnel app URL exists', Boolean(appUrl), 'critical', appUrl || 'missing'));
  checks.push(check('Acceptance credentials configured', Boolean(email && password), 'critical', 'Required for live login and refresh checks.'));
  checks.push(check(
    'Frontend stores session token safely',
    web.includes('function getStoredSessionToken()')
      && web.includes('function storeSessionToken(token)')
      && web.includes('safeStorageSet(sessionTokenStorageKey, value)')
      && web.includes('safeStorageSet(sessionTokenStorageKey, value, sessionStorage)'),
    'critical',
    'Refresh boot must be able to reuse the session token from localStorage or sessionStorage.'
  ));
  checks.push(check('Frontend attempts trusted-device recovery on secure runtime origin', web.includes('isTrustedDeviceSurface()') && web.includes('/api/auth/trusted-device'), 'critical', 'Trusted-device recovery must be available after a session token expires.'));
  checks.push(check('Server allows secure Quick Tunnel trusted-device origin', server.includes('isTrustedDeviceRuntimeHost') && server.includes('.trycloudflare.com'), 'critical', 'Quick Tunnel HTTPS origin must be an accepted trusted-device surface.'));
  checks.push(check('Server stores trusted-device token hash only', server.includes('tokenHash: hashToken(token)') && !server.includes('trustedDeviceToken: hashToken'), 'critical', 'Raw trusted-device token must not be stored server-side.'));

  let sessionToken = '';
  let trustedDeviceToken = '';
  let sessionCookie = '';
  if (appUrl && email && password) {
    const login = await fetchWithTimeout(`${appUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: appUrl },
      body: JSON.stringify({ email, password, rememberDevice: true, deviceLabel: 'Phase N Quick Tunnel acceptance' })
    }).catch((error) => ({ error }));
    const loginBody = login.json ? await login.json().catch(() => ({})) : {};
    sessionToken = loginBody.token || '';
    trustedDeviceToken = loginBody.trustedDeviceToken || '';
    sessionCookie = login.headers?.getSetCookie?.()?.find((item) => item.startsWith('plchat_session='))
      || login.headers?.get?.('set-cookie')
      || '';
    checks.push(check('Login with remember device works through tunnel', login.status === 200 && sessionToken, 'critical', `status=${login.status || login.error?.message || 'none'}`));
    checks.push(check('Login sets server session cookie', /(^|;\s*)plchat_session=/.test(sessionCookie), 'critical', sessionCookie ? 'cookie issued' : 'missing'));
    checks.push(check('Trusted-device token issued without storing password', Boolean(trustedDeviceToken) && !String(trustedDeviceToken).includes(password), 'critical', trustedDeviceToken ? 'token issued' : 'missing'));
  }

  if (appUrl && sessionToken) {
    const me = await fetchWithTimeout(`${appUrl}/api/me`, {
      headers: { Authorization: `Bearer ${sessionToken}`, Origin: appUrl }
    }).catch((error) => ({ error }));
    const meBody = me.json ? await me.json().catch(() => ({})) : {};
    checks.push(check('Refresh simulation keeps authenticated session', me.status === 200 && meBody.user?.id, 'critical', `status=${me.status || me.error?.message || 'none'}`));
  }

  if (appUrl && sessionCookie) {
    const staleAuth = await fetchWithTimeout(`${appUrl}/api/me`, {
      headers: {
        Authorization: 'Bearer stale-session-token-from-before-restart',
        Cookie: sessionCookie.split(';')[0],
        Origin: appUrl
      }
    }).catch((error) => ({ error }));
    const staleBody = staleAuth.json ? await staleAuth.json().catch(() => ({})) : {};
    checks.push(check(
      'Cookie session wins when stale Authorization is present',
      staleAuth.status === 200 && staleBody.user?.id,
      'critical',
      `status=${staleAuth.status || staleAuth.error?.message || 'none'}`
    ));
  }

  if (appUrl && trustedDeviceToken) {
    const recovery = await fetchWithTimeout(`${appUrl}/api/auth/trusted-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: appUrl },
      body: JSON.stringify({ trustedDeviceToken })
    }).catch((error) => ({ error }));
    const recoveryBody = recovery.json ? await recovery.json().catch(() => ({})) : {};
    checks.push(check('Trusted-device auto login recovers a new session through tunnel', recovery.status === 200 && recoveryBody.token, 'critical', `status=${recovery.status || recovery.error?.message || 'none'}`));

    const revoke = await fetchWithTimeout(`${appUrl}/api/auth/trusted-device/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: appUrl },
      body: JSON.stringify({ trustedDeviceToken })
    }).catch((error) => ({ error }));
    checks.push(check('Trusted-device token can be revoked', revoke.status === 200, 'high', `status=${revoke.status || revoke.error?.message || 'none'}`));
  }

  const failed = checks.filter((item) => !item.pass);
  const report = {
    phase: 'N',
    generatedAt: new Date().toISOString(),
    status: failed.length ? 'HOLD' : 'PASS',
    appUrl,
    checks
  };

  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, 'latest.json'), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(join(reportDir, 'latest.md'), markdown(report), 'utf8');
  console.log(`${report.status}: ${checks.filter((item) => item.pass).length}/${checks.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error(`Phase N session persistence acceptance failed: ${error.message}`);
  process.exitCode = 2;
});
