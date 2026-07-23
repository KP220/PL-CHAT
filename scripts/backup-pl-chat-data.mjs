import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(source, target, manifest) {
  if (!(await exists(source))) {
    manifest.skipped.push(source);
    return;
  }
  await cp(source, target, { recursive: true, force: true, errorOnExist: false });
  manifest.copied.push({ from: source, to: target });
}

async function main() {
  const backupRoot = join(rootDir, '.backups');
  const backupDir = join(backupRoot, `pl-chat-phase-a-${timestamp()}`);
  await mkdir(backupDir, { recursive: true });

  const manifest = {
    createdAt: new Date().toISOString(),
    cwd: rootDir,
    copied: [],
    skipped: []
  };

  const entries = [
    'pl-chat-data',
    'trial-data',
    '.env.example',
    '.env.production.example',
    '.env.local.example',
    '.env.production',
    'apps/api/prisma/schema.prisma',
    'trial-server/server.mjs',
    'trial-server/public/index.html'
  ];

  for (const entry of entries) {
    const source = join(rootDir, entry);
    const target = join(backupDir, entry);
    await mkdir(join(target, '..'), { recursive: true });
    await copyIfExists(source, target, manifest);
  }

  await writeFile(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  if (!existsSync(backupDir)) throw new Error('Backup directory was not created.');
  console.log(`PL CHAT backup created: ${backupDir}`);
  console.log(`Copied: ${manifest.copied.length}, skipped: ${manifest.skipped.length}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
