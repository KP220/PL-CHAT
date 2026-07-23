import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const jsonOnly = args.has('--json');
const verify = args.has('--verify');
const restoreRehearsal = args.has('--restore-rehearsal');
const metadataOnly = args.has('--metadata-only') || (!args.has('--include-local-uploads') && !restoreRehearsal && !verify);
const includeLocalUploads = args.has('--include-local-uploads') && !metadataOnly;
const now = new Date();

function argValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const item = process.argv.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

function stamp() {
  return now.toISOString().replace(/[:.]/g, '-');
}

function bytesToGb(bytes) {
  return Math.round((Number(bytes || 0) / 1024 / 1024 / 1024) * 100) / 100;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function safeStat(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [name, ...rest] = trimmed.split('=');
    values[name.trim()] = rest.join('=').trim().replace(/^"|"$/g, '');
  }
  return values;
}

function redactEnv(text) {
  const secretPattern = /(SECRET|PASSWORD|TOKEN|KEY|SMTP_USER|DATABASE_URL|AUTH)/i;
  return text.split(/\r?\n/).map((line) => {
    if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) return line;
    const [name] = line.split('=');
    return secretPattern.test(name) ? `${name}=<redacted>` : line;
  }).join('\n');
}

async function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

async function listFilesRecursive(path) {
  const files = [];
  async function walk(current) {
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      if (entry.isFile()) files.push(full);
    }
  }
  if (await exists(path)) await walk(path);
  return files;
}

async function readWorkspace(dataDir, env) {
  const dataFile = join(dataDir, env.PL_CHAT_DATA_FILE || 'pl-chat-workspace.json');
  const text = await readFile(dataFile, 'utf8');
  return { dataFile, state: JSON.parse(text) };
}

async function copyWithChecksum(source, target, manifest, type) {
  const info = await stat(source);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { force: true });
  const checksum = await sha256(target);
  const item = {
    type,
    source,
    target,
    relativeTarget: relative(manifest.backupDir, target),
    bytes: info.size,
    sha256: checksum
  };
  manifest.files.push(item);
  return item;
}

async function writeRedactedEnv(source, target, manifest) {
  if (!(await exists(source))) return;
  await mkdir(dirname(target), { recursive: true });
  const text = await readFile(source, 'utf8');
  await writeFile(target, redactEnv(text), 'utf8');
  const info = await stat(target);
  manifest.files.push({
    type: 'redacted_config',
    source,
    target,
    relativeTarget: relative(manifest.backupDir, target),
    bytes: info.size,
    sha256: await sha256(target)
  });
}

async function collectUploadInventory(dataDir, state) {
  const uploads = Array.isArray(state.uploads) ? state.uploads : [];
  const active = uploads.filter((item) => !item.deletedAt);
  const localActive = active.filter((item) => (item.storageDriver || 'local') === 'local');
  const s3Active = active.filter((item) => (item.storageDriver || 'local') === 's3');
  const localUploadsDir = join(dataDir, 'uploads');
  const localFiles = [];
  let localBytes = 0;
  let missingLocal = 0;

  for (const upload of localActive) {
    const key = upload.storageKey || basename(String(upload.url || ''));
    const path = key ? join(localUploadsDir, key) : '';
    const info = path ? await safeStat(path) : null;
    if (!info) {
      missingLocal += 1;
      localFiles.push({ id: upload.id, key, missing: true, expectedBytes: Number(upload.size || 0) });
      continue;
    }
    localBytes += info.size;
    localFiles.push({
      id: upload.id,
      key,
      source: path,
      bytes: info.size,
      expectedBytes: Number(upload.size || 0),
      mtime: info.mtime.toISOString()
    });
  }

  const s3Bytes = s3Active.reduce((sum, item) => sum + Number(item.size || 0), 0);
  return {
    activeUploads: active.length,
    localActive: localActive.length,
    localBytes,
    localGb: bytesToGb(localBytes),
    s3Active: s3Active.length,
    s3Bytes,
    s3Gb: bytesToGb(s3Bytes),
    missingLocal,
    localFiles
  };
}

async function runBackup() {
  const envPath = join(root, '.env.production');
  const env = (await exists(envPath)) ? parseEnv(await readFile(envPath, 'utf8')) : {};
  const dataDir = resolve(root, env.PL_CHAT_DATA_DIR || 'pl-chat-data');
  const reportDir = join(dataDir, 'backup-dr');
  const backupRoot = resolve(root, argValue('backup-root', process.env.PL_CHAT_BACKUP_DIR || join(root, '.backups', 'phase-h')));
  const backupDir = join(backupRoot, `pl-chat-dr-${stamp()}`);
  const { dataFile, state } = await readWorkspace(dataDir, env);
  const uploadInventory = await collectUploadInventory(dataDir, state);

  const manifest = {
    phase: 'H',
    createdAt: now.toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    backupDir,
    metadataOnly,
    includeLocalUploads,
    root,
    dataDir,
    files: [],
    skipped: [],
    uploadInventory
  };

  const criticalFiles = [
    dataFile,
    `${dataFile}.last-good.json`,
    join(dataDir, 'public-tunnel-url.txt'),
    join(root, '.env.example'),
    join(root, '.env.production.example'),
    join(root, '.env.local.example'),
    join(root, 'package.json'),
    join(root, 'package-lock.json'),
    join(root, 'docker-compose.production.yml'),
    join(root, 'docker-compose.storage.yml'),
    join(root, 'trial-server', 'server.mjs'),
    join(root, 'trial-server', 's3-multipart-storage.mjs')
  ];

  if (apply) {
    await mkdir(backupDir, { recursive: true });
    await mkdir(reportDir, { recursive: true });
    for (const source of criticalFiles) {
      if (!(await exists(source))) {
        manifest.skipped.push(source);
        continue;
      }
      await copyWithChecksum(source, join(backupDir, 'critical', relative(root, source)), manifest, 'critical');
    }
    await writeRedactedEnv(envPath, join(backupDir, 'critical', '.env.production.redacted'), manifest);

    if (includeLocalUploads) {
      for (const file of uploadInventory.localFiles.filter((item) => !item.missing)) {
        await copyWithChecksum(file.source, join(backupDir, 'local-uploads', file.key), manifest, 'local_upload');
      }
    }

    await writeFile(join(backupDir, 'upload-inventory.json'), JSON.stringify(uploadInventory, null, 2), 'utf8');
    await writeFile(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  }

  const gate = {
    workspaceJsonReadable: Boolean(state && typeof state === 'object'),
    noMissingActiveLocalFiles: uploadInventory.missingLocal === 0,
    backupCreated: apply ? await exists(join(backupDir, 'manifest.json')) : true,
    localUploadBinariesIncluded: includeLocalUploads,
    offDeviceTargetConfigured: !backupRoot.startsWith(root)
  };
  gate.pass = gate.workspaceJsonReadable && gate.noMissingActiveLocalFiles && gate.backupCreated;

  const report = { ...manifest, gate };
  if (apply) {
    const reportBase = `phase-h-backup-${stamp()}`;
    await writeFile(join(reportDir, `${reportBase}.json`), JSON.stringify(report, null, 2), 'utf8');
    await writeFile(join(reportDir, 'latest-backup.json'), JSON.stringify(report, null, 2), 'utf8');
    await writeFile(join(reportDir, 'latest-backup.md'), renderBackupMarkdown(report), 'utf8');
  }

  return report;
}

function renderBackupMarkdown(report) {
  return [
    '# Phase H Backup Report',
    '',
    `Generated: ${report.createdAt}`,
    `Mode: ${report.mode}`,
    `Backup directory: ${report.backupDir}`,
    `Metadata only: ${report.metadataOnly ? 'yes' : 'no'}`,
    '',
    '## Inventory',
    '',
    `- Active uploads: ${report.uploadInventory.activeUploads}`,
    `- Active local uploads: ${report.uploadInventory.localActive} (${report.uploadInventory.localGb} GB)`,
    `- Active S3 uploads: ${report.uploadInventory.s3Active} (${report.uploadInventory.s3Gb} GB)`,
    `- Missing active local files: ${report.uploadInventory.missingLocal}`,
    `- Files copied: ${report.files.length}`,
    '',
    '## Gate',
    '',
    `- Workspace JSON readable: ${report.gate.workspaceJsonReadable ? 'PASS' : 'FAIL'}`,
    `- No missing active local files: ${report.gate.noMissingActiveLocalFiles ? 'PASS' : 'FAIL'}`,
    `- Backup manifest created: ${report.gate.backupCreated ? 'PASS' : 'FAIL'}`,
    `- Off-device target configured: ${report.gate.offDeviceTargetConfigured ? 'YES' : 'NO'}`,
    '',
    '## Notes',
    '',
    '- Secret values are not written into the redacted config artifact.',
    '- Use `--include-local-uploads --apply` only when the target backup root has enough space and is preferably off this machine.',
    '- Restore rehearsal validates copied files in an isolated folder and never writes over production data.'
  ].join('\n');
}

async function latestBackupDir(backupRoot) {
  const dirs = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('pl-chat-dr-'))
    .map((entry) => join(backupRoot, entry.name));
  const stats = [];
  for (const dir of dirs) {
    const info = await safeStat(dir);
    if (info) stats.push({ dir, time: info.mtime.getTime() });
  }
  stats.sort((a, b) => b.time - a.time);
  return stats[0]?.dir || '';
}

async function loadManifest() {
  const envPath = join(root, '.env.production');
  const env = (await exists(envPath)) ? parseEnv(await readFile(envPath, 'utf8')) : {};
  const dataDir = resolve(root, env.PL_CHAT_DATA_DIR || 'pl-chat-data');
  const backupRoot = resolve(root, argValue('backup-root', process.env.PL_CHAT_BACKUP_DIR || join(root, '.backups', 'phase-h')));
  const backupDir = resolve(argValue('backup-dir', '') || await latestBackupDir(backupRoot));
  if (!backupDir) throw new Error(`No Phase H backup found in ${backupRoot}`);
  const manifestPath = join(backupDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  return { manifest, manifestPath, dataDir, backupDir };
}

async function verifyManifest() {
  const { manifest, manifestPath, dataDir, backupDir } = await loadManifest();
  const failures = [];
  for (const item of manifest.files || []) {
    const target = resolve(backupDir, item.relativeTarget || relative(backupDir, item.target));
    if (!(await exists(target))) {
      failures.push({ file: target, reason: 'missing' });
      continue;
    }
    const checksum = await sha256(target);
    if (checksum !== item.sha256) failures.push({ file: target, reason: 'sha256_mismatch' });
  }
  const report = {
    phase: 'H',
    mode: 'verify',
    generatedAt: now.toISOString(),
    backupDir,
    manifestPath,
    checkedFiles: (manifest.files || []).length,
    failures,
    gate: { pass: failures.length === 0 }
  };
  await mkdir(join(dataDir, 'backup-dr'), { recursive: true });
  await writeFile(join(dataDir, 'backup-dr', 'latest-verify.json'), JSON.stringify(report, null, 2), 'utf8');
  return report;
}

async function runRestoreRehearsal() {
  const { manifest, manifestPath, dataDir, backupDir } = await loadManifest();
  const rehearsalRoot = resolve(root, argValue('rehearsal-root', join(root, '.recovery-test', `phase-h-${stamp()}`)));
  await mkdir(rehearsalRoot, { recursive: true });

  const copied = [];
  const criticalJson = (manifest.files || []).filter((item) =>
    item.type === 'critical' && /pl-chat-workspace\.json(\.last-good\.json)?$/.test(item.relativeTarget || '')
  );
  for (const item of criticalJson) {
    const source = resolve(backupDir, item.relativeTarget);
    const target = join(rehearsalRoot, basename(item.relativeTarget));
    await cp(source, target, { force: true });
    JSON.parse(await readFile(target, 'utf8'));
    copied.push(target);
  }

  const verifyReport = await verifyManifest();
  const report = {
    phase: 'H',
    mode: 'restore-rehearsal',
    generatedAt: now.toISOString(),
    backupDir,
    manifestPath,
    rehearsalRoot,
    copied,
    checkedFiles: verifyReport.checkedFiles,
    checksumFailures: verifyReport.failures,
    gate: {
      manifestVerified: verifyReport.failures.length === 0,
      workspaceJsonRestoredAndReadable: copied.length > 0,
      productionUntouched: true
    }
  };
  report.gate.pass = report.gate.manifestVerified && report.gate.workspaceJsonRestoredAndReadable;
  await mkdir(join(dataDir, 'backup-dr'), { recursive: true });
  await writeFile(join(dataDir, 'backup-dr', 'latest-restore-rehearsal.json'), JSON.stringify(report, null, 2), 'utf8');
  return report;
}

async function main() {
  const report = restoreRehearsal
    ? await runRestoreRehearsal()
    : verify
      ? await verifyManifest()
      : await runBackup();

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.mode === 'dry-run' || report.mode === 'apply') {
    console.log(renderBackupMarkdown(report));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
  process.exitCode = report.gate?.pass === false ? 1 : 0;
}

main().catch((error) => {
  console.error(`Phase H backup/DR failed: ${error.message}`);
  process.exitCode = 2;
});
