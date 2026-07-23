import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const reportDir = join(root, 'pl-chat-data', 'file-transfer-acceptance');
const tunnelStatusPath = join(root, 'pl-chat-data', 'tunnels', 'quick-tunnel-status.json');

function check(name, pass, level, detail) {
  return { name, pass: Boolean(pass), level, detail };
}

async function readJson(path) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
}

async function fetchWithTimeout(url, options = {}, ms = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const checks = [];
  const status = existsSync(tunnelStatusPath) ? await readJson(tunnelStatusPath) : {};
  const appUrl = String(process.env.PL_CHAT_TUNNEL_URL || status.appUrl || '').replace(/\/+$/, '');
  const email = process.env.PL_CHAT_ACCEPTANCE_EMAIL || '';
  const password = process.env.PL_CHAT_ACCEPTANCE_PASSWORD || '';
  checks.push(check('Quick Tunnel app URL exists', Boolean(appUrl), 'critical', appUrl || 'missing'));
  checks.push(check('Acceptance credentials configured', Boolean(email && password), 'critical', 'Required for thumbnail/preview/original and signed transfer checks.'));

  let token = '';
  if (appUrl && email && password) {
    const login = await fetchWithTimeout(`${appUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: appUrl },
      body: JSON.stringify({ email, password, rememberDevice: false })
    }).catch((error) => ({ error }));
    const loginBody = login.json ? await login.json().catch(() => ({})) : {};
    token = loginBody.token || '';
    checks.push(check('Tunnel login works', login.status === 200 && token, 'critical', `status=${login.status || login.error?.message || 'none'}`));
  }

  if (appUrl && token) {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
    const upload = await fetchWithTimeout(`${appUrl}/api/uploads/binary?name=phase-m-thumbnail-smoke.png`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/png',
        Origin: appUrl
      },
      body: png
    }).catch((error) => ({ error }));
    const uploadBody = upload.json ? await upload.json().catch(() => ({})) : {};
    const file = uploadBody.attachment || uploadBody.file || uploadBody.attachments?.[0];
    checks.push(check('Image upload for thumbnail acceptance', upload.status === 201 && file?.id, 'critical', `status=${upload.status || upload.error?.message || 'none'}`));
    checks.push(check('Metadata exposes thumbnailUrl', Boolean(file?.thumbnailUrl), 'high', file?.thumbnailUrl || 'missing'));

    if (file?.thumbnailUrl) {
      const thumb = await fetchWithTimeout(`${appUrl}${file.thumbnailUrl}`, { headers: { Authorization: `Bearer ${token}`, Origin: appUrl } }).catch((error) => ({ error }));
      checks.push(check('Thumbnail URL returns HTTP 200', thumb.status === 200, 'high', `status=${thumb.status || thumb.error?.message || 'none'}`));
    }
    if (file?.previewUrl) {
      const preview = await fetchWithTimeout(`${appUrl}${file.previewUrl}`, { headers: { Authorization: `Bearer ${token}`, Origin: appUrl } }).catch((error) => ({ error }));
      checks.push(check('Preview URL returns HTTP 200', preview.status === 200, 'high', `status=${preview.status || preview.error?.message || 'none'}`));
    }
    if (file?.downloadUrl) {
      const original = await fetchWithTimeout(`${appUrl}${file.downloadUrl}`, { headers: { Authorization: `Bearer ${token}`, Range: 'bytes=0-0', Origin: appUrl } }).catch((error) => ({ error }));
      checks.push(check('Original download supports HTTP range', original.status === 206 || original.status === 200, 'high', `status=${original.status || original.error?.message || 'none'}`));
    }
    if (file?.id) {
      const signed = await fetchWithTimeout(`${appUrl}/api/files/${file.id}/signed-download`, { headers: { Authorization: `Bearer ${token}`, Origin: appUrl } }).catch((error) => ({ error }));
      checks.push(check('Signed download endpoint checked', [200, 400, 409].includes(Number(signed.status || 0)), 'high', `status=${signed.status || signed.error?.message || 'none'}`));
    }

    const settingsResponse = await fetchWithTimeout(`${appUrl}/api/files?limit=1`, { headers: { Authorization: `Bearer ${token}`, Origin: appUrl } }).catch((error) => ({ error }));
    const settings = settingsResponse.json ? await settingsResponse.json().catch(() => ({})) : {};
    checks.push(check('10GB+ upload limit exposed', Number(settings.maxMultipartUploadMb || 0) >= 10240, 'critical', `maxMultipartUploadMb=${settings.maxMultipartUploadMb || 'missing'}`));

    let multipartUploadId = '';
    const multipartInit = await fetchWithTimeout(`${appUrl}/api/uploads/multipart/init`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: appUrl },
      body: JSON.stringify({
        name: 'phase-m-10gb-signed-upload-smoke.bin',
        mimeType: 'application/octet-stream',
        size: 10 * 1024 * 1024 * 1024
      })
    }).catch((error) => ({ error }));
    const multipartBody = multipartInit.json ? await multipartInit.json().catch(() => ({})) : {};
    multipartUploadId = multipartBody.upload?.uploadId || multipartBody.upload?.id || '';
    checks.push(check('10GB multipart initialization through tunnel', multipartInit.status === 201 && multipartUploadId, 'critical', `status=${multipartInit.status || multipartInit.error?.message || 'none'}`));
    if (multipartUploadId) {
      const partUrl = await fetchWithTimeout(`${appUrl}/api/uploads/multipart/${encodeURIComponent(multipartUploadId)}/part-url`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: appUrl },
        body: JSON.stringify({ partNumber: 1 })
      }).catch((error) => ({ error }));
      const partUrlBody = partUrl.json ? await partUrl.json().catch(() => ({})) : {};
      checks.push(check('Signed upload part URL issued through tunnel', partUrl.status === 200 && /^https:\/\//i.test(partUrlBody.part?.url || ''), 'critical', `status=${partUrl.status || partUrl.error?.message || 'none'}`));
      await fetchWithTimeout(`${appUrl}/api/uploads/multipart/${encodeURIComponent(multipartUploadId)}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: appUrl },
        body: '{}'
      }).catch(() => {});
    }
  }

  const failed = checks.filter((item) => !item.pass);
  const report = {
    phase: 'M',
    generatedAt: new Date().toISOString(),
    status: failed.length ? 'HOLD' : 'PASS',
    appUrl,
    checks
  };
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, 'latest.json'), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(join(reportDir, 'latest.md'), [
    '# Phase M File Transfer Acceptance',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    `App URL: ${appUrl || 'missing'}`,
    '',
    '| Check | Result | Level | Detail |',
    '| --- | --- | --- | --- |',
    ...checks.map((item) => `| ${item.name} | ${item.pass ? 'PASS' : 'HOLD'} | ${item.level} | ${String(item.detail || '').replaceAll('|', '/')} |`)
  ].join('\n'), 'utf8');
  console.log(`${report.status}: ${checks.filter((item) => item.pass).length}/${checks.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error(`Phase M file transfer acceptance failed: ${error.message}`);
  process.exitCode = 2;
});
