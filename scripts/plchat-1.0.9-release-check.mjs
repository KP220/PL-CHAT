import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '');
const exists = (file) => fs.existsSync(path.join(root, file));

const pkg = JSON.parse(read('package.json'));
const main = read('electron/main.cjs');
const preload = read('electron/preload.cjs');
const bundledConfig = JSON.parse(read('electron/desktop-config.json'));
const nsis = read('build/installer/lan-v1.nsh');
const html = read('trial-server/public/index.html');

const expectedVersion = '1.0.9';
const hostUrl = 'http://192.168.1.117:8788';
const feedUrl = `${hostUrl}/api/desktop/update-feed`;

const checks = [
  ['Package version is 1.0.9', pkg.version === expectedVersion],
  ['Bundled desktop config uses URL117', bundledConfig.appUrl === hostUrl],
  ['Bundled update feed uses URL117', bundledConfig.updateFeedUrl === feedUrl],
  ['Installer writes URL117 config', nsis.includes(`"appUrl": "${hostUrl}"`) && nsis.includes(`"updateFeedUrl": "${feedUrl}"`)],
  ['Installer no longer writes URL126', !nsis.includes('http://192.168.1.126:8788')],
  ['Runtime default URL is URL117', main.includes(`const LAN_APP_URL = '${hostUrl}'`)],
  ['Runtime repairs stale URL126 config', main.includes('normalizeDesktopServerConfig') && main.includes('stale-host-url')],
  ['Runtime verifies version after install', main.includes('reconcileUpdateStatus') && main.includes('update-install-verified') && main.includes('update-install-not-applied')],
  ['Repair install is available in runtime', main.includes("plchat:updater:repair-install") && preload.includes('repairInstall')],
  ['Software Update shows readable states', html.includes("'install-failed':") && html.includes('desktopRepairInstall')],
  ['Software Update checklist is 1.0.9', html.includes('1.0.9 stability checklist')],
  ['Desktop native upload bridge is available', preload.includes('startUpload') && preload.includes('onUploadUpdated') && main.includes("plchat:upload:start")],
  ['Desktop native upload is wired into chat uploader', html.includes('uploadDesktopNativeFile') && html.includes('desktop-multipart')],
  ['Desktop download progress monitor shows speed and ETA', main.includes('etaSeconds') && html.includes('desktopDownloadPower') && html.includes('formatDurationCompact')],
  ['Desktop download history matches browser-style popover', html.includes('Recent download history') && html.includes('downloadHistoryItem') && html.includes('Full download history')],
  ['Desktop file downloads prefer app download manager', html.includes('startDesktopManagedDownload') && html.includes('new URL(url || fallbackUrl, location.origin)')],
  ['Desktop download popover is minimal with MB counter', html.includes('width: min(330px') && html.includes('formatDownloadMb') && html.includes('0 B/s')],
  ['Desktop download popover always shows file type', html.includes('desktopDownloadTypeText') && html.includes('const typeText = desktopDownloadTypeText')],
  ['Windows installer artifact name is stable auto-update', pkg.build?.win?.artifactName === '${productName} Setup ${version} Auto Update Stable.${ext}'],
  ['Release folder exists', exists('release')]
];

const failed = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) console.log(`${passed ? 'PASS' : 'HOLD'} | ${name}`);
if (failed.length) {
  console.log(`HOLD: ${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(1);
}
console.log(`PASS: ${checks.length}/${checks.length} checks passed`);
