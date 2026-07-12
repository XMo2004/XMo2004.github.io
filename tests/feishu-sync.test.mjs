import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename as fsRename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { parse as parseYaml } from 'yaml';

import { contentAddressedMedia } from '../scripts/feishu/assets.mjs';
import {
  syncFeishu,
  validateSyncEnvironment,
} from '../scripts/feishu/sync.mjs';

const APP_TOKEN = 'app-token';
const TABLE_ID = 'table-id';
const DOCUMENT_ID = 'doxcnExample123';

function publishedRecord({ id = 'rec-one', slug = 'first-post', fields = {} } = {}) {
  return {
    record_id: id,
    fields: {
      标题: '',
      文档链接: {
        link: `https://example.feishu.cn/docx/${DOCUMENT_ID}`,
      },
      Slug: slug,
      摘要: '这是一篇由飞书同步的测试文章。',
      标签: ['飞书', '测试'],
      发布日期: Date.parse('2026-07-11T16:00:00.000Z'),
      状态: '已发布',
      精选: true,
      封面: [
        {
          file_token: 'cover_token',
          name: 'cover.jpg',
          type: 'image/jpeg',
        },
      ],
      ...fields,
    },
  };
}

function documentBlocks(body = '来自飞书的正文') {
  return [
    {
      block_id: 'page',
      block_type: 1,
      children: ['paragraph', 'image'],
      page: { elements: [] },
    },
    {
      block_id: 'paragraph',
      block_type: 2,
      parent_id: 'page',
      text: {
        elements: [
          { text_run: { content: body, text_element_style: {} } },
        ],
      },
    },
    {
      block_id: 'image',
      block_type: 27,
      parent_id: 'page',
      image: { token: 'body_image' },
    },
  ];
}

function stableClient({ records = [publishedRecord()], body = '来自飞书的正文' } = {}) {
  const calls = {
    list: [],
    documents: [],
    blocks: [],
    media: [],
  };
  const client = {
    async listPublishedRecords(appToken, tableId) {
      calls.list.push({ appToken, tableId });
      return structuredClone(records);
    },
    async getDocument(documentId) {
      calls.documents.push(documentId);
      return {
        document_id: documentId,
        revision_id: 7,
        title: '飞书文档标题',
      };
    },
    async listDocumentBlocks(documentId, revisionId) {
      calls.blocks.push({ documentId, revisionId });
      return documentBlocks(body);
    },
    async downloadMedia(fileToken, extra) {
      calls.media.push({ fileToken, extra });
      const isCover = fileToken === 'cover_token';
      return {
        bytes: new TextEncoder().encode(
          isCover ? 'cover-image-bytes' : 'body-image-bytes',
        ),
        contentType: isCover ? 'image/jpeg' : 'image/png',
      };
    },
  };
  return { client, calls };
}

async function makeRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'feishu-blog-sync-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src/content/posts/manual'), { recursive: true });
  await mkdir(join(root, 'src/content/posts/feishu'), { recursive: true });
  await mkdir(join(root, 'public/media/feishu'), { recursive: true });
  await writeFile(
    join(root, 'src/content/posts/manual/welcome.md'),
    `---\ntitle: Welcome\ndescription: Manual\npubDate: 2026-07-12\nslug: welcome\n---\n\nManual post.\n`,
  );
  await writeFile(join(root, 'src/content/posts/feishu/.gitkeep'), '');
  await writeFile(join(root, 'public/media/feishu/.gitkeep'), '');
  return root;
}

function parseMarkdownFile(source) {
  const match = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/.exec(source);
  assert.ok(match, 'generated post must contain YAML frontmatter');
  return { frontmatter: parseYaml(match[1]), body: match[2] };
}

async function generatedSnapshot(root) {
  const entries = {};

  async function visit(path) {
    let info;
    try {
      info = await lstat(path, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        entries[relative(root, path)] = { missing: true };
        return;
      }
      throw error;
    }

    const key = relative(root, path);
    if (info.isDirectory()) {
      entries[key] = {
        type: 'directory',
        ino: info.ino,
        mtimeNs: info.mtimeNs,
      };
      for (const name of (await readdir(path)).sort()) {
        await visit(join(path, name));
      }
      return;
    }

    entries[key] = {
      type: 'file',
      ino: info.ino,
      mtimeNs: info.mtimeNs,
      bytes: (await readFile(path)).toString('hex'),
    };
  }

  await visit(join(root, 'src/content/posts/feishu'));
  await visit(join(root, 'public/media/feishu'));
  await visit(join(root, '.feishu-manifest.json'));
  return entries;
}

test('sync creates valid Markdown, localized media, and a deterministic manifest', async (t) => {
  const root = await makeRoot(t);
  const { client, calls } = stableClient();

  const result = await syncFeishu({
    root,
    client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });

  assert.deepEqual(calls.list, [{ appToken: APP_TOKEN, tableId: TABLE_ID }]);
  assert.deepEqual(calls.blocks, [
    { documentId: DOCUMENT_ID, revisionId: -1 },
  ]);
  assert.equal(result.changed, true);
  assert.equal(result.postCount, 1);
  assert.equal(result.assetCount, 2);

  const source = await readFile(
    join(root, 'src/content/posts/feishu/first-post.md'),
    'utf8',
  );
  const { frontmatter, body } = parseMarkdownFile(source);
  const coverAsset = contentAddressedMedia({
    bytes: new TextEncoder().encode('cover-image-bytes'),
    contentType: 'image/jpeg',
  });
  const bodyAsset = contentAddressedMedia({
    bytes: new TextEncoder().encode('body-image-bytes'),
    contentType: 'image/png',
  });

  assert.deepEqual(frontmatter, {
    title: '飞书文档标题',
    description: '这是一篇由飞书同步的测试文章。',
    pubDate: '2026-07-12',
    tags: ['飞书', '测试'],
    featured: true,
    cover: coverAsset.publicPath,
    sourceUrl: `https://example.feishu.cn/docx/${DOCUMENT_ID}`,
    feishuRecordId: 'rec-one',
    slug: 'first-post',
  });
  assert.match(body, /来自飞书的正文/);
  assert.match(body, new RegExp(bodyAsset.publicPath));
  assert.doesNotMatch(body, /feishu-media:/);
  assert.deepEqual(
    (await readdir(join(root, 'public/media/feishu'))).sort(),
    [bodyAsset.filename, coverAsset.filename].sort(),
  );

  const manifest = JSON.parse(
    await readFile(join(root, '.feishu-manifest.json'), 'utf8'),
  );
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.records.map(({ recordId }) => recordId), ['rec-one']);
  assert.equal(manifest.records[0].revisionId, 7);
  assert.deepEqual(
    manifest.records[0].assets.map(({ hash }) => hash).sort(),
    [bodyAsset.hash, coverAsset.hash].sort(),
  );
});

test('a second identical sync performs no filesystem replacement', async (t) => {
  const root = await makeRoot(t);
  const { client } = stableClient();
  await syncFeishu({ root, client, appToken: APP_TOKEN, tableId: TABLE_ID });
  const before = await generatedSnapshot(root);

  const result = await syncFeishu({
    root,
    client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });

  assert.equal(result.changed, false);
  assert.deepEqual(await generatedSnapshot(root), before);
});

test('unexpected symlinks force a clean generated-tree replacement', async (t) => {
  const root = await makeRoot(t);
  const { client } = stableClient();
  await syncFeishu({ root, client, appToken: APP_TOKEN, tableId: TABLE_ID });
  const link = join(root, 'src/content/posts/feishu/escape.md');
  await symlink(join(root, 'src/content/posts/manual/welcome.md'), link);

  const result = await syncFeishu({
    root,
    client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });

  assert.equal(result.changed, true);
  await assert.rejects(() => lstat(link), { code: 'ENOENT' });
  assert.deepEqual(await readdir(join(root, 'src/content/posts/feishu')), [
    'first-post.md',
  ]);
});

test('media tokens that prefix one another are localized independently', async (t) => {
  const root = await makeRoot(t);
  const { client } = stableClient({
    records: [publishedRecord({ fields: { 封面: [] } })],
  });
  client.listDocumentBlocks = async () => [
    {
      block_id: 'page',
      block_type: 1,
      children: ['image-a', 'image-ab'],
      page: { elements: [] },
    },
    {
      block_id: 'image-a',
      block_type: 27,
      parent_id: 'page',
      image: { token: 'a' },
    },
    {
      block_id: 'image-ab',
      block_type: 27,
      parent_id: 'page',
      image: { token: 'ab' },
    },
  ];
  client.downloadMedia = async (token) => ({
    bytes: new TextEncoder().encode(`image-${token}`),
    contentType: 'image/png',
  });

  await syncFeishu({ root, client, appToken: APP_TOKEN, tableId: TABLE_ID });

  const source = await readFile(
    join(root, 'src/content/posts/feishu/first-post.md'),
    'utf8',
  );
  for (const token of ['a', 'ab']) {
    const asset = contentAddressedMedia({
      bytes: new TextEncoder().encode(`image-${token}`),
      contentType: 'image/png',
    });
    assert.match(source, new RegExp(asset.publicPath));
  }
  assert.doesNotMatch(source, /feishu-media:/);
});

test('media localization never rewrites literal URLs inside author code', async (t) => {
  const root = await makeRoot(t);
  const { client } = stableClient({
    records: [publishedRecord({ fields: { 封面: [] } })],
  });
  client.listDocumentBlocks = async () => [
    {
      block_id: 'page',
      block_type: 1,
      children: ['code', 'image'],
      page: { elements: [] },
    },
    {
      block_id: 'code',
      block_type: 14,
      parent_id: 'page',
      code: {
        elements: [
          {
            text_run: {
              content:
                'feishu-media://body_image\nfeishu-media://unknown_literal',
              text_element_style: {},
            },
          },
        ],
        style: { language: 1 },
      },
    },
    {
      block_id: 'image',
      block_type: 27,
      parent_id: 'page',
      image: { token: 'body_image' },
    },
  ];

  await syncFeishu({ root, client, appToken: APP_TOKEN, tableId: TABLE_ID });

  const source = await readFile(
    join(root, 'src/content/posts/feishu/first-post.md'),
    'utf8',
  );
  assert.match(
    source,
    /```text\nfeishu-media:\/\/body_image\nfeishu-media:\/\/unknown_literal\n```/,
  );
  const image = contentAddressedMedia({
    bytes: new TextEncoder().encode('body-image-bytes'),
    contentType: 'image/png',
  });
  assert.match(source, new RegExp(`!\\[图片\\]\\(${image.publicPath}\\)`));
});

test('removing a published row removes its post and unreferenced media', async (t) => {
  const root = await makeRoot(t);
  let records = [publishedRecord()];
  const { client } = stableClient();
  client.listPublishedRecords = async () => structuredClone(records);
  await syncFeishu({ root, client, appToken: APP_TOKEN, tableId: TABLE_ID });

  records = [];
  const result = await syncFeishu({
    root,
    client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });

  assert.equal(result.changed, true);
  assert.equal(result.postCount, 0);
  assert.deepEqual(await readdir(join(root, 'src/content/posts/feishu')), [
    '.gitkeep',
  ]);
  assert.deepEqual(await readdir(join(root, 'public/media/feishu')), [
    '.gitkeep',
  ]);
  const manifest = JSON.parse(
    await readFile(join(root, '.feishu-manifest.json'), 'utf8'),
  );
  assert.deepEqual(manifest.records, []);
});

test('an invalid record preserves the previous generated tree byte-for-byte', async (t) => {
  const root = await makeRoot(t);
  let records = [publishedRecord()];
  const { client } = stableClient();
  client.listPublishedRecords = async () => structuredClone(records);
  await syncFeishu({ root, client, appToken: APP_TOKEN, tableId: TABLE_ID });
  const before = await generatedSnapshot(root);

  records = [publishedRecord({ id: 'rec-invalid', slug: '../admin' })];
  await assert.rejects(
    () => syncFeishu({ root, client, appToken: APP_TOKEN, tableId: TABLE_ID }),
    /rec-invalid.*Slug/s,
  );
  assert.deepEqual(await generatedSnapshot(root), before);
});

test('duplicate record slugs fail before document reads or writes', async (t) => {
  const root = await makeRoot(t);
  const records = [
    publishedRecord({ id: 'rec-a', slug: 'same-post' }),
    publishedRecord({ id: 'rec-b', slug: 'same-post' }),
  ];
  const { client, calls } = stableClient({ records });
  const before = await generatedSnapshot(root);

  await assert.rejects(
    () => syncFeishu({ root, client, appToken: APP_TOKEN, tableId: TABLE_ID }),
    /same-post.*rec-a.*rec-b|rec-a.*rec-b.*same-post/s,
  );
  assert.deepEqual(calls.documents, []);
  assert.deepEqual(await generatedSnapshot(root), before);
});

test('a generated slug may not collide with a manual post route', async (t) => {
  const root = await makeRoot(t);
  const { client, calls } = stableClient({
    records: [publishedRecord({ slug: 'welcome' })],
  });

  await assert.rejects(
    () => syncFeishu({ root, client, appToken: APP_TOKEN, tableId: TABLE_ID }),
    /welcome.*manual|manual.*welcome/i,
  );
  assert.deepEqual(calls.documents, []);
});

test('a changing document is retried once and only the stable revision is written', async (t) => {
  const root = await makeRoot(t);
  const { client, calls } = stableClient();
  const revisions = [1, 2, 3, 3];
  client.getDocument = async (documentId) => ({
    document_id: documentId,
    revision_id: revisions.shift(),
    title: '重试后的标题',
  });
  let blockRead = 0;
  client.listDocumentBlocks = async (documentId, revisionId) => {
    calls.blocks.push({ documentId, revisionId });
    blockRead += 1;
    return documentBlocks(blockRead === 1 ? '不稳定版本' : '稳定版本');
  };

  await syncFeishu({ root, client, appToken: APP_TOKEN, tableId: TABLE_ID });

  const source = await readFile(
    join(root, 'src/content/posts/feishu/first-post.md'),
    'utf8',
  );
  assert.doesNotMatch(source, /不稳定版本/);
  assert.match(source, /稳定版本/);
  assert.deepEqual(calls.blocks, [
    { documentId: DOCUMENT_ID, revisionId: -1 },
    { documentId: DOCUMENT_ID, revisionId: -1 },
  ]);
  const manifest = JSON.parse(
    await readFile(join(root, '.feishu-manifest.json'), 'utf8'),
  );
  assert.equal(manifest.records[0].revisionId, 3);
});

test('a document that changes twice aborts without replacing the previous tree', async (t) => {
  const root = await makeRoot(t);
  const first = stableClient();
  await syncFeishu({
    root,
    client: first.client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });
  const before = await generatedSnapshot(root);

  const second = stableClient();
  const revisions = [8, 9, 10, 11];
  second.client.getDocument = async (documentId) => ({
    document_id: documentId,
    revision_id: revisions.shift(),
    title: '持续变化',
  });
  await assert.rejects(
    () =>
      syncFeishu({
        root,
        client: second.client,
        appToken: APP_TOKEN,
        tableId: TABLE_ID,
      }),
    /changed.*twice|变化.*两次/i,
  );
  assert.deepEqual(await generatedSnapshot(root), before);
});

test('a replacement rename failure rolls every generated target back', async (t) => {
  const root = await makeRoot(t);
  const original = stableClient();
  await syncFeishu({
    root,
    client: original.client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });
  const before = await generatedSnapshot(root);
  const updated = stableClient({ body: '准备发布的新版本' });
  let renameCalls = 0;

  await assert.rejects(
    () =>
      syncFeishu({
        root,
        client: updated.client,
        appToken: APP_TOKEN,
        tableId: TABLE_ID,
        transactionOperations: {
          rename: async (...args) => {
            renameCalls += 1;
            if (renameCalls === 4) throw new Error('injected rename failure');
            return fsRename(...args);
          },
        },
      }),
    /injected rename failure/,
  );

  assert.deepEqual(await generatedSnapshot(root), before);
  assert.deepEqual(
    (await readdir(root)).filter((name) => name.startsWith('.feishu-sync-')),
    [],
  );
});

test('failed rollback keeps its journal and the next sync restores it first', async (t) => {
  const root = await makeRoot(t);
  const original = stableClient();
  await syncFeishu({
    root,
    client: original.client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });
  const before = await generatedSnapshot(root);
  const updated = stableClient({ body: '不能留下的部分版本' });
  let renameCalls = 0;

  await assert.rejects(
    () =>
      syncFeishu({
        root,
        client: updated.client,
        appToken: APP_TOKEN,
        tableId: TABLE_ID,
        transactionOperations: {
          rename: async (from, to) => {
            renameCalls += 1;
            if (
              renameCalls === 4 ||
              String(from).endsWith('previous-media')
            ) {
              throw new Error('injected rollback failure');
            }
            return fsRename(from, to);
          },
        },
      }),
    /recovery data was preserved/,
  );
  assert.equal(
    (await readdir(root)).filter((name) => name.startsWith('.feishu-sync-'))
      .length,
    1,
  );

  const recovered = await syncFeishu({
    root,
    client: original.client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });
  assert.equal(recovered.changed, false);
  assert.deepEqual(await generatedSnapshot(root), before);
  assert.deepEqual(
    (await readdir(root)).filter((name) => name.startsWith('.feishu-sync-')),
    [],
  );
});

test('sync environment validation lists all missing names at once', () => {
  assert.throws(
    () => validateSyncEnvironment({ FEISHU_APP_ID: 'present' }),
    (error) => {
      assert.doesNotMatch(error.message, /FEISHU_APP_ID/);
      assert.match(error.message, /FEISHU_APP_SECRET/);
      assert.match(error.message, /FEISHU_BITABLE_APP_TOKEN/);
      assert.match(error.message, /FEISHU_BITABLE_TABLE_ID/);
      return true;
    },
  );
});
