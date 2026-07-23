import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const jsonOnly = args.has('--json');
const now = new Date();
const reportDir = join(root, 'pl-chat-data', 'storage-safety');
const envPath = join(root, '.env.production');

function parseNumberArg(name, fallback) {
  const prefix = `--${name}=`;
  const item = process.argv.find((value) => value.startsWith(prefix));
  if (!item) return fallback;
  const value = Number(item.slice(prefix.length));
  return Number.isFinite(value) ? value : fallback;
}

const staleHours = parseNumberArg('stale-hours', 24);
const localOrphanRetentionDays = parseNumberArg('local-orphan-retention-days', 14);
const deletedRecordRetentionDays = parseNumberArg('deleted-record-retention-days', 30);
const thresholds = [85, 90, 95];

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

function iso(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function ageHours(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return Infinity;
  return (now.getTime() - date.getTime()) / 36e5;
}

function ageDays(value) {
  return ageHours(value) / 24;
}

function bytesToGb(bytes) {
  return Math.round((Number(bytes || 0) / 1024 / 1024 / 1024) * 100) / 100;
}

function alertLevel(usedPercent) {
  if (usedPercent >= 95) return 'critical';
  if (usedPercent >= 90) return 'error';
  if (usedPercent >= 85) return 'warning';
  return 'ok';
}

async function safeStat(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function dirSize(path) {
  let total = 0;
  let files = 0;
  async function walk(current) {
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const info = await safeStat(full);
        if (info) {
          total += info.size;
          files += 1;
        }
      }
    }
  }
  if (existsSync(path)) await walk(path);
  return { bytes: total, gb: bytesToGb(total), files };
}

async function listImmediateDirs(path) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(path, entry.name));
  } catch {
    return [];
  }
}

async function listImmediateFiles(path) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => join(path, entry.name));
  } catch {
    return [];
  }
}

async function removeCandidate(candidate) {
  if (!apply) return { removed: false, reason: 'dry_run' };
  await rm(candidate.path, { recursive: true, force: true });
  return { removed: true, reason: 'apply' };
}

async function main() {
  const env = existsSync(envPath) ? parseEnv(await readFile(envPath, 'utf8')) : {};
  const dataDir = resolve(root, env.PL_CHAT_DATA_DIR || 'pl-chat-data');
  const workspacePath = join(dataDir, 'pl-chat-workspace.json');
  const minioDataDir = process.env.MINIO_DATA_DIR || env.MINIO_DATA_DIR || 'C:\\minio\\data';
  const uploadTempDir = resolve(root, env.UPLOAD_TEMP_DIR || join(dataDir, 'tmp', 'uploads'));
  const localUploadsDir = join(dataDir, 'uploads');
  const state = existsSync(workspacePath) ? JSON.parse(await readFile(workspacePath, 'utf8')) : {};

  const uploads = Array.isArray(state.uploads) ? state.uploads : [];
  const multipartUploads = Array.isArray(state.multipartUploads) ? state.multipartUploads : [];
  const chunkUploads = Array.isArray(state.chunkUploads) ? state.chunkUploads : [];
  const messages = Array.isArray(state.messages) ? state.messages : [];
  const posts = Array.isArray(state.posts) ? state.posts : [];

  const activeUploadIds = new Set(uploads.filter((item) => !item.deletedAt).map((item) => item.id));
  const referencedUploadIds = new Set([
    ...messages.map((item) => item.attachmentId).filter(Boolean),
    ...posts.map((item) => item.attachmentId).filter(Boolean)
  ]);
  const activeMultipart = multipartUploads.filter((item) => !item.completedAt && !item.cancelledAt && !item.deletedAt);
  const abandonedMultipart = activeMultipart.filter((item) => ageHours(item.updatedAt || item.createdAt || item.expiresAt) >= staleHours || (item.expiresAt && new Date(item.expiresAt) < now));
  const activeChunk = chunkUploads.filter((item) => !item.completedAt && !item.cancelledAt && !item.deletedAt);
  const abandonedChunk = activeChunk.filter((item) => ageHours(item.updatedAt || item.createdAt || item.expiresAt) >= staleHours || (item.expiresAt && new Date(item.expiresAt) < now));

  const fsStats = {};
  for (const [name, path] of Object.entries({ project: root, minio: minioDataDir })) {
    try {
      const value = await statfs(path);
      const total = Number(value.blocks) * Number(value.bsize);
      const free = Number(value.bavail) * Number(value.bsize);
      const used = Math.max(0, total - free);
      const usedPercent = total ? Math.round((used / total) * 10000) / 100 : 0;
      fsStats[name] = {
        path,
        totalGb: bytesToGb(total),
        usedGb: bytesToGb(used),
        freeGb: bytesToGb(free),
        usedPercent,
        alert: alertLevel(usedPercent),
        thresholds
      };
    } catch (error) {
      fsStats[name] = { path, error: error.message, alert: 'unknown', thresholds };
    }
  }

  const localUploadFiles = await listImmediateFiles(localUploadsDir);
  const referencedLocalKeys = new Set(
    uploads
      .filter((item) => !item.deletedAt && (item.storageDriver || 'local') === 'local')
      .map((item) => item.storageKey || basename(String(item.url || '')))
      .filter(Boolean)
  );
  const localOrphanFiles = [];
  for (const path of localUploadFiles) {
    const info = await safeStat(path);
    const name = basename(path);
    if (!info || referencedLocalKeys.has(name)) continue;
    const days = ageDays(info.mtime);
    if (days >= localOrphanRetentionDays) {
      localOrphanFiles.push({ type: 'local_orphan_file', path, name, bytes: info.size, ageDays: Math.round(days * 10) / 10 });
    }
  }

  const tempDirs = await listImmediateDirs(uploadTempDir);
  const activeChunkIds = new Set(activeChunk.map((item) => item.id));
  const tempUploadCandidates = [];
  for (const path of tempDirs) {
    const info = await safeStat(path);
    const name = basename(path);
    if (!info || activeChunkIds.has(name)) continue;
    const hours = ageHours(info.mtime);
    if (hours >= staleHours) {
      tempUploadCandidates.push({ type: 'stale_temp_upload_dir', path, name, ageHours: Math.round(hours * 10) / 10 });
    }
  }

  const deletedRecordsPastRetention = uploads.filter((item) =>
    item.deletedAt && ageDays(item.deletedAt) >= deletedRecordRetentionDays && !referencedUploadIds.has(item.id)
  );

  const candidates = [...tempUploadCandidates, ...localOrphanFiles];
  const cleanupResults = [];
  for (const candidate of candidates) {
    cleanupResults.push({ ...candidate, ...(await removeCandidate(candidate)) });
  }

  const minioSize = await dirSize(minioDataDir);
  const localUploadsSize = await dirSize(localUploadsDir);
  const tempUploadsSize = await dirSize(uploadTempDir);
  const activeBytes = uploads.filter((item) => !item.deletedAt).reduce((sum, item) => sum + Number(item.size || 0), 0);
  const deletedBytes = uploads.filter((item) => item.deletedAt).reduce((sum, item) => sum + Number(item.size || 0), 0);

  const hardFail = Object.values(fsStats).some((item) => item.alert === 'critical');
  const warn = Object.values(fsStats).some((item) => ['warning', 'error'].includes(item.alert));
  const report = {
    ok: !hardFail,
    mode: apply ? 'apply' : 'dry-run',
    generatedAt: now.toISOString(),
    thresholds,
    staleHours,
    retention: {
      localOrphanRetentionDays,
      deletedRecordRetentionDays
    },
    disk: fsStats,
    storage: {
      activeUploads: uploads.filter((item) => !item.deletedAt).length,
      deletedUploads: uploads.filter((item) => item.deletedAt).length,
      activeGb: bytesToGb(activeBytes),
      deletedGb: bytesToGb(deletedBytes),
      localUploadsSize,
      tempUploadsSize,
      minioSize
    },
    multipart: {
      active: activeMultipart.length,
      abandoned: abandonedMultipart.length,
      abandonedIds: abandonedMultipart.map((item) => item.id),
      activeChunk: activeChunk.length,
      abandonedChunk: abandonedChunk.length,
      abandonedChunkIds: abandonedChunk.map((item) => item.id)
    },
    cleanup: {
      candidates: candidates.length,
      removed: cleanupResults.filter((item) => item.removed).length,
      results: cleanupResults
    },
    retentionCandidates: {
      deletedRecordsPastRetention: deletedRecordsPastRetention.length,
      deletedRecordIds: deletedRecordsPastRetention.map((item) => item.id)
    },
    gate: {
      cleanupDoesNotDeleteActiveFiles: cleanupResults.every((item) => item.type !== 'local_orphan_file' || !activeUploadIds.has(item.name)),
      diskNotCritical: !hardFail,
      attentionRequired: warn || abandonedMultipart.length > 0 || abandonedChunk.length > 0 || candidates.length > 0
    }
  };

  await mkdir(reportDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(reportDir, `phase-g-storage-safety-${stamp}.json`);
  const latestJsonPath = join(reportDir, 'latest.json');
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(latestJsonPath, JSON.stringify(report, null, 2), 'utf8');

  const md = [
    '# Phase G Storage Safety Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    '',
    '## Disk thresholds',
    '',
    '| Target | Used | Free | Alert |',
    '| --- | ---: | ---: | --- |',
    ...Object.entries(report.disk).map(([name, item]) => `| ${name} | ${item.usedPercent ?? 'n/a'}% | ${item.freeGb ?? 'n/a'} GB | ${item.alert} |`),
    '',
    '## Storage summary',
    '',
    `- Active uploads: ${report.storage.activeUploads} (${report.storage.activeGb} GB metadata total)`,
    `- Deleted uploads retained: ${report.storage.deletedUploads} (${report.storage.deletedGb} GB metadata total)`,
    `- MinIO data size scan: ${report.storage.minioSize.gb} GB / ${report.storage.minioSize.files} files`,
    `- Local upload folder: ${report.storage.localUploadsSize.gb} GB / ${report.storage.localUploadsSize.files} files`,
    `- Temp upload folder: ${report.storage.tempUploadsSize.gb} GB / ${report.storage.tempUploadsSize.files} files`,
    '',
    '## Multipart / temp cleanup',
    '',
    `- Active multipart sessions: ${report.multipart.active}`,
    `- Abandoned multipart sessions: ${report.multipart.abandoned}`,
    `- Active chunk sessions: ${report.multipart.activeChunk}`,
    `- Abandoned chunk sessions: ${report.multipart.abandonedChunk}`,
    `- Cleanup candidates: ${report.cleanup.candidates}`,
    `- Removed: ${report.cleanup.removed}`,
    '',
    '## Gate',
    '',
    `- Cleanup does not delete active files: ${report.gate.cleanupDoesNotDeleteActiveFiles ? 'PASS' : 'FAIL'}`,
    `- Disk not critical (<95%): ${report.gate.diskNotCritical ? 'PASS' : 'FAIL'}`,
    `- Attention required: ${report.gate.attentionRequired ? 'YES' : 'NO'}`,
    '',
    '## Notes',
    '',
    '- Default mode is dry-run. Use `--apply` only after reviewing `latest.json`.',
    '- S3/MinIO object deletion is intentionally not automatic in Phase G step 1. The safe cleanup path first targets stale local temp upload directories and local orphan files only.',
    '- For MinIO multipart objects, use PL CHAT abandoned-upload cleanup or MinIO lifecycle after backup/restore gates are ready.'
  ].join('\n');
  const mdPath = join(reportDir, 'latest.md');
  await writeFile(mdPath, md, 'utf8');

  if (!jsonOnly) {
    console.log(md);
    console.log('');
    console.log(`JSON: ${jsonPath}`);
    console.log(`Latest: ${latestJsonPath}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
  process.exitCode = hardFail ? 2 : warn ? 1 : 0;
}

main().catch((error) => {
  console.error(`Phase G storage safety failed: ${error.message}`);
  process.exitCode = 3;
});
