import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const server = read('trial-server/server.mjs');
const html = read('trial-server/public/index.html');

const checks = [
  ['Server declares desktop update folder', server.includes('desktopUpdateDir') && server.includes('desktop-updates')],
  ['Server reads desktop update manifest', server.includes('readDesktopUpdateManifest') && server.includes('latest.json')],
  ['Server exposes update manifest API', server.includes("path === '/api/desktop/update-manifest'")],
  ['Server exposes update installer download API', server.includes("path === '/api/desktop/update-installer'") && server.includes('sendDesktopUpdateInstaller')],
  ['Server exposes host admin status API', server.includes("path === '/api/admin/host/status'") && server.includes('hostAdminStatus')],
  ['Server exposes admin installer publish API', server.includes("path === '/api/admin/desktop-update/publish'") && server.includes('publishDesktopUpdateFromRequest')],
  ['Server exposes host backup API', server.includes("path === '/api/admin/host/backup'") && server.includes('createHostBackup')],
  ['Server exposes restart request marker API', server.includes("path === '/api/admin/host/restart-request'") && server.includes('restart-request.json')],
  ['Software Update loads host manifest', html.includes("api('/api/desktop/update-manifest')") && html.includes('Latest Host Version')],
  ['Software Update enables host installer download', html.includes('downloadUrl') && html.includes('ดาวน์โหลด installer จากโฮสต์')],
  ['Admin page renders host panel', html.includes('Host Admin Panel') && html.includes('loadHostAdminPanel')],
  ['Admin page can publish installer from browser', html.includes('Release Manager') && html.includes('hostPublishInstaller') && html.includes('/api/admin/desktop-update/publish')],
  ['Admin page can create backup', html.includes('/api/admin/host/backup') && html.includes('createHostBackupFromAdmin')],
  ['Admin page can request restart marker', html.includes('/api/admin/host/restart-request') && html.includes('requestHostRestartFromAdmin')],
  ['Publish update script exists', fs.existsSync(path.join(root, 'scripts/windows-publish-desktop-update.ps1'))],
  ['Phase 3/4 doc exists', fs.existsSync(path.join(root, 'docs/LAN_V1_PHASE_3_4_UPDATE_AND_ADMIN.md'))]
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'HOLD'} | ${name}`);
if (failed.length) {
  console.log(`HOLD: ${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(1);
}
console.log(`PASS: ${checks.length}/${checks.length} checks passed`);
