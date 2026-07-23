import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const main = read('electron/main.cjs');
const preload = read('electron/preload.cjs');
const offline = read('electron/offline.html');
const html = read('trial-server/public/index.html');
const nsis = read('build/installer/lan-v1.nsh');
const pkg = JSON.parse(read('package.json'));

const checks = [
  ['Main exposes desktop server URL setter', main.includes("plchat:set-desktop-server-url") && main.includes('desktop-server.json')],
  ['Main declares LAN-only deployment mode', main.includes("deploymentMode: 'lan-only-v1'") && main.includes('lan-auto-update')],
  ['Main defaults LAN clients to host IP', main.includes("const LAN_APP_URL = 'http://192.168.1.117:8788'") && main.includes('DEFAULT_APP_URL = LAN_APP_URL')],
  ['Main ignores stale loopback saved URLs', main.includes('isLoopbackAppUrl') && main.includes('!isLoopbackAppUrl(savedAppUrl)')],
  ['Main disables GPU for client compatibility', main.includes('disableHardwareAcceleration') && main.includes("appendSwitch('disable-gpu')")],
  ['Updater reports manual installer mode', main.includes('LAN-only v1 is updated by installing the latest PL CHAT Setup')],
  ['Preload exposes setServerUrl', preload.includes('setServerUrl')],
  ['Offline page can save Server URL', offline.includes('serverUrl') && offline.includes('setServerUrl')],
  ['Desktop update page shows manual installer copy', html.includes('LAN-only v1 uses manual installer updates from the administrator.')],
  ['Installer writes LAN client config', nsis.includes('$APPDATA\\pl-chat\\desktop-server.json') && nsis.includes('http://192.168.1.117:8788')],
  ['Installer removes legacy uppercase app data', nsis.includes('RMDir /r "$APPDATA\\PL CHAT"')],
  ['LAN config example exists', fs.existsSync(path.join(root, 'electron/desktop-config.lan.example.json'))],
  ['Host prep script exists', fs.existsSync(path.join(root, 'scripts/windows-prepare-lan-v1-host.ps1'))],
  ['Client URL script exists', fs.existsSync(path.join(root, 'scripts/windows-set-desktop-lan-server.ps1'))],
  ['Release doc exists', fs.existsSync(path.join(root, 'docs/DESKTOP_LAN_V1_RELEASE.md'))],
  ['Package version is LAN v1.0.9', pkg.version === '1.0.9'],
  ['Windows NSIS includes LAN installer script', pkg.build?.nsis?.include === 'build/installer/lan-v1.nsh'],
  ['Windows build names installer artifact', pkg.build?.win?.artifactName === '${productName} Setup ${version} Auto Update Stable.${ext}']
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'HOLD'} | ${name}`);
if (failed.length) {
  console.log(`HOLD: ${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(1);
}
console.log(`PASS: ${checks.length}/${checks.length} checks passed`);
