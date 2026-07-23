import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const main = read('electron/main.cjs');
const preload = read('electron/preload.cjs');
const html = read('trial-server/public/index.html');
const pkg = JSON.parse(read('package.json'));

const checks = [
  ['Package version is 1.0.9', pkg.version === '1.0.9'],
  ['Updater reconciles install state on startup', main.includes('function reconcileUpdateStatus') && main.includes('update-install-verified') && main.includes('update-install-not-applied')],
  ['Updater get-status returns reconciled state', main.includes("plchat:updater:get-update-status") && main.includes('status: reconcileUpdateStatus()')],
  ['Runner writes durable install log', main.includes('run-update.log') && main.includes('runner started') && main.includes('installer finished exitCode=')],
  ['Runner records installer exit code in status', main.includes('installExitCode') && main.includes('installFinishedAt')],
  ['Runner installs for current Windows user', main.includes('"/currentuser"')],
  ['Repair install IPC exists', main.includes("plchat:updater:repair-install") && main.includes('repair-installer-opened')],
  ['Repair install is exposed through preload allowlist', preload.includes("repairInstall: 'plchat:updater:repair-install'") && preload.includes('repairInstall: (payload)')],
  ['Software Update page has repair action', html.includes('repairDesktopUpdateInstall') && html.includes('desktopRepairInstall')],
  ['Software Update suppresses actions when runtime is current', html.includes('runtimeIsCurrent') && html.includes('Installed and verified')],
  ['Installer pins client config to URL117', read('build/installer/lan-v1.nsh').includes('http://192.168.1.117:8788') && !read('build/installer/lan-v1.nsh').includes('http://192.168.1.126:8788')],
  ['Runtime repairs stale URL126 config on startup', main.includes('normalizeDesktopServerConfig') && main.includes('stale-host-url')],
  ['Installer artifact uses stable auto-update name', pkg.build?.win?.artifactName === '${productName} Setup ${version} Auto Update Stable.${ext}']
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'HOLD'} | ${name}`);
if (failed.length) {
  console.log(`HOLD: ${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(1);
}
console.log(`PASS: ${checks.length}/${checks.length} checks passed`);
