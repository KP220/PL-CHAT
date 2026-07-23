import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const main = read('electron/main.cjs');
const preload = read('electron/preload.cjs');
const html = read('trial-server/public/index.html');
const pkg = JSON.parse(read('package.json'));

const releaseDirs = [
  'release',
  'release-lan-v1-installer-direct-final-packed',
  'release-lan-v1-1.0.1'
].map((directory) => path.join(root, directory));

const installers = releaseDirs
  .filter((directory) => fs.existsSync(directory))
  .flatMap((directory) => fs.readdirSync(directory)
    .filter((name) => /^PL CHAT Setup .+\.exe$/i.test(name))
    .map((name) => path.join(directory, name)));

const checks = [
  ['Desktop runtime guard still exists', html.includes('function isDesktopRuntime()') && html.includes('DesktopOnlyGuard')],
  ['Web Software Update remains hidden', html.includes('WebUpdateUnavailableNotice') && html.includes('ฟีเจอร์อัปเดตซอฟต์แวร์ใช้ได้เฉพาะ PL CHAT Desktop App เท่านั้น')],
  ['Updater IPC remains desktop-only guarded', main.includes('assertDesktopUpdaterRuntime(event)') && main.includes('DESKTOP_UPDATER_ONLY_ERROR')],
  ['Updater feed URL can be configured', main.includes('PL_CHAT_UPDATE_FEED_URL') && main.includes('updateFeedUrl')],
  ['Updater can read production manifest', main.includes('readUpdateManifest') && main.includes('selectUpdateInstaller')],
  ['Updater compares app version before offering update', main.includes('compareVersions(installer.version, app.getVersion())')],
  ['Updater verifies installer checksum', main.includes('sha256File') && main.includes('update_installer_sha256_mismatch')],
  ['Updater verifies installer size', main.includes('update_installer_size_mismatch')],
  ['Updater downloads installer before install', main.includes('downloadUpdateInstaller') && main.includes('installerPath')],
  ['Updater opens verified installer', main.includes('openDownloadedInstaller') && main.includes('shell.openPath')],
  ['Preload exposes updater allowlist only', preload.includes('desktopUpdaterChannels') && preload.includes('invokeDesktopUpdater') && preload.includes('plchat:updater:check-for-updates')],
  ['Feed generator script exists', exists('scripts/create-desktop-update-feed.mjs')],
  ['Windows installer artifact naming is configured', pkg.build?.win?.artifactName === '${productName} Setup ${version}.${ext}'],
  ['Windows NSIS installer packaging is configured', Array.isArray(pkg.build?.win?.target) && pkg.build.win.target.includes('nsis')],
  ['At least one PL CHAT Setup installer exists', installers.length > 0]
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'HOLD'} | ${name}`);
if (installers.length) console.log(`INFO | Installer artifact | ${installers[0]}`);
if (failed.length) {
  console.log(`HOLD: ${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(1);
}
console.log(`PASS: ${checks.length}/${checks.length} checks passed`);
