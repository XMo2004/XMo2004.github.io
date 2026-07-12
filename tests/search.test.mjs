import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildSearchEntry,
  markdownToSearchText,
  normalizeSearchQuery,
  searchEntries,
  serializeSearchIndex,
} from '../src/lib/search.ts';

function makeEntry(overrides = {}) {
  return {
    href: '/posts/default/',
    title: '默认文章',
    description: '',
    pubDate: '2026-01-01',
    category: '随笔',
    tags: [],
    readingMinutes: 1,
    searchText: '',
    ...overrides,
  };
}

test('markdownToSearchText keeps visible text while removing Markdown, HTML, and URL targets', () => {
  const markdown = `
# Ｆｅｉｓｈｕ [飞书同步](https://example.com/private?q=secret)

![架构图](https://cdn.example.com/private.png "图片标题")

\`const value = 1;\`

<div>HTML 文本</div>

**加粗** _斜体_ ~~删除线~~

\`\`\`ts
const answer = 42;
\`\`\`
`;

  const text = markdownToSearchText(markdown);

  assert.equal(
    text,
    'Feishu 飞书同步 架构图 const value = 1; HTML 文本 加粗 斜体 删除线 const answer = 42;',
  );
  assert.doesNotMatch(text, /https?:|example\.com|private|secret|图片标题/);
});

test('markdownToSearchText removes bare and code URLs while retaining other code text', () => {
  const markdown = `
访问 https://internal.example/hidden-bare?token=bare-secret 查看说明。

\`const endpoint = "https://internal.example/hidden-inline?token=inline-secret";\`

\`\`\`js
fetch("https://internal.example/hidden-block?token=block-secret");
const retry = 3;
\`\`\`
`;

  const text = markdownToSearchText(markdown);

  assert.match(text, /访问/);
  assert.match(text, /查看说明/);
  assert.match(text, /const endpoint/);
  assert.match(text, /fetch/);
  assert.match(text, /const retry = 3;/);
  assert.doesNotMatch(
    text,
    /https?:|internal\.example|hidden-(?:bare|inline|block)|token|(?:bare|inline|block)-secret/,
  );
});

test('markdownToSearchText caps normalized output at 12,000 characters', () => {
  const text = markdownToSearchText(`  ${'文'.repeat(12_050)}  `);

  assert.equal(text.length, 12_000);
  assert.equal(text, '文'.repeat(12_000));
});

test('buildSearchEntry exposes only public search fields and copies tags', () => {
  const tags = ['Astro', '飞书'];
  const post = {
    id: 'private/source-record.md',
    body: '# 可搜索正文',
    data: {
      slug: 'public-route',
      title: '公开标题',
      description: '公开摘要',
      pubDate: new Date('2026-06-08T12:00:00+08:00'),
      category: '工程',
      column: '博客搭建',
      columnOrder: 3,
      tags,
      cover: '/private/cover.png',
    },
  };

  const entry = buildSearchEntry(post);

  assert.deepEqual(entry, {
    href: '/posts/public-route/',
    title: '公开标题',
    description: '公开摘要',
    pubDate: '2026-06-08',
    category: '工程',
    column: '博客搭建',
    columnOrder: 3,
    tags: ['Astro', '飞书'],
    readingMinutes: 1,
    searchText: '可搜索正文',
  });
  assert.notStrictEqual(entry.tags, tags);
  assert.equal('id' in entry, false);
  assert.equal(JSON.stringify(entry).includes('source-record'), false);
  assert.equal('cover' in entry, false);
});

test('buildSearchEntry omits optional column fields when the source has none', () => {
  const entry = buildSearchEntry({
    id: 'manual/standalone.md',
    body: '正文',
    data: {
      title: '独立文章',
      description: '摘要',
      pubDate: new Date('2026-05-01'),
      category: '随笔',
      tags: [],
    },
  });

  assert.equal('column' in entry, false);
  assert.equal('columnOrder' in entry, false);
});

test('buildSearchEntry requires the Markdown body', () => {
  assert.throws(
    () =>
      buildSearchEntry({
        id: 'manual/missing-body.md',
        data: {
          title: '无正文',
          description: '摘要',
          pubDate: new Date('2026-05-01'),
          category: '随笔',
          tags: [],
        },
      }),
    /body/i,
  );
});

test('normalizeSearchQuery applies NFKC, zh-CN lowercase, and whitespace normalization', () => {
  assert.equal(
    normalizeSearchQuery('  ＦＥＩＳＨＵ\n\t Astro  '),
    'feishu astro',
  );
});

test('searchEntries finds Chinese terms such as 飞书', () => {
  const matching = makeEntry({
    href: '/posts/feishu/',
    searchText: '从飞书发布博客文章',
  });
  const unrelated = makeEntry({
    href: '/posts/astro/',
    searchText: 'Astro 静态站点',
  });

  assert.deepEqual(searchEntries([unrelated, matching], ' 飞书 '), [matching]);
});

test('searchEntries matches 专栏 博客搭建 across taxonomy fields', () => {
  const matching = makeEntry({
    href: '/posts/column-post/',
    category: '专栏',
    column: '博客搭建',
    columnOrder: 2,
  });
  const partial = makeEntry({
    href: '/posts/partial/',
    category: '专栏',
    column: '效率工具',
    columnOrder: 1,
  });

  assert.deepEqual(searchEntries([partial, matching], '专栏 博客搭建'), [
    matching,
  ]);
});

test('searchEntries requires every whitespace-delimited term to match', () => {
  const complete = makeEntry({
    href: '/posts/complete/',
    title: 'Astro 指南',
    searchText: '飞书发布工作流',
  });
  const titleOnly = makeEntry({
    href: '/posts/title-only/',
    title: 'Astro 入门',
  });
  const bodyOnly = makeEntry({
    href: '/posts/body-only/',
    searchText: '飞书发布工作流',
  });

  assert.deepEqual(
    searchEntries([bodyOnly, titleOnly, complete], ' astro\n飞书 '),
    [complete],
  );
});

test('searchEntries sorts an empty query by newest date and then href', () => {
  const older = makeEntry({
    href: '/posts/older/',
    pubDate: '2025-12-31',
  });
  const newestB = makeEntry({
    href: '/posts/b/',
    pubDate: '2026-06-01',
  });
  const newestA = makeEntry({
    href: '/posts/a/',
    pubDate: '2026-06-01',
  });

  assert.deepEqual(searchEntries([older, newestB, newestA], '   '), [
    newestA,
    newestB,
    older,
  ]);
});

test('searchEntries ranks exact, prefix, and contained title matches by weight', () => {
  const taxonomy = makeEntry({
    href: '/posts/taxonomy/',
    title: '内容管理',
    category: '飞书',
  });
  const contains = makeEntry({
    href: '/posts/contains/',
    title: '如何连接飞书',
  });
  const prefix = makeEntry({
    href: '/posts/prefix/',
    title: '飞书同步',
  });
  const exact = makeEntry({
    href: '/posts/exact/',
    title: '飞书',
  });

  assert.deepEqual(
    searchEntries([taxonomy, contains, prefix, exact], '飞书'),
    [exact, prefix, contains, taxonomy],
  );
});

test('searchEntries adds taxonomy weight to a contained title match', () => {
  const prefixOnly = makeEntry({
    href: '/posts/prefix-only/',
    title: '飞书入门',
  });
  const titleAndTaxonomy = makeEntry({
    href: '/posts/title-and-taxonomy/',
    title: '如何使用飞书',
    category: '飞书工具',
  });

  assert.deepEqual(
    searchEntries([prefixOnly, titleAndTaxonomy], '飞书'),
    [titleAndTaxonomy, prefixOnly],
  );
});

test('searchEntries applies the default and explicit limits', () => {
  const entries = Array.from({ length: 10 }, (_, index) =>
    makeEntry({
      href: `/posts/${String(index).padStart(2, '0')}/`,
      title: '匹配',
    }),
  );

  assert.equal(searchEntries(entries, '匹配').length, 8);
  assert.deepEqual(searchEntries(entries, '匹配', 2), entries.slice(0, 2));
});

test('searchEntries does not mutate the input array or entry objects', () => {
  const first = Object.freeze(
    makeEntry({
      href: '/posts/first/',
      title: '飞书',
      tags: Object.freeze(['发布']),
    }),
  );
  const second = Object.freeze(
    makeEntry({
      href: '/posts/second/',
      title: '飞书同步',
      tags: Object.freeze(['工具']),
    }),
  );
  const entries = Object.freeze([second, first]);

  const result = searchEntries(entries, '飞书');

  assert.deepEqual(entries, [second, first]);
  assert.deepEqual(result, [first, second]);
  assert.strictEqual(result[0], first);
  assert.strictEqual(result[1], second);
});

test('serializeSearchIndex escapes script-sensitive characters and round-trips', () => {
  const entries = [
    makeEntry({
      title: '<script>alert("x")</script> & safe',
      description: `line${'\u2028'}separator${'\u2029'}paragraph`,
    }),
  ];

  const serialized = serializeSearchIndex(entries);

  assert.doesNotMatch(serialized, /[<>&\u2028\u2029]/u);
  assert.match(serialized, /\\u003c/);
  assert.match(serialized, /\\u003e/);
  assert.match(serialized, /\\u0026/);
  assert.match(serialized, /\\u2028/);
  assert.match(serialized, /\\u2029/);
  assert.deepEqual(JSON.parse(serialized), entries);
});

test('serializeSearchIndex accepts and safely serializes a versioned index object', () => {
  const index = {
    version: 1,
    entries: [
      makeEntry({
        title: '<公开>&',
        description: `line${'\u2028'}separator${'\u2029'}paragraph`,
      }),
    ],
  };

  const serialized = serializeSearchIndex(index);
  const searchSource = readFileSync(
    new URL('../src/lib/search.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(serialized, /[<>&\u2028\u2029]/u);
  assert.deepEqual(JSON.parse(serialized), index);
  assert.match(
    searchSource,
    /export function serializeSearchIndex\(\s*\w+: unknown\s*\): string/,
  );
});
