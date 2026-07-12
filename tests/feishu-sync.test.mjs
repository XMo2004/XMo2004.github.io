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
  createMediaBudget,
  publicSyncFailureMessage,
  syncFeishu,
  validateSyncEnvironment,
} from '../scripts/feishu/sync.mjs';

const APP_TOKEN = 'app-token';
const TABLE_ID = 'table-id';
const DOCUMENT_ID = 'doxcnExample123';

test('public sync failures never expose Feishu internal identifiers', () => {
  const internalValues = [
    'rec_private_123',
    'doxcnPrivateDocument456',
    'app_private_token',
    'table_private_token',
    'media_private_token',
  ];
  const publicMessage = publicSyncFailureMessage(
    new Error(
      `record_id=${internalValues[0]} requested document "${internalValues[1]}" ` +
        `via /apps/${internalValues[2]}/tables/${internalValues[3]}/media/${internalValues[4]}`,
    ),
  );

  assert.match(publicMessage, /飞书同步失败/);
  for (const value of internalValues) {
    assert.doesNotMatch(publicMessage, new RegExp(value));
  }
});

test('public sync failures expose only the allowlisted records-read phase and never the malicious cause', async (t) => {
  const root = await makeRoot(t);
  const { client } = stableClient();
  const privateValues = [
    'rec_private_records_123',
    'doxcnPrivateRecords456',
    'media_private_records_token',
    'https://example.feishu.cn/docx/doxcnPrivateRecords456',
    'super_private_app_secret',
  ];
  client.listPublishedRecords = async () => {
    throw new Error(`replace: ${privateValues.join(' ')}`);
  };

  let failure;
  try {
    await syncFeishu({
      root,
      client,
      appToken: APP_TOKEN,
      tableId: TABLE_ID,
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof Error);
  const publicMessage = publicSyncFailureMessage(failure);
  assert.equal(
    publicMessage,
    '飞书同步失败 [records-read: 多维表格读取]：错误详情已脱敏，请重试。',
  );
  for (const value of privateValues) {
    assert.doesNotMatch(publicMessage, new RegExp(value.replaceAll('/', '\\/')));
  }
  assert.doesNotMatch(publicMessage, /replace/);
});

test('sync diagnostics preserve non-Error throw values and use the generic public fallback', async (t) => {
  const root = await makeRoot(t);
  const { client } = stableClient();
  const sentinel = Object.freeze({ private: 'rec_secret_url_token' });
  client.listPublishedRecords = async () => {
    throw sentinel;
  };

  let failure;
  try {
    await syncFeishu({
      root,
      client,
      appToken: APP_TOKEN,
      tableId: TABLE_ID,
    });
  } catch (error) {
    failure = error;
  }

  assert.strictEqual(failure, sentinel);
  assert.equal(
    publicSyncFailureMessage(failure),
    '飞书同步失败：错误详情已脱敏。请检查飞书应用权限、博客文章字段和文档内容后重试。',
  );
});

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
      分类: '技术',
      专栏: '博客搭建手记',
      专栏序号: 2,
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
    `---\ntitle: Welcome\ndescription: Manual\npubDate: 2026-07-12\nslug: welcome\ncategory: 随笔\ncolumn: 博客搭建手记\ncolumnOrder: 1\n---\n\nManual post.\n`,
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

test('the synchronization media budget enforces distinct-count and byte totals', () => {
  const budget = createMediaBudget({ maxDistinct: 2, maxBytes: 5 });

  budget.reserveDownload();
  budget.reserveDownload();
  assert.throws(() => budget.reserveDownload(), /at most 2.*media/i);

  budget.accountBytes(3);
  budget.accountBytes(2);
  assert.throws(() => budget.accountBytes(1), /at most 5 bytes.*media/i);
});

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

async function publicMessageForRejectedSync(options) {
  let failure;
  await assert.rejects(
    () => syncFeishu(options),
    (error) => {
      failure = error;
      return true;
    },
  );
  return publicSyncFailureMessage(failure);
}

test('public sync diagnostics map each synchronization boundary to a stable allowlisted phase', async (t) => {
  const expected = {
    recordsValidate:
      '飞书同步失败 [records-validate: 发布字段校验; field: 分类]：错误详情已脱敏，请重试。',
    recordsRule:
      '飞书同步失败 [records-validate: 发布字段校验; field: 专栏序号; rule: positive-safe-integer]：错误详情已脱敏，请重试。',
    preflight:
      '飞书同步失败 [preflight: 手动文章与分类预检]：错误详情已脱敏，请重试。',
    build:
      '飞书同步失败 [build: 文档与素材生成]：错误详情已脱敏，请重试。',
    stage:
      '飞书同步失败 [stage: 暂存文件写入]：错误详情已脱敏，请重试。',
    replace:
      '飞书同步失败 [replace: 发布文件替换]：错误详情已脱敏，请重试。',
  };

  const recordsValidateRoot = await makeRoot(t);
  assert.equal(
    await publicMessageForRejectedSync({
      root: recordsValidateRoot,
      client: stableClient({
        records: [publishedRecord({ fields: { 分类: undefined } })],
      }).client,
      appToken: APP_TOKEN,
      tableId: TABLE_ID,
    }),
    expected.recordsValidate,
  );

  const recordsRuleRoot = await makeRoot(t);
  assert.equal(
    await publicMessageForRejectedSync({
      root: recordsRuleRoot,
      client: stableClient({
        records: [publishedRecord({ fields: { 专栏序号: '2' } })],
      }).client,
      appToken: APP_TOKEN,
      tableId: TABLE_ID,
    }),
    expected.recordsRule,
  );

  const preflightRoot = await makeRoot(t);
  await writeFile(
    join(preflightRoot, 'src/content/posts/manual/welcome.md'),
    '---\ntitle: Missing taxonomy\nslug: welcome\n---\n',
  );
  assert.equal(
    await publicMessageForRejectedSync({
      root: preflightRoot,
      client: stableClient().client,
      appToken: APP_TOKEN,
      tableId: TABLE_ID,
    }),
    expected.preflight,
  );

  const buildRoot = await makeRoot(t);
  const buildClient = stableClient().client;
  buildClient.getDocument = async () => {
    throw new Error('doxcn_private_build https://private.example.test');
  };
  assert.equal(
    await publicMessageForRejectedSync({
      root: buildRoot,
      client: buildClient,
      appToken: APP_TOKEN,
      tableId: TABLE_ID,
    }),
    expected.build,
  );

  const stageRoot = await makeRoot(t);
  assert.equal(
    await publicMessageForRejectedSync({
      root: stageRoot,
      client: stableClient({
        records: [publishedRecord({ slug: 'a'.repeat(300) })],
      }).client,
      appToken: APP_TOKEN,
      tableId: TABLE_ID,
    }),
    expected.stage,
  );

  const replaceRoot = await makeRoot(t);
  assert.equal(
    await publicMessageForRejectedSync({
      root: replaceRoot,
      client: stableClient().client,
      appToken: APP_TOKEN,
      tableId: TABLE_ID,
      transactionOperations: {
        rename: async () => {
          throw new Error('rec_private_replace file_private_replace_token');
        },
      },
    }),
    expected.replace,
  );
});

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
    category: '技术',
    column: '博客搭建手记',
    columnOrder: 2,
    featured: true,
    cover: coverAsset.publicPath,
    slug: 'first-post',
  });
  assert.doesNotMatch(source, /example\.feishu\.cn|rec-one|doxcnExample123/);
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
  assert.equal(manifest.version, 2);
  assert.deepEqual(manifest.records.map(({ slug }) => slug), ['first-post']);
  assert.deepEqual(Object.keys(manifest.records[0]).sort(), ['assets', 'slug']);
  assert.doesNotMatch(JSON.stringify(manifest), /rec-one|doxcnExample123/);
  assert.deepEqual(
    manifest.records[0].assets.map(({ hash }) => hash).sort(),
    [bodyAsset.hash, coverAsset.hash].sort(),
  );
});

test('sync omits both optional column fields instead of publishing null values', async (t) => {
  const root = await makeRoot(t);
  const { client } = stableClient({
    records: [
      publishedRecord({
        fields: { 专栏: undefined, 专栏序号: undefined },
      }),
    ],
  });

  await syncFeishu({ root, client, appToken: APP_TOKEN, tableId: TABLE_ID });

  const source = await readFile(
    join(root, 'src/content/posts/feishu/first-post.md'),
    'utf8',
  );
  const { frontmatter } = parseMarkdownFile(source);
  assert.equal(frontmatter.category, '技术');
  assert.equal(Object.hasOwn(frontmatter, 'column'), false);
  assert.equal(Object.hasOwn(frontmatter, 'columnOrder'), false);
  assert.doesNotMatch(source, /^column(?:Order)?:/m);
});

test('changing only public taxonomy metadata rewrites the generated post', async (t) => {
  const root = await makeRoot(t);
  const first = stableClient();
  await syncFeishu({
    root,
    client: first.client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });
  const before = await readFile(
    join(root, 'src/content/posts/feishu/first-post.md'),
    'utf8',
  );

  const second = stableClient({
    records: [publishedRecord({ fields: { 分类: '成长' } })],
  });
  const result = await syncFeishu({
    root,
    client: second.client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });
  const after = await readFile(
    join(root, 'src/content/posts/feishu/first-post.md'),
    'utf8',
  );

  assert.equal(result.changed, true);
  assert.notEqual(after, before);
  assert.equal(parseMarkdownFile(after).frontmatter.category, '成长');
});

test('changing only Feishu internal identifiers does not rewrite public output', async (t) => {
  const root = await makeRoot(t);
  const first = stableClient();
  await syncFeishu({ root, client: first.client, appToken: APP_TOKEN, tableId: TABLE_ID });
  const before = await generatedSnapshot(root);

  const secondRecord = publishedRecord({ id: 'rec-two' });
  secondRecord.fields.文档链接.link = 'https://example.feishu.cn/docx/doxcnOther456';
  const second = stableClient({ records: [secondRecord] });

  const result = await syncFeishu({
    root,
    client: second.client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });

  assert.equal(result.changed, false);
  assert.deepEqual(await generatedSnapshot(root), before);
});

test('conversion warnings expose only the public slug and warning details', async (t) => {
  const root = await makeRoot(t);
  const { client } = stableClient({
    records: [publishedRecord({ fields: { 封面: [] } })],
  });
  client.listDocumentBlocks = async () => [
    {
      block_id: 'private-page-id',
      block_type: 1,
      children: ['private-paragraph-id'],
      page: { elements: [] },
    },
    {
      block_id: 'private-paragraph-id',
      block_type: 2,
      parent_id: 'private-page-id',
      text: {
        elements: [
          {
            text_run: {
              content: '带下划线的正文',
              text_element_style: { underline: true },
            },
          },
        ],
      },
    },
  ];

  const result = await syncFeishu({
    root,
    client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });

  assert.deepEqual(result.warnings, [{ slug: 'first-post', type: 'underline' }]);
  assert.doesNotMatch(
    JSON.stringify(result.warnings),
    /rec-one|doxcnExample123|private-page-id|private-paragraph-id/,
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

test('an article with more than 30 distinct media assets fails before download', async (t) => {
  const root = await makeRoot(t);
  const { client, calls } = stableClient({
    records: [publishedRecord({ fields: { 封面: [] } })],
  });
  const imageIds = Array.from({ length: 31 }, (_, index) => `image-${index}`);
  client.listDocumentBlocks = async () => [
    {
      block_id: 'page',
      block_type: 1,
      children: imageIds,
      page: { elements: [] },
    },
    ...imageIds.map((blockId, index) => ({
      block_id: blockId,
      block_type: 27,
      parent_id: 'page',
      image: { token: `token-${index}` },
    })),
  ];

  await assert.rejects(
    () => syncFeishu({ root, client, appToken: APP_TOKEN, tableId: TABLE_ID }),
    /30.*media|media.*30/i,
  );
  assert.deepEqual(calls.media, []);
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

test('a duplicate column order across manual and generated posts fails before document reads or replacement', async (t) => {
  const root = await makeRoot(t);
  const first = stableClient();
  await syncFeishu({
    root,
    client: first.client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });
  const before = await generatedSnapshot(root);

  const second = stableClient({
    records: [publishedRecord({ fields: { 专栏序号: 1 } })],
  });
  await assert.rejects(
    () =>
      syncFeishu({
        root,
        client: second.client,
        appToken: APP_TOKEN,
        tableId: TABLE_ID,
      }),
    (error) => {
      assert.match(error.message, /博客搭建手记/);
      assert.match(error.message, /duplicate.*order.*1/i);
      assert.match(error.message, /manual\/welcome\.md/);
      assert.match(error.message, /feishu\/first-post\.md/);
      return true;
    },
  );
  assert.deepEqual(second.calls.documents, []);
  assert.deepEqual(await generatedSnapshot(root), before);
});

test('a category route collision across manual and generated posts fails before document reads or replacement', async (t) => {
  const root = await makeRoot(t);
  const first = stableClient();
  await syncFeishu({
    root,
    client: first.client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });
  const before = await generatedSnapshot(root);
  const manualPath = join(root, 'src/content/posts/manual/welcome.md');
  const manualSource = await readFile(manualPath, 'utf8');
  await writeFile(manualPath, manualSource.replace('category: 随笔', 'category: A B'));

  const second = stableClient({
    records: [publishedRecord({ fields: { 分类: 'a-b' } })],
  });
  await assert.rejects(
    () =>
      syncFeishu({
        root,
        client: second.client,
        appToken: APP_TOKEN,
        tableId: TABLE_ID,
      }),
    (error) => {
      assert.match(error.message, /Category route collision/i);
      assert.match(error.message, /A B/);
      assert.match(error.message, /a-b/);
      assert.match(error.message, /manual\/welcome\.md/);
      assert.match(error.message, /feishu\/first-post\.md/);
      return true;
    },
  );
  assert.deepEqual(second.calls.documents, []);
  assert.deepEqual(await generatedSnapshot(root), before);
});

test('missing manual taxonomy fails safely before document reads or replacement', async (t) => {
  const root = await makeRoot(t);
  const first = stableClient();
  await syncFeishu({
    root,
    client: first.client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });
  const before = await generatedSnapshot(root);
  const manualPath = join(root, 'src/content/posts/manual/welcome.md');
  const manualSource = await readFile(manualPath, 'utf8');
  await writeFile(manualPath, manualSource.replace('category: 随笔\n', ''));

  const second = stableClient();
  await assert.rejects(
    () =>
      syncFeishu({
        root,
        client: second.client,
        appToken: APP_TOKEN,
        tableId: TABLE_ID,
      }),
    /Category.*manual\/welcome\.md/i,
  );
  assert.deepEqual(second.calls.documents, []);
  assert.deepEqual(await generatedSnapshot(root), before);
});

test('explicit null manual column fields fail before document reads or replacement', async (t) => {
  const root = await makeRoot(t);
  const first = stableClient();
  await syncFeishu({
    root,
    client: first.client,
    appToken: APP_TOKEN,
    tableId: TABLE_ID,
  });
  const before = await generatedSnapshot(root);
  const manualPath = join(root, 'src/content/posts/manual/welcome.md');
  const manualSource = await readFile(manualPath, 'utf8');
  await writeFile(
    manualPath,
    manualSource
      .replace('column: 博客搭建手记', 'column:')
      .replace('columnOrder: 1', 'columnOrder:'),
  );

  const second = stableClient();
  await assert.rejects(
    () =>
      syncFeishu({
        root,
        client: second.client,
        appToken: APP_TOKEN,
        tableId: TABLE_ID,
      }),
    /Column.*manual\/welcome\.md/i,
  );
  assert.deepEqual(second.calls.documents, []);
  assert.deepEqual(await generatedSnapshot(root), before);
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
  assert.equal(manifest.version, 2);
  assert.deepEqual(Object.keys(manifest.records[0]).sort(), ['assets', 'slug']);
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
