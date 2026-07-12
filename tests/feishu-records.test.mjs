import assert from 'node:assert/strict';
import test from 'node:test';

import { documentIdFromUrl, validateSlug } from '../scripts/feishu/ids.mjs';
import { normalizeRecord } from '../scripts/feishu/records.mjs';

const DOCUMENT_URL = 'https://example.feishu.cn/docx/doxcnExample123';

function validFields(overrides = {}) {
  return {
    标题: '文章标题',
    文档链接: { link: DOCUMENT_URL, text: '打开文档' },
    Slug: 'article-title',
    摘要: '文章摘要',
    标签: ['技术'],
    分类: '技术',
    专栏: '博客搭建手记',
    专栏序号: 2,
    发布日期: 1_783_785_600_000,
    状态: '已发布',
    精选: true,
    ...overrides,
  };
}

function assertRecordError(fields, fieldName) {
  assert.throws(
    () => normalizeRecord({ record_id: 'rec_invalid', fields }),
    (error) => {
      assert.match(error.message, /rec_invalid/);
      assert.match(error.message, new RegExp(fieldName));
      return true;
    },
  );
}

test('documentIdFromUrl extracts document tokens from trusted Feishu and LarkSuite subdomains', () => {
  assert.equal(documentIdFromUrl(DOCUMENT_URL), 'doxcnExample123');
  assert.equal(
    documentIdFromUrl(
      'https://workspace.larksuite.com/docx/doxcnLarkSuite456?from=space',
    ),
    'doxcnLarkSuite456',
  );
});

test('documentIdFromUrl rejects untrusted schemes, hosts, paths, and unsafe tokens', () => {
  const invalidUrls = [
    'http://example.feishu.cn/docx/doxcnExample123',
    'https://feishu.cn.evil.example/docx/doxcnExample123',
    'https://example.feishu.cn/docs/doxcnExample123',
    'https://example.feishu.cn/docx/',
    'https://example.feishu.cn/docx/../admin',
    'https://example.feishu.cn/docx/doxcnExample123/extra',
    'https://example.feishu.cn/docx/doxcnExample123%2Fadmin',
    'https://example.feishu.cn/docx/doxcnExample123%00',
  ];

  for (const url of invalidUrls) {
    assert.throws(() => documentIdFromUrl(url), /document|文档|URL/i, url);
  }
});

test('documentIdFromUrl rejects credentials and explicit ports', () => {
  for (const url of [
    'https://secret@example.feishu.cn/docx/doxcnExample123',
    'https://user:pass@example.feishu.cn/docx/doxcnExample123',
    'https://example.feishu.cn:444/docx/doxcnExample123',
  ]) {
    assert.throws(() => documentIdFromUrl(url), /document|文档|URL/i, url);
  }
});

test('validateSlug accepts only lowercase kebab-case slugs', () => {
  for (const slug of ['a', 'article-2', '2026-notes']) {
    assert.equal(validateSlug(slug), slug);
  }

  for (const slug of [
    '',
    'Article',
    '-article',
    'article-',
    'article--title',
    'article_title',
    ' article ',
    '../admin',
    null,
  ]) {
    assert.throws(() => validateSlug(slug), /Slug/);
  }
});

test('normalizeRecord handles rich text, hyperlink, attachment, and object-tag Bitable values', () => {
  const input = {
    record_id: 'rec_rich',
    fields: validFields({
      标题: [
        { text: '文章', type: 'text' },
        { text: '标题', type: 'text' },
      ],
      摘要: [
        { text: '第一段', type: 'text' },
        { text: '摘要', type: 'text' },
      ],
      标签: [
        { text: ' 技术 ' },
        { text: '' },
        { text: '技术' },
        { text: ' Astro ' },
      ],
      封面: [
        {
          file_token: 'boxcnCoverToken',
          name: 'cover.png',
          type: 'image/png',
          extra: { source: 'bitable' },
          url: 'https://open.feishu.cn/open-apis/drive/v1/medias/cover',
          size: 1024,
          tmp_url: 'https://example.invalid/temporary',
        },
        { file_token: 'boxcnIgnored', name: 'ignored.png' },
      ],
    }),
  };
  const before = structuredClone(input);

  const record = normalizeRecord(input);

  assert.deepEqual(record, {
    recordId: 'rec_rich',
    title: '文章标题',
    documentUrl: DOCUMENT_URL,
    documentId: 'doxcnExample123',
    slug: 'article-title',
    description: '第一段摘要',
    tags: ['技术', 'Astro'],
    category: '技术',
    column: '博客搭建手记',
    columnOrder: 2,
    pubDate: new Date(1_783_785_600_000),
    status: '已发布',
    featured: true,
    cover: {
      file_token: 'boxcnCoverToken',
      name: 'cover.png',
      type: 'image/png',
      extra: { source: 'bitable' },
      url: 'https://open.feishu.cn/open-apis/drive/v1/medias/cover',
    },
  });
  assert.deepEqual(input, before);
  assert.notEqual(record.cover, input.fields.封面[0]);
});

test('normalizeRecord handles string Bitable values and defaults optional fields', () => {
  const record = normalizeRecord({
    record_id: 'rec_string',
    fields: validFields({
      标题: '  字符串标题  ',
      文档链接:
        'https://workspace.larksuite.com/docx/doxcnLarkSuite456?from=space',
      摘要: '  字符串摘要  ',
      标签: [' 技术 ', '', '技术', ' Astro '],
      分类: '  技术  ',
      专栏: '  博客搭建手记  ',
      发布日期: '2026-07-12T00:00:00.000Z',
      状态: '草稿',
      精选: undefined,
      封面: [],
    }),
  });

  assert.deepEqual(record, {
    recordId: 'rec_string',
    title: '字符串标题',
    documentUrl:
      'https://workspace.larksuite.com/docx/doxcnLarkSuite456?from=space',
    documentId: 'doxcnLarkSuite456',
    slug: 'article-title',
    description: '字符串摘要',
    tags: ['技术', 'Astro'],
    category: '技术',
    column: '博客搭建手记',
    columnOrder: 2,
    pubDate: new Date('2026-07-12T00:00:00.000Z'),
    status: '草稿',
    featured: false,
    cover: null,
  });
});

test('normalizeRecord allows an empty title and preserves every publishing status', () => {
  for (const status of ['草稿', '已发布', '已下线']) {
    const record = normalizeRecord({
      record_id: `rec_${status}`,
      fields: validFields({ 标题: [], 状态: status }),
    });

    assert.equal(record.title, null);
    assert.equal(record.status, status);
  }
});

test('normalizeRecord accepts integer milliseconds, Date objects, and strict ISO strings', () => {
  const sourceDate = new Date('2026-07-12T00:00:00.000Z');
  const fromDate = normalizeRecord({
    record_id: 'rec_date_object',
    fields: validFields({ 发布日期: sourceDate }),
  }).pubDate;
  const fromDateOnly = normalizeRecord({
    record_id: 'rec_date_only',
    fields: validFields({ 发布日期: '2026-07-12' }),
  }).pubDate;

  assert.deepEqual(fromDate, sourceDate);
  assert.notEqual(fromDate, sourceDate);
  assert.equal(fromDateOnly.toISOString(), '2026-07-12T00:00:00.000Z');
});

test('normalizeRecord rejects non-integer milliseconds and non-strict date strings', () => {
  for (const value of [
    1_783_785_600_000.5,
    Number.POSITIVE_INFINITY,
    '2026-02-30',
    '07/12/2026',
    '2026-07-12T00:00:00Z',
    '2026-07-12T08:00:00.000+08:00',
    '1783785600000',
  ]) {
    assertRecordError(validFields({ 发布日期: value }), '发布日期');
  }
});

test('normalizeRecord requires a non-empty string record_id', () => {
  for (const recordId of [undefined, '', '   ', 123]) {
    const record = { fields: validFields() };
    if (recordId !== undefined) {
      record.record_id = recordId;
    }

    assert.throws(() => normalizeRecord(record), (error) => {
      assert.match(error.message, /record_id/);
      assert.doesNotMatch(error.message, /<missing>/);
      return true;
    });
  }
});

test('normalizeRecord requires publishing control fields', () => {
  for (const [fieldName, value] of [
    ['文档链接', undefined],
    ['Slug', undefined],
    ['摘要', '   '],
    ['发布日期', undefined],
    ['状态', undefined],
  ]) {
    assertRecordError(validFields({ [fieldName]: value }), fieldName);
  }
});

test('normalizeRecord requires a non-empty string category', () => {
  for (const value of [undefined, '', '   ', 123, ['技术'], { text: '技术' }]) {
    assertRecordError(validFields({ 分类: value }), '分类');
  }
});

test('normalizeRecord allows the column and order pair to be omitted', () => {
  const record = normalizeRecord({
    record_id: 'rec_without_column',
    fields: validFields({ 专栏: undefined, 专栏序号: undefined }),
  });

  assert.equal(record.column, null);
  assert.equal(record.columnOrder, null);
});

test('normalizeRecord requires column and column order to be provided together', () => {
  assertRecordError(validFields({ 专栏序号: undefined }), '专栏序号');
  assertRecordError(validFields({ 专栏: undefined }), '专栏');
});

test('normalizeRecord accepts only positive safe integer column orders without coercion', () => {
  for (const value of [
    0,
    -1,
    1.5,
    '2',
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assertRecordError(validFields({ 专栏序号: value }), '专栏序号');
  }
});

test('normalizeRecord rejects unsafe cover file tokens', () => {
  for (const fileToken of [
    '   ',
    'folder/token',
    'boxcn\u0000Token',
    ' boxcnToken',
    'boxcnToken ',
  ]) {
    assertRecordError(
      validFields({ 封面: [{ file_token: fileToken }] }),
      '封面',
    );
  }
});

test('normalizeRecord reports the record and field for malformed values', () => {
  for (const [fieldName, value] of [
    ['标题', 123],
    ['文档链接', 'http://example.feishu.cn/docx/doxcnExample123'],
    ['Slug', '../admin'],
    ['摘要', { text: 'not-an-array' }],
    ['标签', '技术'],
    ['发布日期', 'not-a-date'],
    ['状态', '待审核'],
    ['精选', 'true'],
    ['封面', { file_token: 'boxcnCoverToken' }],
  ]) {
    assertRecordError(validFields({ [fieldName]: value }), fieldName);
  }
});
