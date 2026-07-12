import { MAX_MEDIA_BYTES } from './assets.mjs';

const DEFAULT_BASE_URL = 'https://open.feishu.cn';
const AUTH_PATH = '/open-apis/auth/v3/tenant_access_token/internal';
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_FEISHU_CODES = new Set([
  99991400,
  1254290,
  1254607,
  1255040,
]);
const MAX_RETRIES = 4;
const PAGE_SIZE = 500;
const PUBLISHED_FILTER = 'CurrentValue.[状态]="已发布"';

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function pathSegment(value, name) {
  return encodeURIComponent(requiredString(value, name));
}

function buildUrl(baseUrl, path, query) {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new Error('Feishu request path must be an absolute API path.');
  }

  const url = new URL(path, baseUrl);
  if (
    url.origin !== baseUrl.origin ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error('Feishu request path must stay on the configured API origin.');
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function mediaLimitError() {
  return new Error('Feishu media exceeds the 10 MiB single-file limit.');
}

async function readMediaBytes(response) {
  const declaredLength = response.headers.get('content-length');
  if (/^\d+$/.test(declaredLength ?? '')) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length > MAX_MEDIA_BYTES) {
      throw mediaLimitError();
    }
  }

  if (response.body === null || typeof response.body.getReader !== 'function') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_MEDIA_BYTES) throw mediaLimitError();
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    total += chunk.byteLength;
    if (total > MAX_MEDIA_BYTES) {
      await reader.cancel().catch(() => {});
      throw mediaLimitError();
    }
    chunks.push(chunk);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function responsePayload(response, context) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      `Feishu ${context} returned HTTP ${response.status} with invalid JSON.`,
    );
  }

  const code = payload?.code;
  const message = typeof payload?.msg === 'string' ? payload.msg : 'unknown error';
  if (!response.ok) {
    throw new Error(
      `Feishu ${context} failed with HTTP ${response.status}` +
        `${code === undefined ? '' : `, code ${String(code)}`}: ${message}.`,
    );
  }
  if (typeof code !== 'number') {
    throw new Error(`Feishu ${context} response has no numeric code.`);
  }
  if (code !== 0) {
    throw new Error(`Feishu ${context} failed with code ${code}: ${message}.`);
  }
  return payload;
}

async function isRetryableResponse(response) {
  if (RETRYABLE_STATUS.has(response.status)) {
    return true;
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('json')) {
    return false;
  }
  try {
    const payload = await response.clone().json();
    return RETRYABLE_FEISHU_CODES.has(payload?.code);
  } catch {
    return false;
  }
}

function createScheduler({ minIntervalMs, sleep, now }) {
  let tail = Promise.resolve();
  let lastStartedAt = Number.NEGATIVE_INFINITY;

  return function schedule(task) {
    const running = tail.then(async () => {
      const waitMs = Math.max(0, lastStartedAt + minIntervalMs - now());
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      lastStartedAt = now();
      return task();
    });
    tail = running.catch(() => undefined);
    return running;
  };
}

export function createFeishuClientFromEnv({ env = process.env, ...options } = {}) {
  const missing = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET'].filter(
    (name) => typeof env[name] !== 'string' || env[name].trim().length === 0,
  );
  if (missing.length > 0) {
    throw new Error(`Missing required Feishu environment variables: ${missing.join(', ')}.`);
  }

  return createFeishuClient({
    ...options,
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
  });
}

export function createFeishuClient({
  appId,
  appSecret,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  random = Math.random,
  now = Date.now,
  minIntervalMs = 210,
  baseUrl = DEFAULT_BASE_URL,
} = {}) {
  requiredString(appId, 'appId');
  requiredString(appSecret, 'appSecret');
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl must be a function.');
  if (typeof sleep !== 'function') throw new Error('sleep must be a function.');
  if (typeof random !== 'function') throw new Error('random must be a function.');
  if (typeof now !== 'function') throw new Error('now must be a function.');
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
    throw new Error('minIntervalMs must be a non-negative number.');
  }

  const trustedBaseUrl = new URL(baseUrl);
  if (trustedBaseUrl.protocol !== 'https:') {
    throw new Error('Feishu baseUrl must use HTTPS.');
  }
  const schedule = createScheduler({ minIntervalMs, sleep, now });
  let tokenPromise;

  async function fetchWithRetry(url, init, context) {
    let response;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        response = await schedule(() => fetchImpl(url, init));
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          throw new Error(`Feishu ${context} network request failed: ${error.message}.`);
        }
        const delay = 500 * 2 ** attempt + Math.floor(random() * 251);
        await sleep(delay);
        continue;
      }

      if (!(await isRetryableResponse(response)) || attempt === MAX_RETRIES) {
        return response;
      }

      await response.arrayBuffer().catch(() => undefined);
      const delay = 500 * 2 ** attempt + Math.floor(random() * 251);
      await sleep(delay);
    }
    return response;
  }

  async function fetchTenantAccessToken() {
    const url = buildUrl(trustedBaseUrl, AUTH_PATH);
    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      },
      `POST ${AUTH_PATH}`,
    );
    const payload = await responsePayload(response, `POST ${AUTH_PATH}`);
    return requiredString(payload.tenant_access_token, 'tenant_access_token');
  }

  function getTenantAccessToken() {
    if (tokenPromise === undefined) {
      tokenPromise = fetchTenantAccessToken().catch((error) => {
        tokenPromise = undefined;
        throw error;
      });
    }
    return tokenPromise;
  }

  async function authenticatedResponse(
    path,
    { method = 'GET', query, body, headers, context = `${method} ${path}` } = {},
  ) {
    const url = buildUrl(trustedBaseUrl, path, query);
    const tenantAccessToken = await getTenantAccessToken();
    const requestHeaders = new Headers(headers);
    if (!requestHeaders.has('accept')) {
      requestHeaders.set('accept', 'application/json');
    }
    requestHeaders.set('authorization', `Bearer ${tenantAccessToken}`);
    requestHeaders.set('content-type', 'application/json; charset=utf-8');

    let requestBody = body;
    if (
      body !== undefined &&
      body !== null &&
      typeof body === 'object' &&
      !(body instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(body)
    ) {
      requestHeaders.set('content-type', 'application/json');
      requestBody = JSON.stringify(body);
    }

    return fetchWithRetry(
      url,
      { method, headers: requestHeaders, ...(requestBody === undefined ? {} : { body: requestBody }) },
      context,
    );
  }

  async function request(path, options = {}) {
    const method = options.method ?? 'GET';
    const context = `${method} ${path}`;
    const response = await authenticatedResponse(path, { ...options, context });
    const payload = await responsePayload(response, context);
    return payload.data;
  }

  async function collectPages(path, query, label) {
    const items = [];
    const seenTokens = new Set();
    let pageToken;

    while (true) {
      const data = await request(path, {
        query: {
          ...query,
          page_size: PAGE_SIZE,
          ...(pageToken === undefined ? {} : { page_token: pageToken }),
        },
      });
      const pageItems =
        data !== null &&
        typeof data === 'object' &&
        data.items === null &&
        data.has_more === false &&
        data.total === 0
          ? []
          : data?.items;
      if (!Array.isArray(pageItems)) {
        throw new Error(`Feishu ${label} pagination response has no items array.`);
      }
      items.push(...pageItems);

      if (data.has_more !== true) {
        return items;
      }

      const nextToken = data.page_token;
      if (
        typeof nextToken !== 'string' ||
        nextToken.length === 0 ||
        seenTokens.has(nextToken)
      ) {
        throw new Error(`Feishu ${label} pagination returned a missing or repeated page token.`);
      }
      seenTokens.add(nextToken);
      pageToken = nextToken;
    }
  }

  function listPublishedRecords(appToken, tableId) {
    const path =
      `/open-apis/bitable/v1/apps/${pathSegment(appToken, 'appToken')}` +
      `/tables/${pathSegment(tableId, 'tableId')}/records`;
    return collectPages(path, { filter: PUBLISHED_FILTER }, 'Bitable records');
  }

  async function getDocument(documentId) {
    const path = `/open-apis/docx/v1/documents/${pathSegment(documentId, 'documentId')}`;
    const data = await request(path);
    if (data?.document === null || typeof data?.document !== 'object') {
      throw new Error(`Feishu document "${documentId}" response has no document metadata.`);
    }
    return data.document;
  }

  function listDocumentBlocks(documentId, revisionId) {
    if (
      revisionId !== -1 &&
      (!Number.isInteger(revisionId) || revisionId < 1)
    ) {
      throw new Error('revisionId must be -1 or a positive integer.');
    }
    const path =
      `/open-apis/docx/v1/documents/${pathSegment(documentId, 'documentId')}/blocks`;
    return collectPages(
      path,
      { document_revision_id: revisionId },
      `document "${documentId}" blocks`,
    );
  }

  async function downloadMedia(fileToken, extra) {
    const path =
      `/open-apis/drive/v1/medias/${pathSegment(fileToken, 'fileToken')}/download`;
    const response = await authenticatedResponse(path, {
      query: extra === undefined ? undefined : { extra },
      headers: { accept: '*/*' },
      context: `GET ${path}`,
    });
    if (!response.ok) {
      await responsePayload(response, `GET ${path}`);
    }
    const contentType = response.headers.get('content-type');
    if (contentType === null || contentType.trim().length === 0) {
      throw new Error(`Feishu media "${fileToken}" response has no Content-Type.`);
    }
    return {
      bytes: await readMediaBytes(response),
      contentType,
    };
  }

  return Object.freeze({
    request,
    getTenantAccessToken,
    listPublishedRecords,
    getDocument,
    listDocumentBlocks,
    downloadMedia,
  });
}
