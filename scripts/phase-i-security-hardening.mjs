import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = new Set(process.argv.slice(2));
const jsonOnly = args.has('--json');
const now = new Date();
const envPath = join(root, '.env.production');
const serverPath = join(root, 'trial-server', 'server.mjs');

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

function issue(level, code, message, target, remediation) {
  return { level, code, message, target, remediation };
}

function isPlaceholder(value) {
  return /^(change-me|changeme|password|secret|default|example|test)$/i.test(String(value || '').trim());
}

function looksShortSecret(value) {
  return String(value || '').trim().length > 0 && String(value || '').trim().length < 32;
}

function publicUrlOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function renderMarkdown(report) {
  const byLevel = report.issues.reduce((acc, item) => {
    acc[item.level] = (acc[item.level] || 0) + 1;
    return acc;
  }, {});
  return [
    '# Phase I Security Hardening Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: ${report.gate.pass ? 'PASS' : 'HOLD'}`,
    '',
    '## Summary',
    '',
    `- Critical: ${byLevel.critical || 0}`,
    `- High: ${byLevel.high || 0}`,
    `- Medium: ${byLevel.medium || 0}`,
    `- Low: ${byLevel.low || 0}`,
    '',
    '## Gate',
    '',
    `- No placeholder app secrets: ${report.gate.noPlaceholderAppSecrets ? 'PASS' : 'FAIL'}`,
    `- Security headers present: ${report.gate.securityHeadersPresent ? 'PASS' : 'FAIL'}`,
    `- CORS wildcard removed: ${report.gate.corsWildcardRemoved ? 'PASS' : 'FAIL'}`,
    `- Public unauthenticated health is minimal: ${report.gate.minimalPublicHealth ? 'PASS' : 'FAIL'}`,
    `- Allowed origins configured: ${report.gate.allowedOriginsConfigured ? 'PASS' : 'FAIL'}`,
    '',
    '## Issues',
    '',
    report.issues.length
      ? '| Level | Code | Target | Remediation |\n| --- | --- | --- | --- |\n' + report.issues
        .map((item) => `| ${item.level} | ${item.code} | ${item.target} | ${item.remediation} |`)
        .join('\n')
      : 'No open issues.',
    '',
    '## Notes',
    '',
    '- This report intentionally does not print secret values.',
    '- Service credentials such as SMTP, database, and MinIO must be rotated together with their backing services.',
    '- Keep backup/restore gates green before rotating service credentials.'
  ].join('\n');
}

async function main() {
  const envText = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
  const serverText = existsSync(serverPath) ? await readFile(serverPath, 'utf8') : '';
  const env = parseEnv(envText);
  const issues = [];

  for (const key of ['SESSION_SECRET', 'JWT_SECRET', 'AUTH_SECRET']) {
    if (!env[key]) {
      issues.push(issue('critical', 'missing_app_secret', `${key} is not set.`, key, 'Set a unique 48+ byte random value.'));
    } else if (isPlaceholder(env[key])) {
      issues.push(issue('critical', 'placeholder_app_secret', `${key} uses a placeholder.`, key, 'Replace with a unique random value.'));
    } else if (looksShortSecret(env[key])) {
      issues.push(issue('high', 'short_app_secret', `${key} is shorter than recommended.`, key, 'Use a 48+ byte random value.'));
    }
  }

  const publicOrigin = publicUrlOrigin(env.APP_PUBLIC_URL || '');
  const allowedOrigins = String(env.PL_CHAT_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (!allowedOrigins.length) {
    issues.push(issue('high', 'missing_allowed_origins', 'CORS allowed origins are not configured.', 'PL_CHAT_ALLOWED_ORIGINS', 'Set this to the production public origin.'));
  } else if (publicOrigin && !allowedOrigins.includes(publicOrigin)) {
    issues.push(issue('medium', 'public_origin_not_allowed', 'APP_PUBLIC_URL origin is not in PL_CHAT_ALLOWED_ORIGINS.', 'PL_CHAT_ALLOWED_ORIGINS', 'Add the APP_PUBLIC_URL origin.'));
  }

  if ((env.APP_ENV || '').toLowerCase() === 'production' && !String(env.APP_PUBLIC_URL || '').startsWith('https://')) {
    issues.push(issue('high', 'public_url_not_https', 'Production public URL is not HTTPS.', 'APP_PUBLIC_URL', 'Use an HTTPS public URL.'));
  }

  if (isPlaceholder(env.DATABASE_URL || '') || /phaseb_password|password/i.test(env.DATABASE_URL || '')) {
    issues.push(issue('medium', 'database_password_rotation_recommended', 'Database URL appears to use a weak or phase-default password.', 'DATABASE_URL', 'Rotate the database password with a coordinated DB update.'));
  }

  if (isPlaceholder(env.S3_SECRET_ACCESS_KEY || '') || /minio-2026|password|secret/i.test(env.S3_SECRET_ACCESS_KEY || '')) {
    issues.push(issue('medium', 'minio_secret_rotation_recommended', 'MinIO secret appears environment-default.', 'S3_SECRET_ACCESS_KEY', 'Rotate MinIO credentials with the MinIO service config.'));
  }

  if (env.ALLOW_UNKNOWN_FILE_TYPES !== 'false') {
    issues.push(issue('low', 'unknown_file_types_allowed', 'Unknown file types are allowed.', 'ALLOW_UNKNOWN_FILE_TYPES', 'Consider setting false after confirming business file needs.'));
  }

  const gate = {
    noPlaceholderAppSecrets: !issues.some((item) => ['missing_app_secret', 'placeholder_app_secret', 'short_app_secret'].includes(item.code)),
    securityHeadersPresent: ['X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Resource-Policy'].every((needle) => serverText.includes(needle)),
    corsWildcardRemoved: !serverText.includes("'Access-Control-Allow-Origin': '*'") && !serverText.includes('"Access-Control-Allow-Origin": "*"'),
    minimalPublicHealth: serverText.includes("if (!user)") && serverText.includes("generatedAt: nowIso()"),
    allowedOriginsConfigured: allowedOrigins.length > 0
  };
  gate.pass = gate.noPlaceholderAppSecrets && gate.securityHeadersPresent && gate.corsWildcardRemoved && gate.minimalPublicHealth && gate.allowedOriginsConfigured;

  const dataDir = resolve(root, env.PL_CHAT_DATA_DIR || 'pl-chat-data');
  const reportDir = join(dataDir, 'security-hardening');
  const report = {
    phase: 'I',
    generatedAt: now.toISOString(),
    issues,
    gate
  };

  await mkdir(reportDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  await writeFile(join(reportDir, `phase-i-security-hardening-${stamp}.json`), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(join(reportDir, 'latest.json'), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(join(reportDir, 'latest.md'), renderMarkdown(report), 'utf8');

  if (jsonOnly) console.log(JSON.stringify(report, null, 2));
  else console.log(renderMarkdown(report));
  process.exitCode = gate.pass ? 0 : 1;
}

main().catch((error) => {
  console.error(`Phase I security hardening failed: ${error.message}`);
  process.exitCode = 2;
});
