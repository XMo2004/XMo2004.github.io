import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function equation(source, body = '<span class="katex">rendered KaTeX</span>') {
  return `<span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="${encodeBase64Url(source)}">${body}</span>`;
}

function controlledDocumentWithEquation(source) {
  return [
    '<div class="feishu-document">',
    '<p>公式 ',
    equation(
      source,
      `<span class="katex"><span class="katex-mathml"><math><semantics><annotation>${source}</annotation></semantics></math></span><span class="katex-html">${source}</span></span>`,
    ),
    ' 完成</p>',
    '<span class="feishu-source-synced__label" data-feishu-search-ui>同步内容</span>',
    '</div>',
  ].join('');
}

function encodeHtmlCode(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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

test('indexes each Feishu equation source once and removes container UI', () => {
  const markdown = controlledDocumentWithEquation('x + y');
  const text = markdownToSearchText(markdown);

  assert.equal(text.match(/x \+ y/g)?.length, 1);
  assert.doesNotMatch(text, /katex|MathML|同步内容|feishu-/i);
});

test('keeps an equation source protected from generic URL cleanup', () => {
  const source = String.raw`\text{https://formula.example/path}`;
  const text = markdownToSearchText(controlledDocumentWithEquation(source));

  assert.equal(
    (text.match(/\\text\{https:\/\/formula\.example\/path\}/g) ?? []).length,
    1,
  );
});

test('keeps controlled visible punctuation while removing its URLs', () => {
  const markdown = '<u class="feishu-underline">字面 &#42;x&#42; &#95;y&#95; &#96;z&#96; &#91;标签&#93; &#124; https&#58;&#47;&#47;private&#46;example&#47;path 尾</u>';
  const text = markdownToSearchText(markdown);

  assert.match(text, /字面 \*x\* _y_ `z` \[标签\] \| 尾/);
  assert.doesNotMatch(text, /https?|private|example|path/);
});

test('treats protocol-looking text in all four code kinds as code while finding the following equation', () => {
  const exactEquation = '<span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="QQ"><span class="katex">rendered</span></span>';
  const exactHeading = '<h2 id="feishu-heading-1" data-feishu-heading-text="5qCH6aKY">标题</h2>';
  const exactSearchUi = '<span class="feishu-source-synced__label" data-feishu-search-ui>同步内容</span>';
  const nearEquation = '<span data-feishu-equation-source="Qg">x</span>';
  const nearHeading = '<h2 id="feishu-heading-9" data-feishu-heading-text="@@">x</h2>';
  const nearSearchUi = '<span data-feishu-search-ui>近似同步内容</span>';
  const codeMarkup = [
    exactEquation,
    exactHeading,
    exactSearchUi,
    nearEquation,
    nearHeading,
    nearSearchUi,
    'https://private.example/path',
  ].join(' ');
  const encoded = encodeHtmlCode(codeMarkup);
  const markdown = [
    '````html',
    codeMarkup,
    '````',
    `\`${codeMarkup}\``,
    `<pre><code>${encoded}</code></pre>`,
    `<code>${encoded}</code>`,
    equation('real + equation'),
  ].join('\n');

  const text = markdownToSearchText(markdown);

  for (const visibleCodeFragment of [
    exactEquation,
    exactHeading,
    exactSearchUi,
    nearEquation,
    nearHeading,
    nearSearchUi,
  ]) {
    assert.equal(
      text.split(visibleCodeFragment).length - 1,
      4,
      visibleCodeFragment,
    );
  }
  assert.equal(text.match(/real \+ equation/g)?.length, 1);
  assert.doesNotMatch(text, /https?|private\.example|\/path/);
});

test('rejects malformed Feishu protocols outside code', () => {
  assert.throws(
    () => markdownToSearchText(
      '<span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="@@">x</span>',
    ),
    /Invalid controlled Feishu markup/,
  );
});

test('keeps equation and code boundaries searchable without separating adjacent styled text', () => {
  const markdown = [
    `<p>前文${equation('x + y')}后文</p>`,
    '<p><u>飞</u><strong>书</strong></p>',
    '<p>前文`code`后文</p>',
  ].join('\n');

  assert.equal(
    markdownToSearchText(markdown),
    '前文 x + y 后文 飞书 前文 code 后文',
  );
});

test('removes URLs reconstructed by entities, comments, and phrasing wrappers', () => {
  const formulaSource = String.raw`\text{https://formula.example/path}`;
  const markdown = [
    '<div class="feishu-document">',
    '<p>实体 https&#58;&#47;&#47;private&#46;example&#47;entity 尾</p>',
    '<p>注释 https<!---->://private.example/comment 尾</p>',
    '<p>样式 <span>https</span><u>://private.example/wrapper</u> 尾</p>',
    `<p>公式 ${equation(formulaSource)} 完成</p>`,
    '</div>',
  ].join('');

  const text = markdownToSearchText(markdown);

  assert.doesNotMatch(text, /private|entity|comment|wrapper/);
  assert.equal(
    (text.match(/\\text\{https:\/\/formula\.example\/path\}/g) ?? []).length,
    1,
  );
});

test('removes raw HTML subtrees and keeps block boundaries visible', () => {
  const markdown = [
    '<p>前</p><script>https://private.example/script secretScript</script><p>后</p>',
    '<style>.private { color: red }</style>',
    '<template>secretTemplate</template>',
  ].join('');

  assert.equal(markdownToSearchText(markdown), '前 后');
});

test('preserves legacy Markdown inline-code whitespace normalization', () => {
  assert.equal(
    markdownToSearchText('前``  code\n value  ``后'),
    '前 code value 后',
  );
});

test('markdownToSearchText removes balanced-parenthesis bare URLs and autolinks completely', () => {
  const markdown = `
前 https://internal.example/docs_(bare_secret)/view?token=top_secret 后

<https://internal.example/auto_(auto_secret)/view?token=other_secret> 结束
`;

  const text = markdownToSearchText(markdown);

  assert.equal(text, '前 后 结束');
  assert.doesNotMatch(
    text,
    /https?|internal|docs|auto|view|token|(?:bare|auto|top|other)_?secret/i,
  );
});

test('markdownToSearchText removes complete HTML tags with quoted greater-than signs', () => {
  const markdown = `
<div data-secret="value > internal_record_id" title="/Users/xmo/private.md">
公开文本
</div>
`;

  const text = markdownToSearchText(markdown);

  assert.equal(text, '公开文本');
  assert.doesNotMatch(text, /data-secret|internal_record_id|Users|private\.md/);
});

test('markdownToSearchText removes multiline reference destinations and titles', () => {
  const markdown = `
[公开文档][private-ref]

[private-ref]:
  /Users/xmo/private_record.md
  "internal-document-id-123"

正文
`;

  const text = markdownToSearchText(markdown);

  assert.equal(text, '公开文档 正文');
  assert.doesNotMatch(
    text,
    /private-ref|Users|private_record|internal-document-id/i,
  );
});

test('markdownToSearchText preserves underscores in visible identifiers', () => {
  assert.equal(
    markdownToSearchText('读取 private_record_id 与 snake_case。'),
    '读取 private_record_id 与 snake_case。',
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

test('buildSearchEntry rejects MDX before hidden code can enter the public index', () => {
  assert.throws(
    () =>
      buildSearchEntry({
        id: 'public-route',
        filePath: '/Users/xmo/private/private-runtime.mdx',
        body: `import secret from '/Users/xmo/private/token.ts'
export const apiKey = 'sk-private'

# Public article

{apiKey}`,
        data: {
          title: 'MDX article',
          description: 'Public description',
          pubDate: new Date('2026-05-01'),
          category: '技术',
          tags: [],
        },
      }),
    /MDX/i,
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

test('searchEntries includes a description-only match', () => {
  const matching = makeEntry({
    href: '/posts/description-only/',
    description: '使用飞书自动发布文章',
  });
  const unrelated = makeEntry({ href: '/posts/unrelated/' });

  assert.deepEqual(searchEntries([unrelated, matching], '飞书'), [matching]);
});

test('searchEntries includes a tag-only match', () => {
  const matching = makeEntry({
    href: '/posts/tag-only/',
    tags: ['飞书发布'],
  });
  const unrelated = makeEntry({ href: '/posts/unrelated/' });

  assert.deepEqual(searchEntries([unrelated, matching], '飞书'), [matching]);
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
  const entries = Object.freeze([older, newestB, newestA]);

  assert.deepEqual(searchEntries(entries, '   '), [
    newestA,
    newestB,
    older,
  ]);
  assert.deepEqual(searchEntries(entries, '   ', 1), [newestA]);
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

test('searchEntries breaks equal-score ties by date and then href', () => {
  const older = makeEntry({
    href: '/posts/older/',
    title: '飞书',
    pubDate: '2025-12-31',
  });
  const newestB = makeEntry({
    href: '/posts/b/',
    title: '飞书',
    pubDate: '2026-06-01',
  });
  const newestA = makeEntry({
    href: '/posts/a/',
    title: '飞书',
    pubDate: '2026-06-01',
  });

  assert.deepEqual(searchEntries([older, newestB, newestA], '飞书'), [
    newestA,
    newestB,
    older,
  ]);
});

test('searchEntries applies the default and explicit limits', () => {
  const entries = Array.from({ length: 10 }, (_, index) =>
    makeEntry({
      href: `/posts/${String(index).padStart(2, '0')}/`,
      title: '匹配',
    }),
  );

  assert.equal(searchEntries(entries, '匹配').length, 8);

  const bodyOnly = makeEntry({
    href: '/posts/body-only/',
    searchText: '飞书',
  });
  const descriptionOnly = makeEntry({
    href: '/posts/description-only/',
    description: '飞书',
  });
  const highScoreLast = makeEntry({
    href: '/posts/high-score/',
    title: '飞书',
  });

  assert.deepEqual(
    searchEntries([bodyOnly, descriptionOnly, highScoreLast], '飞书', 1),
    [highScoreLast],
  );
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

  const populatedResult = searchEntries(entries, '飞书');
  const emptyResult = searchEntries(entries, '');

  assert.deepEqual(entries, [second, first]);
  assert.deepEqual(populatedResult, [first, second]);
  assert.deepEqual(emptyResult, [first, second]);
  assert.strictEqual(populatedResult[0], first);
  assert.strictEqual(populatedResult[1], second);
  assert.strictEqual(emptyResult[0], first);
  assert.strictEqual(emptyResult[1], second);
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

  assert.doesNotMatch(serialized, /[<>&\u2028\u2029]/u);
  assert.deepEqual(JSON.parse(serialized), index);
});
