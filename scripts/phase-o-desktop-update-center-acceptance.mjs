import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'trial-server/public/index.html'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');

const checks = [
  ['Desktop runtime helper exists', /function isDesktopRuntime\(\)/.test(html)],
  ['Web fallback copy exists', html.includes('ฟีเจอร์อัปเดตซอฟต์แวร์ใช้ได้เฉพาะ PL CHAT Desktop App เท่านั้น')],
  ['Settings update item desktop gated', /if \(isDesktopRuntime\(\)\)[\s\S]*Software Update/.test(html)],
  ['Direct browser route handled', html.includes("path === '/settings/updates'") && html.includes('showWebUpdateFallbackStandalone')],
  ['Updater calls use desktop guard', html.includes('function desktopUpdater()') && html.includes('desktopUpdaterUnavailableError')],
  ['Web update badge is desktop-only', html.includes('renderDesktopUpdateBadges') && html.includes('desktopUpdateBadge')],
  ['Preload exposes updater only through desktop bridge', preload.includes("contextBridge.exposeInMainWorld('plChatDesktop'") && preload.includes('updater:') && !preload.includes('window.electronAPI =')],
  ['Preload uses updater channel allowlist', preload.includes('desktopUpdaterChannels')],
  ['Main protects updater IPC runtime', main.includes('assertDesktopUpdaterRuntime') && main.includes('Desktop updater is available only in PL CHAT Desktop App.')],
  ['App version IPC exists', main.includes('plchat:updater:get-app-version')],
  ['Update action IPC exists', main.includes('plchat:updater:check-for-updates') && main.includes('plchat:updater:restart-and-install')]
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'HOLD'} | ${name}`);
if (failed.length) {
  console.log(`HOLD: ${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(1);
}
console.log(`PASS: ${checks.length}/${checks.length} checks passed`);
