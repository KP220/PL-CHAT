import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);

function argValue(name, fallback = '') {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function findLatestInstaller(directory) {
  if (!fs.existsSync(directory)) return '';
  return fs.readdirSync(directory)
    .filter((name) => /^PL CHAT Setup .+\.exe$/i.test(name))
    .map((name) => {
      const filePath = path.join(directory, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || '';
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const releaseDir = path.resolve(root, argValue('--release-dir', 'release'));
const installerPath = path.resolve(root, argValue('--installer', findLatestInstaller(releaseDir)));
const outPath = path.resolve(root, argValue('--out', path.join(path.dirname(installerPath || releaseDir), 'latest.json')));
const publicBaseUrl = String(argValue('--base-url', '')).replace(/\/$/, '');

if (!installerPath || !fs.existsSync(installerPath)) {
  console.error('HOLD: PL CHAT installer was not found. Pass --installer or build the Windows installer first.');
  process.exit(1);
}

const installerName = path.basename(installerPath);
const stats = fs.statSync(installerPath);
const installerUrl = publicBaseUrl ? `${publicBaseUrl}/${encodeURIComponent(installerName).replace(/%20/g, '%20')}` : installerName;
const manifest = {
  productName: 'PL CHAT',
  version: pkg.version,
  releaseDate: new Date().toISOString(),
  notes: 'PL CHAT Desktop App production installer update.',
  files: [
    {
      platform: 'win32',
      arch: process.arch,
      url: installerUrl,
      size: stats.size,
      sha256: sha256File(installerPath)
    }
  ]
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`PASS: desktop update feed written to ${outPath}`);
console.log(`Installer: ${installerPath}`);
console.log(`Version: ${manifest.version}`);
console.log(`SHA256: ${manifest.files[0].sha256}`);
