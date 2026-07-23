const completedStates = new Set(['completed', 'complete', 'succeeded', 'success', 'done']);
const failedStates = new Set(['failed', 'error', 'cancelled', 'canceled']);

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function safeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

export class KaveepClientError extends Error {
  constructor(code, message = code, statusCode = 502) {
    super(message);
    this.name = 'KaveepClientError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function createKaveepClient({ baseUrl, serviceToken, timeoutMs }) {
  const apiBaseUrl = cleanBaseUrl(baseUrl);
  const token = String(serviceToken || '').trim();
  const requestTimeoutMs = Math.max(1000, Number(timeoutMs) || 90000);

  function configured() {
    return Boolean(apiBaseUrl && token);
  }

  async function request(path, options = {}) {
    if (!configured()) throw new KaveepClientError('kaveep_not_configured', 'KAVEEP is not configured.', 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(`${apiBaseUrl}${path}`, {
        method: options.method || 'GET',
        headers: {
          accept: 'application/json',
          // This module is server-only.  Never return this header or token in a
          // public task/config response.
          authorization: `Bearer ${token}`,
          ...(options.headers || {}),
          ...(options.body ? { 'content-type': 'application/json' } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
      const contentType = String(response.headers.get('content-type') || '');
      const payload = contentType.includes('application/json')
        ? await response.json().catch(() => ({}))
        : {};
      if (!response.ok) {
        const remoteCode = String(payload?.error?.code || payload?.code || '').trim();
        const code = response.status === 401 || response.status === 403
          ? 'kaveep_auth_failed'
          : remoteCode === 'local_llm_unavailable' ? 'kaveep_local_llm_unavailable'
          : 'kaveep_request_failed';
        throw new KaveepClientError(code, code, response.status >= 500 ? 502 : 424);
      }
      return payload && typeof payload === 'object' ? payload : {};
    } catch (error) {
      if (error instanceof KaveepClientError) throw error;
      if (error?.name === 'AbortError') throw new KaveepClientError('kaveep_timeout', 'KAVEEP request timed out.', 504);
      throw new KaveepClientError('kaveep_unavailable', 'KAVEEP is unavailable.', 503);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    configured,
    async health() {
      return request('/health');
    },
    async chat(payload) {
      return request('/api/integrations/pl-chat/chat', { method: 'POST', body: payload, headers: { 'idempotency-key': `plchat-chat-${payload.taskId}` } });
    },
    async generateImage(payload) {
      return request('/api/integrations/pl-chat/images', { method: 'POST', body: payload, headers: { 'idempotency-key': `plchat-image-${payload.taskId}` } });
    },
    async taskStatus({ taskId, roomId, userId, consent = true }) {
      const query = new URLSearchParams({ taskId, roomId, userId, consent: String(consent) });
      return request(`/api/integrations/pl-chat/tasks/${encodeURIComponent(taskId)}?${query}`);
    },
    async cancelTask({ taskId, roomId, userId, consent = true }) {
      return request(`/api/integrations/pl-chat/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: 'POST', body: { taskId, roomId, userId, consent }
      });
    },
    normalizeChat(payload) {
      const result = payload.result || payload.data || payload.output || payload;
      return {
        text: String(result.message || result.reply || result.text || result.content || '').trim(),
        taskId: String(result.taskId || result.task_id || result.id || payload.taskId || payload.task_id || '').trim() || null,
        status: completedStates.has(safeStatus(payload.status || result.status)) ? 'completed' : failedStates.has(safeStatus(payload.status || result.status)) ? 'failed' : 'processing',
        raw: payload
      };
    },
    normalizeImage(payload) {
      const result = payload.result || payload.data || payload.output || payload;
      const status = safeStatus(result.status || payload.status);
      const jobId = String(result.taskId || result.task_id || result.jobId || result.job_id || result.id || payload.taskId || payload.task_id || payload.jobId || '').trim() || null;
      const imageUrl = String(result.imageUrl || result.url || result.downloadUrl || result.outputUrl || '').trim() || null;
      const thumbnailUrl = String(result.thumbnailUrl || result.previewUrl || imageUrl || '').trim() || null;
      return {
        status: completedStates.has(status) || imageUrl ? 'completed' : failedStates.has(status) ? 'failed' : 'processing',
        jobId,
        text: String(result.message || result.prompt || '').trim(),
        imageUrl,
        thumbnailUrl,
        raw: payload
      };
    }
  };
}
