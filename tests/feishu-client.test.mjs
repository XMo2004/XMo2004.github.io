import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFeishuClient,
  createFeishuClientFromEnv,
} from '../scripts/feishu/client.mjs';
import {
  MAX_MEDIA_BYTES,
  contentAddressedMedia,
} from '../scripts/feishu/assets.mjs';

function json(value, init = {}) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function token() {
  return json({
    code: 0,
    expire: 7200,
    tenant_access_token: 'tenant-test-token',
  });
}

test('environment validation reports every missing Feishu credential', () => {
  assert.throws(
    () => createFeishuClientFromEnv({ env: {} }),
    (error) => {
      assert.match(error.message, /FEISHU_APP_ID/);
      assert.match(error.message, /FEISHU_APP_SECRET/);
      return true;
    },
  );
});

test('malicious request paths are rejected before credentials or tokens are used', async () => {
  const calls = [];
  const client = createFeishuClient({
    appId: 'id',
    appSecret: 'never-leak-this-secret',
    minIntervalMs: 0,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return token();
    },
  });

  for (const path of [
    '/\\attacker.example/collect',
    '/safe\npath',
    '//attacker.example/collect',
  ]) {
    await assert.rejects(
      () => client.request(path),
      (error) => {
        assert.doesNotMatch(error.message, /never-leak-this-secret|tenant-test-token/);
        return true;
      },
    );
  }
  assert.deepEqual(calls, []);
});

test('tenant token request posts credentials once and caches the token', async () => {
  const calls = [];
  const client = createFeishuClient({
    appId: 'cli_example',
    appSecret: 'secret-example',
    minIntervalMs: 0,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return token();
    },
  });

  assert.equal(await client.getTenantAccessToken(), 'tenant-test-token');
  assert.equal(await client.getTenantAccessToken(), 'tenant-test-token');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    app_id: 'cli_example',
    app_secret: 'secret-example',
  });
  assert.match(
    calls[0].url,
    /\/open-apis\/auth\/v3\/tenant_access_token\/internal$/,
  );
});

test('published records follow pagination and send the published filter', async () => {
  const dataUrls = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.includes('/auth/')) return token();
    dataUrls.push(parsed);
    if (parsed.searchParams.get('page_token') === null) {
      return json({
        code: 0,
        data: {
          has_more: true,
          page_token: 'next page',
          items: [{ record_id: 'rec-a', fields: {} }],
        },
      });
    }
    return json({
      code: 0,
      data: {
        has_more: false,
        items: [{ record_id: 'rec-b', fields: {} }],
      },
    });
  };
  const client = createFeishuClient({
    appId: 'id',
    appSecret: 'secret',
    fetchImpl,
    minIntervalMs: 0,
  });

  const records = await client.listPublishedRecords('base/token', 'table id');

  assert.deepEqual(records.map(({ record_id: id }) => id), ['rec-a', 'rec-b']);
  assert.equal(dataUrls.length, 2);
  assert.equal(dataUrls[0].searchParams.get('page_size'), '500');
  assert.equal(
    dataUrls[0].searchParams.get('filter'),
    'CurrentValue.[状态]="已发布"',
  );
  assert.equal(dataUrls[1].searchParams.get('page_token'), 'next page');
  assert.equal(
    dataUrls[0].pathname,
    '/open-apis/bitable/v1/apps/base%2Ftoken/tables/table%20id/records',
  );
});

test('published records accept Feishu null items only for an explicit empty result', async () => {
  const client = createFeishuClient({
    appId: 'id',
    appSecret: 'secret',
    minIntervalMs: 0,
    fetchImpl: async (url) =>
      new URL(url).pathname.includes('/auth/')
        ? token()
        : json({
            code: 0,
            data: {
              has_more: false,
              items: null,
              total: 0,
            },
          }),
  });

  assert.deepEqual(await client.listPublishedRecords('app', 'table'), []);
});

test('published records accept omitted items for an explicit empty result', async () => {
  const client = createFeishuClient({
    appId: 'id',
    appSecret: 'secret',
    minIntervalMs: 0,
    fetchImpl: async (url) =>
      new URL(url).pathname.includes('/auth/')
        ? token()
        : json({
            code: 0,
            data: {
              has_more: false,
              total: 0,
            },
          }),
  });

  assert.deepEqual(await client.listPublishedRecords('app', 'table'), []);
});

test('pagination rejects null items when the response does not prove it is empty', async () => {
  const client = createFeishuClient({
    appId: 'id',
    appSecret: 'secret',
    minIntervalMs: 0,
    fetchImpl: async (url) =>
      new URL(url).pathname.includes('/auth/')
        ? token()
        : json({
            code: 0,
            data: {
              has_more: false,
              items: null,
              total: 1,
            },
          }),
  });

  await assert.rejects(
    () => client.listPublishedRecords('app', 'table'),
    /no items array|pagination/i,
  );
});

test('document metadata and blocks use the requested revision and block pagination', async () => {
  const dataUrls = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.includes('/auth/')) return token();
    dataUrls.push(parsed);
    if (!parsed.pathname.endsWith('/blocks')) {
      return json({
        code: 0,
        data: { document: { document_id: 'doc/id', revision_id: 17, title: '标题' } },
      });
    }
    if (parsed.searchParams.get('page_token') === null) {
      return json({
        code: 0,
        data: {
          has_more: true,
          page_token: 'blocks-2',
          items: [{ block_id: 'page', block_type: 1 }],
        },
      });
    }
    return json({
      code: 0,
      data: {
        has_more: false,
        items: [{ block_id: 'text', block_type: 2 }],
      },
    });
  };
  const client = createFeishuClient({
    appId: 'id',
    appSecret: 'secret',
    fetchImpl,
    minIntervalMs: 0,
  });

  assert.deepEqual(await client.getDocument('doc/id'), {
    document_id: 'doc/id',
    revision_id: 17,
    title: '标题',
  });
  assert.deepEqual(
    (await client.listDocumentBlocks('doc/id', 17)).map(({ block_id: id }) => id),
    ['page', 'text'],
  );

  const blockUrls = dataUrls.filter(({ pathname }) => pathname.endsWith('/blocks'));
  assert.equal(blockUrls.length, 2);
  assert.equal(blockUrls[0].searchParams.get('page_size'), '500');
  assert.equal(blockUrls[0].searchParams.get('document_revision_id'), '17');
  assert.equal(blockUrls[1].searchParams.get('page_token'), 'blocks-2');
});

test('block listing accepts -1 for the latest read-only document revision', async () => {
  const requestedUrls = [];
  const client = createFeishuClient({
    appId: 'id',
    appSecret: 'secret',
    minIntervalMs: 0,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.includes('/auth/')) return token();
      requestedUrls.push(parsed);
      return json({ code: 0, data: { has_more: false, items: [] } });
    },
  });

  assert.deepEqual(await client.listDocumentBlocks('doc', -1), []);
  assert.equal(
    requestedUrls[0].searchParams.get('document_revision_id'),
    '-1',
  );
  assert.throws(() => client.listDocumentBlocks('doc', -2), /revisionId/);
});

test('429 and transient server errors retry through exponential backoff', async () => {
  let dataCalls = 0;
  const sleeps = [];
  const fetchImpl = async (url) => {
    if (new URL(url).pathname.includes('/auth/')) return token();
    dataCalls += 1;
    if (dataCalls === 1) {
      return json(
        { code: 99991400, msg: 'rate limited' },
        { status: 429 },
      );
    }
    if (dataCalls === 2) {
      return json({ code: 1, msg: 'temporary' }, { status: 503 });
    }
    return json({ code: 0, data: { ok: true } });
  };
  const client = createFeishuClient({
    appId: 'id',
    appSecret: 'secret',
    fetchImpl,
    minIntervalMs: 0,
    sleep: async (ms) => sleeps.push(ms),
    random: () => 0,
  });

  assert.deepEqual(await client.request('/example'), { ok: true });
  assert.equal(dataCalls, 3);
  assert.deepEqual(sleeps, [500, 1000]);
});

test('official Feishu rate-limit codes retry even with HTTP 400 or 200', async () => {
  let dataCalls = 0;
  const sleeps = [];
  const client = createFeishuClient({
    appId: 'id',
    appSecret: 'secret',
    minIntervalMs: 0,
    sleep: async (ms) => sleeps.push(ms),
    random: () => 0,
    fetchImpl: async (url) => {
      if (new URL(url).pathname.includes('/auth/')) return token();
      dataCalls += 1;
      if (dataCalls === 1) {
        return json(
          { code: 99991400, msg: 'request rate limited' },
          { status: 400 },
        );
      }
      if (dataCalls === 2) {
        return json({ code: 1254290, msg: 'TooManyRequest' });
      }
      if (dataCalls === 3) {
        return json({ code: 1254607, msg: 'data not ready' });
      }
      if (dataCalls === 4) {
        return json({ code: 1255040, msg: 'request timeout' });
      }
      return json({ code: 0, data: { ok: true } });
    },
  });

  assert.deepEqual(await client.request('/official-rate-limit'), { ok: true });
  assert.equal(dataCalls, 5);
  assert.deepEqual(sleeps, [500, 1000, 2000, 4000]);
});

test('concurrent API calls are serialized below the configured request rate', async () => {
  let clock = 0;
  const starts = [];
  const sleeps = [];
  const client = createFeishuClient({
    appId: 'id',
    appSecret: 'secret',
    minIntervalMs: 210,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    fetchImpl: async (url) => {
      starts.push({ path: new URL(url).pathname, at: clock });
      return new URL(url).pathname.includes('/auth/')
        ? token()
        : json({ code: 0, data: { ok: true } });
    },
  });

  await Promise.all([client.request('/first'), client.request('/second')]);

  assert.deepEqual(starts.map(({ at }) => at), [0, 210, 420]);
  assert.deepEqual(sleeps, [210, 210]);
});

test('transient failures stop after four retries', async () => {
  let dataCalls = 0;
  const client = createFeishuClient({
    appId: 'id',
    appSecret: 'secret',
    minIntervalMs: 0,
    sleep: async () => {},
    random: () => 0,
    fetchImpl: async (url) => {
      if (new URL(url).pathname.includes('/auth/')) return token();
      dataCalls += 1;
      return json({ code: 1, msg: 'still down' }, { status: 500 });
    },
  });

  await assert.rejects(() => client.request('/always-down'), /500.*still down|still down.*500/i);
  assert.equal(dataCalls, 5);
});

test('a nonzero Feishu response includes its code, message, and path', async () => {
  const client = createFeishuClient({
    appId: 'id',
    appSecret: 'secret',
    minIntervalMs: 0,
    fetchImpl: async (url) =>
      new URL(url).pathname.includes('/auth/')
        ? token()
        : json({ code: 1770032, msg: 'forbidden document' }),
  });

  await assert.rejects(
    () => client.request('/docx/v1/documents/secret-doc'),
    (error) => {
      assert.match(error.message, /1770032/);
      assert.match(error.message, /forbidden document/);
      assert.match(error.message, /secret-doc/);
      return true;
    },
  );
});

test('media download stays in memory and receives a content-addressed filename', async () => {
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname.includes('/auth/')) return token();
    assert.equal(parsed.searchParams.get('extra'), 'mount_node=docx_image');
    assert.equal(init.headers.get('accept'), '*/*');
    return new Response(new TextEncoder().encode('hello'), {
      headers: { 'content-type': 'image/png; charset=binary' },
    });
  };
  const client = createFeishuClient({
    appId: 'id',
    appSecret: 'secret',
    fetchImpl,
    minIntervalMs: 0,
  });

  const download = await client.downloadMedia(
    'img/token',
    'mount_node=docx_image',
  );
  const asset = contentAddressedMedia(download);

  assert.equal(new TextDecoder().decode(asset.bytes), 'hello');
  assert.equal(asset.contentType, 'image/png');
  assert.equal(
    asset.filename,
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.png',
  );
  assert.equal(asset.publicPath, `/media/feishu/${asset.filename}`);
});

test('media download rejects oversized declared and streamed bodies', async () => {
  for (const responseFactory of [
    () =>
      new Response(new Uint8Array([1]), {
        headers: {
          'content-type': 'image/png',
          'content-length': String(MAX_MEDIA_BYTES + 1),
        },
      }),
    () =>
      new Response(new Uint8Array(MAX_MEDIA_BYTES + 1), {
        headers: { 'content-type': 'image/png' },
      }),
  ]) {
    const client = createFeishuClient({
      appId: 'id',
      appSecret: 'secret',
      minIntervalMs: 0,
      fetchImpl: async (url) =>
        new URL(url).pathname.includes('/auth/') ? token() : responseFactory(),
    });

    await assert.rejects(() => client.downloadMedia('oversized'), /10 mib|media.*limit/i);
  }
});

test('pagination refuses a repeated page token instead of looping forever', async () => {
  const client = createFeishuClient({
    appId: 'id',
    appSecret: 'secret',
    minIntervalMs: 0,
    fetchImpl: async (url) =>
      new URL(url).pathname.includes('/auth/')
        ? token()
        : json({
            code: 0,
            data: {
              has_more: true,
              page_token: 'repeat',
              items: [],
            },
          }),
  });

  await assert.rejects(
    () => client.listPublishedRecords('app', 'table'),
    /repeated page token|pagination/i,
  );
});
