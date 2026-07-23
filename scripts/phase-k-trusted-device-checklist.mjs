import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = new Set(process.argv.slice(2));
const jsonOnly = args.has('--json');
const now = new Date();
const serverPath = join(root, 'trial-server', 'server.mjs');
const webPath = join(root, 'trial-server', 'public', 'index.html');

function check(name, pass, level, detail) {
  return { name, pass: Boolean(pass), level, detail };
}

function renderMarkdown(report) {
  const requiredLines = report.status === 'PASS'
    ? [
        '- Keep trusted-device auto login available only from secure runtime origins and same-device browser storage.',
        '- Keep public Quick Tunnel URL rotation on normal re-link/login behavior because browser storage is origin-scoped.',
        '- Re-run this checklist after any auth or tunnel behavior changes.'
      ]
    : [
        '- Choose the supported trusted-device surface: secure runtime origin, stable localhost/desktop app, or public Quick Tunnel with explicit re-link after URL rotation.',
        '- Do not mark production-ready for changing public tunnel URLs while claiming browser localStorage crosses origins.',
        '- Re-run this checklist after the selected persistence design is implemented.'
      ];

  return [
    '# Phase K Trusted Device Security Checklist',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    '',
    '## Checklist',
    '',
    '| Check | Result | Level | Detail |',
    '| --- | --- | --- | --- |',
    ...report.checks.map((item) => `| ${item.name} | ${item.pass ? 'PASS' : 'HOLD'} | ${item.level} | ${item.detail} |`),
    '',
    '## Decision',
    '',
    report.status === 'PASS'
      ? 'Trusted Device Auto Login is ready for production activation on the supported secure runtime origin surface.'
      : 'Trusted Device Auto Login is implemented, but not ready for production activation until HOLD items are resolved.',
    '',
    '## Supported Surface',
    '',
    'Trusted-device auto login is intentionally limited to the current secure runtime origin and same-device browser storage. Public Quick Tunnel refresh on the same URL can restore the session; when the tunnel URL changes, users must sign in or re-link because browser storage is origin-scoped.',
    '',
    '## Required Before Ready',
    '',
    ...requiredLines
  ].join('\n');
}

async function main() {
  const server = existsSync(serverPath) ? await readFile(serverPath, 'utf8') : '';
  const web = existsSync(webPath) ? await readFile(webPath, 'utf8') : '';
  const trustedDeviceBlock = server.match(/function createTrustedDevice[\s\S]*?return \{ token, device \};/)?.[0] || '';

  const checks = [
    check(
      'Does not store real password',
      !/localStorage\.setItem\([^)]*password/i.test(web) && !/password/i.test(trustedDeviceBlock),
      'critical',
      'Trusted-device flow must never store the account password.'
    ),
    check(
      'Uses trusted-device token',
      server.includes('trustedDeviceToken') && web.includes('plchat_trusted_device_token'),
      'critical',
      'Login and boot flow use a trusted-device token separate from the password.'
    ),
    check(
      'Server stores token hash only',
      server.includes('tokenHash: hashToken(token)') && !server.includes('trustedDeviceToken: hashToken'),
      'critical',
      'Raw trusted-device token should not be stored server-side.'
    ),
    check(
      'Trusted device expires',
      server.includes('trustedDeviceExpiresDays') && server.includes('expiresAt') && server.includes('isExpired(device)'),
      'high',
      'Trusted devices must have a bounded lifetime.'
    ),
    check(
      'Trusted device can be revoked',
      server.includes('/api/auth/trusted-device/revoke') && server.includes('device.revokedAt') && web.includes('safeStorageRemove(trustedDeviceStorageKey)'),
      'high',
      'Logout or explicit action must revoke the current trusted device.'
    ),
    check(
      'Password reset invalidates trusted devices',
      server.includes('state.trustedDevices = state.trustedDevices.filter((device) => device.userId !== user.id)'),
      'high',
      'Password reset should invalidate all trusted devices for the user.'
    ),
    check(
      'Works on Quick Tunnel refresh without permanent hostname assumptions',
      server.includes('isTrustedDeviceRuntimeHost') && server.includes('.trycloudflare.com') && web.includes('isTrustedDeviceSurface()'),
      'high',
      'Supported design uses the current secure runtime origin for trusted devices; changing public Quick Tunnel URLs use normal login/re-link instead of pretending origin-scoped storage follows the new URL.'
    )
  ];

  const failed = checks.filter((item) => !item.pass);
  const status = failed.length ? 'HOLD' : 'PASS';
  const report = {
    phase: 'K',
    generatedAt: now.toISOString(),
    status,
    checks
  };

  const reportDir = join(root, 'pl-chat-data', 'trusted-device-security');
  await mkdir(reportDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  await writeFile(join(reportDir, `phase-k-trusted-device-checklist-${stamp}.json`), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(join(reportDir, 'latest.json'), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(join(reportDir, 'latest.md'), renderMarkdown(report), 'utf8');

  if (jsonOnly) console.log(JSON.stringify(report, null, 2));
  else console.log(renderMarkdown(report));
  process.exitCode = status === 'PASS' ? 0 : 1;
}

main().catch((error) => {
  console.error(`Phase K trusted-device checklist failed: ${error.message}`);
  process.exitCode = 2;
});
