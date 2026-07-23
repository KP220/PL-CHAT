import { createHash, createHmac } from 'node:crypto';

const encode = (value) => encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value, encoding) => createHmac('sha256', key).update(value).digest(encoding);
const sortByCodePoint = ([left], [right]) => left < right ? -1 : left > right ? 1 : 0;

function timestamp(now = new Date()) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function signingKey(secret, date, region, service) {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, 'aws4_request');
}

function parseXmlValue(xml, name) {
  const match = String(xml).match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match?.[1]?.trim() || '';
}

export function createS3MultipartStorage(env = process.env) {
  const endpoint = String(env.S3_ENDPOINT || '').replace(/\/+$/, '');
  const publicEndpoint = String(env.S3_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const bucket = String(env.S3_BUCKET || '');
  const region = String(env.S3_REGION || 'auto');
  const accessKeyId = String(env.S3_ACCESS_KEY_ID || '');
  const secretAccessKey = String(env.S3_SECRET_ACCESS_KEY || '');
  const sessionToken = String(env.S3_SESSION_TOKEN || '');
  const forcePathStyle = String(env.S3_FORCE_PATH_STYLE || 'true').toLowerCase() !== 'false';
  const ready = Boolean(endpoint && bucket && accessKeyId && secretAccessKey);
  const publicReady = Boolean(publicEndpoint && /^https:\/\//i.test(publicEndpoint));

  function objectUrl(key, selectedEndpoint = endpoint) {
    const encodedKey = String(key).split('/').map(encode).join('/');
    const base = new URL(selectedEndpoint);
    if (forcePathStyle) {
      base.pathname = `${base.pathname.replace(/\/$/, '')}/${encode(bucket)}/${encodedKey}`;
    } else {
      base.hostname = `${bucket}.${base.hostname}`;
      base.pathname = `${base.pathname.replace(/\/$/, '')}/${encodedKey}`;
    }
    return base;
  }

  function presign({ method, key, query = {}, expiresSeconds = 1800, now = new Date(), selectedEndpoint = publicEndpoint || endpoint }) {
    if (!ready) throw new Error('s3_multipart_not_configured');
    const url = objectUrl(key, selectedEndpoint);
    const amzDate = timestamp(now);
    const date = amzDate.slice(0, 8);
    const scope = `${date}/${region}/s3/aws4_request`;
    const params = {
      ...query,
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresSeconds),
      'X-Amz-SignedHeaders': 'host',
    };
    if (sessionToken) params['X-Amz-Security-Token'] = sessionToken;
    const canonicalQuery = Object.entries(params)
      .sort(sortByCodePoint)
      .map(([name, value]) => `${encode(name)}=${encode(value)}`)
      .join('&');
    const canonicalRequest = [
      method,
      url.pathname,
      canonicalQuery,
      `host:${url.host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonicalRequest)].join('\n');
    params['X-Amz-Signature'] = hmac(signingKey(secretAccessKey, date, region, 's3'), stringToSign, 'hex');
    url.search = Object.entries(params)
      .sort(sortByCodePoint)
      .map(([name, value]) => `${encode(name)}=${encode(value)}`)
      .join('&');
    return url.toString();
  }

  async function signedRequest({ method, key, query = {}, body = '' }) {
    const url = presign({ method, key, query, expiresSeconds: 300, selectedEndpoint: endpoint });
    const response = await fetch(url, { method, body: body || undefined });
    const text = await response.text();
    if (!response.ok) throw new Error(`s3_multipart_request_failed:${response.status}:${parseXmlValue(text, 'Code') || 'unknown'}`);
    return text;
  }

  return {
    ready,
    publicReady,
    endpoint,
    publicEndpoint,
    presignDownload({ key, fileName = 'download', mimeType = 'application/octet-stream', disposition = 'attachment', expiresSeconds = 900, selectedEndpoint = publicEndpoint || endpoint }) {
      const safeDisposition = disposition === 'inline' ? 'inline' : 'attachment';
      const escapedName = String(fileName || 'download').replaceAll('\\', '_').replaceAll('"', "'");
      return presign({
        method: 'GET',
        key,
        query: {
          'response-content-disposition': `${safeDisposition}; filename="${escapedName}"`,
          'response-content-type': String(mimeType || 'application/octet-stream')
        },
        expiresSeconds,
        selectedEndpoint
      });
    },
    presignInternalDownload({ key, fileName = 'download', mimeType = 'application/octet-stream', disposition = 'attachment', expiresSeconds = 900 }) {
      const safeDisposition = disposition === 'inline' ? 'inline' : 'attachment';
      const escapedName = String(fileName || 'download').replaceAll('\\', '_').replaceAll('"', "'");
      return presign({
        method: 'GET',
        key,
        query: {
          'response-content-disposition': `${safeDisposition}; filename="${escapedName}"`,
          'response-content-type': String(mimeType || 'application/octet-stream')
        },
        expiresSeconds,
        selectedEndpoint: endpoint
      });
    },
    presignUploadPart({ key, uploadId, partNumber, expiresSeconds }) {
      const safeExpiresSeconds = Number(expiresSeconds || 1800);
      return {
        url: presign({ method: 'PUT', key, query: { partNumber, uploadId }, expiresSeconds: safeExpiresSeconds }),
        expiresAt: new Date(Date.now() + safeExpiresSeconds * 1000).toISOString(),
      };
    },
    async createMultipartUpload({ key }) {
      const xml = await signedRequest({ method: 'POST', key, query: { uploads: '' } });
      const uploadId = parseXmlValue(xml, 'UploadId');
      if (!uploadId) throw new Error('s3_multipart_upload_id_missing');
      return { uploadId };
    },
    async completeMultipartUpload({ key, uploadId, parts }) {
      const body = `<CompleteMultipartUpload>${parts.map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${String(part.etag).replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
      return signedRequest({ method: 'POST', key, query: { uploadId }, body });
    },
    async abortMultipartUpload({ key, uploadId }) {
      return signedRequest({ method: 'DELETE', key, query: { uploadId } });
    },
  };
}
