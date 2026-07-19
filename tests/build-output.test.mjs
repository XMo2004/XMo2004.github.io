import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';

import { blocksToMarkdown } from '../scripts/feishu/blocks.mjs';
import { decodeFeishuHtmlEntities } from '../src/lib/feishu-markup.ts';
import { normalizeTag } from '../src/lib/posts.ts';

const richFixture = JSON.parse(
  await readFile(
    new URL('./fixtures/feishu-rich-content.json', import.meta.url),
    'utf8',
  ),
);
const legacyFixture = JSON.parse(
  await readFile(
    new URL('./fixtures/feishu-legacy-document.json', import.meta.url),
    'utf8',
  ),
);

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const buildInputPaths = [
  'astro.config.mjs',
  'package-lock.json',
  'package.json',
  'public',
  'src',
  'tsconfig.json',
];
const loneBodyH1FixtureSlug = 'build-output-lone-h1';
const loneBodyH1Fixture = `---
title: 构建输出单标题文章
description: 用稳定的手写正文验证单一一级标题不会生成目录。
pubDate: 2026-01-01
category: 测试
column: Build Contract
columnOrder: 1
tags: []
featured: false
slug: ${loneBodyH1FixtureSlug}
---

# 正文唯一一级标题
`;
const normalizedColumnPeerFixture = `---
title: 构建输出规范化专栏文章
description: 验证兼容形式与大小写不同的专栏名称仍属于同一专栏。
pubDate: 2026-01-02
category: 测试
column: ＢＵＩＬＤ ＣＯＮＴＲＡＣＴ
columnOrder: 2
tags: []
featured: false
slug: build-output-normalized-column
---

这篇手写夹具只用于验证专栏名称规范化。
`;
const structuredCoverFixtureSlug = 'build-output-structured-cover';
const structuredCoverFixture = `---
title: 构建输出结构化封面文章
description: 用真实内容集合条目验证结构化响应式封面输出。
pubDate: 2025-12-31
category: 测试
tags: []
featured: false
slug: ${structuredCoverFixtureSlug}
cover:
  src: /media/cover-contract-960.webp
  width: 960
  height: 540
  variants:
    - src: /media/cover-contract-320.webp
      width: 320
    - src: /media/cover-contract-640.webp
      width: 640
    - src: /media/cover-contract-960.webp
      width: 960
---

这篇手写夹具只用于验证结构化响应式封面。
`;
const legacyCoverFixtureSlug = 'build-output-legacy-cover';
const legacyCoverFixture = `---
title: 构建输出旧版封面文章
description: 用真实内容集合条目验证旧版字符串封面兼容输出。
pubDate: 2025-12-30
category: 测试
tags: []
featured: false
slug: ${legacyCoverFixtureSlug}
cover: /media/cover-contract-legacy.jpg
---

这篇手写夹具只用于验证旧版字符串封面。
`;
const coverContractPage = `---
import { getCollection } from 'astro:content';

import PostCard from '../components/PostCard.astro';
import PostRow from '../components/PostRow.astro';

const posts = await getCollection('posts');
const structuredEntry = posts.find(
  ({ data }) => data.slug === '${structuredCoverFixtureSlug}',
);
const legacyEntry = posts.find(
  ({ data }) => data.slug === '${legacyCoverFixtureSlug}',
);

if (structuredEntry === undefined || legacyEntry === undefined) {
  throw new Error('Cover contract fixtures were not loaded.');
}
---

<section id="structured-card">
  <PostCard entry={structuredEntry} priority />
</section>
<section id="structured-row">
  <PostRow entry={structuredEntry} />
</section>
<section id="legacy-card">
  <PostCard entry={legacyEntry} priority />
</section>
<section id="legacy-row">
  <PostRow entry={legacyEntry} />
</section>
`;
const richFrontmatter = [
  '---',
  'title: 飞书富内容构建夹具',
  'description: 仅用于生产构建验证',
  'pubDate: 2026-07-15',
  'category: 工程',
  'tags:',
  '  - 飞书',
  'featured: false',
  'slug: build-output-feishu-rich-content',
  '---',
].join('\n');
const richSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"',
  ' viewBox="0 0 16 16"><rect width="16" height="16" fill="#2257a0"/></svg>',
].join('');
const expectedRichEquationSources = [
  'h + i',
  'x + y',
  'a | b\n% 注释\n+ c',
  Array.from(
    { length: 32 },
    (_, index) => 'x_{' + (index + 1) + '}',
  ).join(' + '),
  Array.from(
    { length: 32 },
    (_, index) => 'y_{' + (index + 1) + '}',
  ).join(' + '),
  's = t',
  'p | q',
];
const protocolBlocks = [
  {
    block_id: 'protocol-page',
    block_type: 1,
    children: [
      'protocol-code',
      'protocol-inline-code',
      'protocol-styled-literal',
      'protocol-private-url',
      'protocol-formula',
      'protocol-table',
    ],
    page: { elements: [] },
  },
  {
    block_id: 'protocol-code',
    block_type: 14,
    parent_id: 'protocol-page',
    code: {
      style: { language: 24 },
      elements: [{
        text_run: {
          content: [
            '<span data-feishu-equation-source="eA">伪公式</span>',
            '<h2 id="feishu-heading-9" data-feishu-heading-text="@@">伪标题</h2>',
            '<span data-feishu-search-ui>伪界面</span>',
          ].join('\n'),
          text_element_style: {},
        },
      }],
    },
  },
  {
    block_id: 'protocol-inline-code',
    block_type: 2,
    parent_id: 'protocol-page',
    text: {
      elements: [{
        text_run: {
          content: [
            '<span data-feishu-equation-source="@@">行内伪公式</span>',
            '<h2 id="feishu-heading-99" data-feishu-heading-text="@@">行内伪标题</h2>',
            '<span data-feishu-search-ui>行内伪界面</span>',
          ].join(' '),
          text_element_style: { inline_code: true },
        },
      }],
    },
  },
  {
    block_id: 'protocol-formula',
    block_type: 2,
    parent_id: 'protocol-page',
    text: {
      elements: [{
        equation: {
          content: 'z + 1 + \\text{*x* `y` [z](w)}',
          text_element_style: {},
        },
      }],
    },
  },
  {
    block_id: 'protocol-styled-literal',
    block_type: 2,
    parent_id: 'protocol-page',
    text: {
      elements: [{
        text_run: {
          content: '字面 *x* _y_ `z` [链接](target) \\ | 尾\r\n下一行',
          text_element_style: { underline: true, background_color: 2 },
        },
      }],
    },
  },
  {
    block_id: 'protocol-private-url',
    block_type: 2,
    parent_id: 'protocol-page',
    text: {
      elements: [{
        text_run: {
          content: '私有链接 https://private.example/path',
          text_element_style: { underline: true },
        },
      }],
    },
  },
  {
    block_id: 'protocol-table',
    block_type: 31,
    parent_id: 'protocol-page',
    children: [
      'protocol-cell-a',
      'protocol-cell-b',
      'protocol-cell-c',
      'protocol-cell-d',
    ],
    table: {
      cells: [
        'protocol-cell-a',
        'protocol-cell-b',
        'protocol-cell-c',
        'protocol-cell-d',
      ],
      property: { row_size: 2, column_size: 2 },
    },
  },
  ...['a', 'b', 'c', 'd'].flatMap((suffix, index) => {
    const elements = index === 2
      ? [{
          equation: {
            content: 'm | n\n% 表格注释\n+ r',
            text_element_style: {
              bold: true,
              underline: true,
              text_color: 1,
              background_color: 2,
              link: { url: 'https://example.com/gfm-table' },
            },
          },
        }]
      : [{
          text_run: {
            content: index === 3
              ? '表格 | *字* `码`\r\n下一行'
              : ['列 A', '列 B', ''][index],
            text_element_style: index === 3
              ? {
                  underline: true,
                  background_color: 2,
                  link: { url: 'https://example.com/a|b' },
                }
              : {},
          },
        }];
    const cellId = 'protocol-cell-' + suffix;

    return [
      {
        block_id: cellId,
        block_type: 32,
        parent_id: 'protocol-table',
        children: [cellId + '-text'],
        table_cell: {},
      },
      {
        block_id: cellId + '-text',
        block_type: 2,
        parent_id: cellId,
        text: { elements },
      },
    ];
  }),
];
let temporaryBuildRoot;
let distRoot;
const requiredSearchEntryFields = [
  'href',
  'title',
  'description',
  'pubDate',
  'category',
  'tags',
  'readingMinutes',
  'searchText',
];
const allowedSearchEntryFields = new Set([
  ...requiredSearchEntryFields,
  'column',
  'columnOrder',
]);

function getNodeModulesLinkType(platform) {
  return platform === 'win32' ? 'junction' : 'dir';
}

async function runCleanBuild() {
  temporaryBuildRoot = await mkdtemp(
    join(tmpdir(), 'xmo-blog-build-output-'),
  );
  const temporaryProjectRoot = join(temporaryBuildRoot, 'project');

  try {
    await mkdir(temporaryProjectRoot);
    await Promise.all(
      buildInputPaths.map((relativePath) =>
        cp(
          join(projectRoot, relativePath),
          join(temporaryProjectRoot, relativePath),
          { recursive: true },
        ),
      ),
    );
    await symlink(
      join(projectRoot, 'node_modules'),
      join(temporaryProjectRoot, 'node_modules'),
      getNodeModulesLinkType(process.platform),
    );
    await Promise.all([
      mkdir(
        join(temporaryProjectRoot, 'src/content/posts/feishu'),
        { recursive: true },
      ),
      mkdir(
        join(temporaryProjectRoot, 'public/media/feishu'),
        { recursive: true },
      ),
    ]);

    const converted = blocksToMarkdown(structuredClone(richFixture.items));
    const richBody = converted.mediaReferences.reduce(
      (markdown, { placeholder }) =>
        markdown.replaceAll(
          placeholder,
          '/media/feishu/build-output-rich.svg',
        ),
      converted.markdown,
    );
    const richPost = richFrontmatter + '\n' + richBody;
    const legacyConverted = blocksToMarkdown(
      structuredClone(legacyFixture.items),
    );
    const legacyBody = legacyConverted.mediaReferences.reduce(
      (markdown, { placeholder }) =>
        markdown.replaceAll(
          placeholder,
          '/media/feishu/build-output-rich.svg',
        ),
      legacyConverted.markdown,
    );
    const legacyPost = [
      '---',
      'title: 飞书旧格式构建夹具',
      'description: 验证默认 Markdown 兼容',
      'pubDate: 2026-07-14',
      'category: 工程',
      'tags: []',
      'featured: false',
      'slug: build-output-feishu-legacy',
      '---',
      '',
      legacyBody,
    ].join('\n');
    const protocolConverted = blocksToMarkdown(
      structuredClone(protocolBlocks),
    );
    const protocolPost = [
      '---',
      'title: 飞书协议代码边界夹具',
      'description: 验证默认 Markdown 代码伪协议',
      'pubDate: 2026-07-13',
      'category: 工程',
      'tags: []',
      'featured: false',
      'slug: build-output-feishu-code-protocol',
      '---',
      '',
      protocolConverted.markdown,
    ].join('\n');

    await Promise.all([
      writeFile(
        join(
          temporaryProjectRoot,
          'src/content/posts/feishu/rich-content.md',
        ),
        richPost,
        { encoding: 'utf8', flag: 'wx' },
      ),
      writeFile(
        join(
          temporaryProjectRoot,
          'src/content/posts/manual/build-output-feishu-legacy.md',
        ),
        legacyPost,
        { encoding: 'utf8', flag: 'wx' },
      ),
      writeFile(
        join(
          temporaryProjectRoot,
          'src/content/posts/manual/build-output-feishu-code-protocol.md',
        ),
        protocolPost,
        { encoding: 'utf8', flag: 'wx' },
      ),
      writeFile(
        join(
          temporaryProjectRoot,
          'public/media/feishu/build-output-rich.svg',
        ),
        richSvg,
        { encoding: 'utf8', flag: 'wx' },
      ),
      writeFile(
        join(
          temporaryProjectRoot,
          'src/content/posts/manual/build-output-lone-h1.md',
        ),
        loneBodyH1Fixture,
        { encoding: 'utf8', flag: 'wx' },
      ),
      writeFile(
        join(
          temporaryProjectRoot,
          'src/content/posts/manual/build-output-normalized-column.md',
        ),
        normalizedColumnPeerFixture,
        { encoding: 'utf8', flag: 'wx' },
      ),
      writeFile(
        join(
          temporaryProjectRoot,
          'src/content/posts/manual/build-output-structured-cover.md',
        ),
        structuredCoverFixture,
        { encoding: 'utf8', flag: 'wx' },
      ),
      writeFile(
        join(
          temporaryProjectRoot,
          'src/content/posts/manual/build-output-legacy-cover.md',
        ),
        legacyCoverFixture,
        { encoding: 'utf8', flag: 'wx' },
      ),
      writeFile(
        join(temporaryProjectRoot, 'src/pages/cover-contract.astro'),
        coverContractPage,
        { encoding: 'utf8', flag: 'wx' },
      ),
    ]);
    distRoot = pathToFileURL(join(temporaryProjectRoot, 'dist', sep));

    await new Promise((resolve, reject) => {
      const child = spawn('npm', ['run', 'build'], {
        cwd: temporaryProjectRoot,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';

      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Clean production build failed with exit code ${code}:\n${output}`));
        }
      });
    });
  } catch (error) {
    await rm(temporaryBuildRoot, { recursive: true, force: true });
    temporaryBuildRoot = undefined;
    distRoot = undefined;
    throw error;
  }
}

after(async () => {
  if (temporaryBuildRoot !== undefined) {
    await rm(temporaryBuildRoot, { recursive: true, force: true });
  }
});

async function readOutput(relativePath) {
  assert.ok(distRoot, 'clean build should initialize its output directory');
  return readFile(new URL(relativePath, distRoot), 'utf8');
}

function readEquationSources(html) {
  const sources = [];

  for (const [openingTag] of html.matchAll(/<span\b[^>]*>/g)) {
    const classValue = openingTag.match(/\bclass="([^"]*)"/)?.[1];

    if (
      classValue === undefined ||
      !classValue.split(/\s+/).includes('feishu-equation')
    ) {
      continue;
    }

    const encodedSource = openingTag.match(
      /\bdata-feishu-equation-source="([A-Za-z0-9_-]+)"/,
    )?.[1];

    assert.ok(encodedSource, 'each rendered Feishu equation should keep its source');
    sources.push(Buffer.from(encodedSource, 'base64url').toString('utf8'));
  }

  return sources;
}

function readSection(html, id) {
  const openingTag = new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>`).exec(
    html,
  );

  assert.ok(openingTag, `cover contract should include the ${id} section`);

  const start = openingTag.index;
  const end = html.indexOf('</section>', start + openingTag[0].length);

  assert.notEqual(end, -1, `${id} section should have a closing tag`);
  return html.slice(start, end + '</section>'.length);
}

function readOnlyImageAttributes(section, label) {
  const imageTags = section.match(/<img\b[^>]*>/g) ?? [];

  assert.equal(imageTags.length, 1, `${label} should render exactly one image`);

  const attributes = {};
  for (const match of imageTags[0].matchAll(
    /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g,
  )) {
    attributes[match[1]] = match[2] ?? match[3] ?? '';
  }

  return attributes;
}

function assertImageContract(html, sectionId, expected, absent) {
  const attributes = readOnlyImageAttributes(
    readSection(html, sectionId),
    sectionId,
  );

  for (const [name, value] of Object.entries(expected)) {
    assert.equal(
      attributes[name],
      value,
      `${sectionId} image should emit ${name}="${value}"`,
    );
  }

  for (const name of absent) {
    assert.equal(
      Object.hasOwn(attributes, name),
      false,
      `${sectionId} image should omit ${name}`,
    );
  }
}

function readJsonLd(html) {
  const match = html.match(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/,
  );

  assert.ok(match, 'page should include JSON-LD');
  return JSON.parse(match[1]);
}

function getArticleOutputPath(href) {
  assert.match(href, /^\/posts\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/);
  return `${href.slice(1)}index.html`;
}

function readSeriesNavigation(html) {
  const startMarker = '<section class="post-series-navigation"';
  const start = html.indexOf(startMarker);

  assert.notEqual(start, -1, 'column article should include series navigation');

  const end = html.indexOf('</section>', start);

  assert.notEqual(end, -1, 'series navigation should have a closing section');
  return html.slice(start, end + '</section>'.length);
}

function readSeriesLink(seriesHtml, direction) {
  return seriesHtml.match(
    new RegExp(
      `<a class="[^"]*post-series-navigation__link--${direction}[^"]*"[^>]*>`,
    ),
  )?.[0];
}

function assertPublicSearchIndexContract(source) {
  const index = JSON.parse(source);

  assert.equal(index.version, 1);
  assert.ok(Array.isArray(index.entries), 'search index entries should be an array');

  for (const entry of index.entries) {
    assert.ok(
      requiredSearchEntryFields.every((field) => Object.hasOwn(entry, field)),
      'search entries should contain every required public field',
    );
    assert.ok(
      Object.keys(entry).every((field) => allowedSearchEntryFields.has(field)),
      'search entries should not contain private or unknown fields',
    );
    assert.equal(typeof entry.href, 'string');
    assert.equal(typeof entry.title, 'string');
    assert.equal(typeof entry.description, 'string');
    assert.ok(entry.title.trim().length > 0);
    assert.ok(entry.description.trim().length > 0);
    assert.match(entry.pubDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof entry.category, 'string');
    assert.ok(Array.isArray(entry.tags));
    assert.ok(entry.tags.every((tag) => typeof tag === 'string'));
    assert.ok(Number.isInteger(entry.readingMinutes));
    assert.equal(typeof entry.searchText, 'string');
    assert.ok(entry.searchText.trim().length > 0);
    assert.equal(
      Object.hasOwn(entry, 'column'),
      Object.hasOwn(entry, 'columnOrder'),
    );

    if (Object.hasOwn(entry, 'column')) {
      assert.equal(typeof entry.column, 'string');
      assert.ok(Number.isInteger(entry.columnOrder));
    }
  }

  for (let entryIndex = 1; entryIndex < index.entries.length; entryIndex += 1) {
    const previousEntry = index.entries[entryIndex - 1];
    const currentEntry = index.entries[entryIndex];
    const dateOrder = previousEntry.pubDate.localeCompare(
      currentEntry.pubDate,
      'en',
    );

    assert.ok(
      dateOrder >= 0,
      'search entries should be sorted by pubDate descending',
    );

    if (dateOrder === 0) {
      assert.ok(
        previousEntry.href.localeCompare(currentEntry.href, 'en') <= 0,
        'search entries should be sorted by href ascending when pubDate ties',
      );
    }
  }

  assert.doesNotMatch(source, /recvp|DsPQ|my\.feishu\.cn/u);

  return index;
}

function makeSearchIndexEntry(overrides = {}) {
  return {
    href: '/posts/default/',
    title: '公开文章',
    description: '公开摘要',
    pubDate: '2026-01-01',
    category: '技术',
    tags: [],
    readingMinutes: 1,
    searchText: '公开正文',
    ...overrides,
  };
}

before(runCleanBuild);

test('temporary build selects a Windows-safe node_modules link type', () => {
  assert.equal(getNodeModulesLinkType('win32'), 'junction');
  assert.equal(getNodeModulesLinkType('linux'), 'dir');
  assert.equal(getNodeModulesLinkType('darwin'), 'dir');
});

test('search index contract accepts additional articles and legitimate technical prose', () => {
  const source = JSON.stringify({
    version: 1,
    entries: [
      makeSearchIndexEntry({
        href: '/posts/third/',
        pubDate: '2026-07-13',
      }),
      makeSearchIndexEntry({
        href: '/posts/a/',
        pubDate: '2026-07-12',
        searchText: '解释 record_id、file_token 与 /home/user',
      }),
      makeSearchIndexEntry({
        href: '/posts/b/',
        pubDate: '2026-07-12',
        column: '博客搭建手记',
        columnOrder: 3,
      }),
    ],
  });

  const index = assertPublicSearchIndexContract(source);

  assert.equal(index.entries.length, 3);
});

test('search index contract rejects ascending publication dates', () => {
  const source = JSON.stringify({
    version: 1,
    entries: [
      makeSearchIndexEntry({ pubDate: '2026-07-12' }),
      makeSearchIndexEntry({ pubDate: '2026-07-13' }),
    ],
  });

  assert.throws(
    () => assertPublicSearchIndexContract(source),
    /pubDate descending/,
  );
});

test('search index contract rejects descending hrefs on a same-day tie', () => {
  const source = JSON.stringify({
    version: 1,
    entries: [
      makeSearchIndexEntry({ href: '/posts/b/', pubDate: '2026-07-12' }),
      makeSearchIndexEntry({ href: '/posts/a/', pubDate: '2026-07-12' }),
    ],
  });

  assert.throws(
    () => assertPublicSearchIndexContract(source),
    /href ascending/,
  );
});

test('clean build emits every public entry point as a non-empty file', async () => {
  const tagSlug = normalizeTag('建站');
  const categorySlug = normalizeTag('技术');
  const columnSlug = normalizeTag('博客搭建手记');
  const expectedFiles = [
    'index.html',
    'posts/index.html',
    'posts/welcome/index.html',
    'categories/index.html',
    `categories/${categorySlug}/index.html`,
    'columns/index.html',
    `columns/${columnSlug}/index.html`,
    'tags/index.html',
    `tags/${tagSlug}/index.html`,
    'about/index.html',
    'search-index.json',
    'rss.xml',
    'sitemap-index.xml',
    'robots.txt',
    '404.html',
  ];

  for (const relativePath of expectedFiles) {
    const outputStat = await stat(new URL(relativePath, distRoot));

    assert.ok(outputStat.isFile(), `${relativePath} should be a file`);
    assert.ok(outputStat.size > 0, `${relativePath} should not be empty`);
  }
});

test('cover contract renders structured and legacy images by page position', async () => {
  await assert.rejects(
    stat(join(projectRoot, 'src/pages/cover-contract.astro')),
    { code: 'ENOENT' },
    'the cover contract page must exist only in the temporary build copy',
  );

  const html = await readOutput('cover-contract/index.html');
  const structuredSrcset = [
    '/media/cover-contract-320.webp 320w',
    '/media/cover-contract-640.webp 640w',
    '/media/cover-contract-960.webp 960w',
  ].join(', ');
  const structuredCommon = {
    src: '/media/cover-contract-960.webp',
    srcset: structuredSrcset,
    width: '960',
    height: '540',
    alt: '',
    decoding: 'async',
  };
  const legacyCommon = {
    src: '/media/cover-contract-legacy.jpg',
    alt: '',
    decoding: 'async',
  };

  assertImageContract(
    html,
    'structured-card',
    {
      ...structuredCommon,
      sizes: '(max-width: 48rem) calc(100vw - 2rem), 30rem',
      loading: 'eager',
      fetchpriority: 'high',
    },
    [],
  );
  assertImageContract(
    html,
    'structured-row',
    {
      ...structuredCommon,
      sizes: '(max-width: 30rem) 1px, (max-width: 48rem) 5.25rem, 7rem',
      loading: 'lazy',
    },
    ['fetchpriority'],
  );
  assertImageContract(
    html,
    'legacy-card',
    {
      ...legacyCommon,
      loading: 'eager',
      fetchpriority: 'high',
    },
    ['srcset', 'sizes', 'width', 'height'],
  );
  assertImageContract(
    html,
    'legacy-row',
    {
      ...legacyCommon,
      loading: 'lazy',
    },
    ['srcset', 'sizes', 'width', 'height', 'fetchpriority'],
  );
});

test('article output has canonical metadata, safe BlogPosting data, taxonomy links, and article content', async () => {
  const articleHtml = await readOutput('posts/welcome/index.html');
  const jsonLd = readJsonLd(articleHtml);

  assert.match(
    articleHtml,
    /<link rel="canonical" href="https:\/\/xmo2004\.github\.io\/posts\/welcome\/">/,
  );
  assert.equal(jsonLd['@type'], 'BlogPosting');
  assert.equal(jsonLd.articleSection, '随笔');
  assert.deepEqual(jsonLd.isPartOf, {
    '@type': 'CollectionPage',
    name: '博客搭建手记',
    url: new URL(
      `/columns/${normalizeTag('博客搭建手记')}/`,
      'https://xmo2004.github.io',
    ).href,
  });
  assert.ok(
    articleHtml.includes(`href="/categories/${normalizeTag('随笔')}/"`),
  );
  assert.ok(
    articleHtml.includes(
      `href="/columns/${normalizeTag('博客搭建手记')}/"`,
    ),
  );
  assert.match(articleHtml, /<article\b/);
  assert.match(articleHtml, /欢迎来到小陌的博客/);
});

test('article output omits both contents variants for a lone body h1', async () => {
  const articleHtml = await readOutput(
    `posts/${loneBodyH1FixtureSlug}/index.html`,
  );

  assert.match(articleHtml, /<h1 id="正文唯一一级标题">正文唯一一级标题<\/h1>/);
  assert.doesNotMatch(articleHtml, /<aside class="post-toc post-toc--desktop"/);
  assert.doesNotMatch(articleHtml, /<details class="post-toc-compact"/);
  assert.doesNotMatch(articleHtml, /post-layout--with-toc/);
  assert.doesNotMatch(articleHtml, /<summary>本页目录<\/summary>/);
});

test('build renders the complete controlled Feishu document', async () => {
  const html = await readOutput(
    'posts/build-output-feishu-rich-content/index.html',
  );

  assert.equal((html.match(/class="feishu-document"/g) ?? []).length, 1);
  assert.match(html, /class="katex-html"/);
  assert.match(html, /<math\b/);
  assert.match(html, /class="feishu-source-synced"/);

  const firstCalloutText = html.indexOf('高亮块 1');
  const firstCalloutStart = html.lastIndexOf('<aside', firstCalloutText);
  const firstCalloutEnd = html.indexOf('</aside>', firstCalloutText);
  const calloutListText = html.indexOf('高亮块内列表');
  assert.ok(
    firstCalloutStart >= 0 &&
      calloutListText > firstCalloutStart &&
      calloutListText < firstCalloutEnd,
    'the first callout should contain its list before the callout closes',
  );
  const firstCalloutHtml = html.slice(
    firstCalloutStart,
    firstCalloutEnd + '</aside>'.length,
  );
  assert.match(firstCalloutHtml, /class="feishu-text-color--blue"/);
  assert.match(
    firstCalloutHtml,
    /<span class="feishu-callout__emoji" aria-hidden="true">🎁<\/span>/,
  );
  const calloutHeadingId = firstCalloutHtml.match(
    /<h2\b[^>]*id="(feishu-heading-\d+)"[^>]*>[\s\S]*?高亮块内标题[\s\S]*?<\/h2>/,
  )?.[1];
  assert.ok(calloutHeadingId);
  assert.match(
    firstCalloutHtml,
    /<blockquote\b[^>]*>[\s\S]*高亮块内引用[\s\S]*<\/blockquote>/,
  );
  assert.match(
    firstCalloutHtml,
    /<li\b[^>]*>[\s\S]*高亮块内列表[\s\S]*<ul\b[^>]*>[\s\S]*<li\b[^>]*>[\s\S]*嵌套列表项[\s\S]*<\/li>[\s\S]*<\/ul>[\s\S]*<\/li>/,
  );

  const sourceStart = html.indexOf('<section class="feishu-source-synced">');
  const sourceEnd = html.indexOf('</section>', sourceStart);
  const sourceHtml = html.slice(sourceStart, sourceEnd + '</section>'.length);
  assert.match(
    sourceHtml,
    /class="feishu-source-synced__title feishu-source-synced__title--align-center"/,
  );
  const sourceHeadingId = sourceHtml.match(
    /<h2\b[^>]*id="(feishu-heading-\d+)"[^>]*>[\s\S]*?同步块内标题[\s\S]*?<\/h2>/,
  )?.[1];
  assert.ok(sourceHeadingId);
  const sourceListText = sourceHtml.indexOf('列表包含高亮块');
  const nestedCalloutText = sourceHtml.indexOf('列表内高亮块');
  const sourceListEnd = sourceHtml.indexOf('</li>', sourceListText);
  assert.ok(
    sourceListText >= 0 &&
      nestedCalloutText > sourceListText &&
      nestedCalloutText < sourceListEnd,
    'the source list item should contain a callout before the item closes',
  );
  for (const tag of [
    'blockquote',
    'a',
    'strong',
    'em',
    'del',
    'u',
    'code',
    'table',
    'img',
  ]) {
    assert.match(
      sourceHtml,
      new RegExp('<' + tag + '\\b'),
      'source synced content is missing rendered <' + tag + '>',
    );
  }
  assert.match(
    html,
    /<pre\b[^>]*><code\b[^>]*>[\s\S]*未配对反引号[\s\S]*伪公式[\s\S]*<\/code><\/pre>/,
  );
  assert.match(
    html,
    /<p\b[^>]*>[\s\S]*<u class="feishu-underline"><code>[\s\S]*HTML 行内伪公式[\s\S]*HTML 行内伪标题[\s\S]*HTML 行内伪界面[\s\S]*<\/code><\/u>[\s\S]*<\/p>/,
  );

  const tableHtml = sourceHtml.match(/<table\b[\s\S]*?<\/table>/)?.[0];
  assert.ok(tableHtml);
  const tableRows = [...tableHtml.matchAll(/<tr\b[\s\S]*?<\/tr>/g)]
    .map((match) => match[0]);
  assert.equal(tableRows.length, 2);
  assert.equal((tableRows[0].match(/<th\b/g) ?? []).length, 2);
  assert.equal((tableRows[1].match(/<td\b/g) ?? []).length, 2);
  assert.match(html, /<ol>[\s\S]*受控有序列表[\s\S]*<\/ol>/);
  assert.match(
    html,
    /class="feishu-task-list"[\s\S]*class="feishu-task-list__marker" aria-hidden="true">☑<\/span><span class="visually-hidden">已完成：<\/span>[\s\S]*受控待办事项/,
  );
  assert.match(
    html,
    /class="feishu-task-list"[\s\S]*class="feishu-task-list__marker" aria-hidden="true">☐<\/span><span class="visually-hidden">未完成：<\/span>[\s\S]*未完成待办事项/,
  );
  assert.match(html, /<hr\s*\/?>/);
  assert.doesNotMatch(
    html,
    /\uE000feishu-media:|\x60{3}|\*\*&lt;组合样式&gt;\*\*|~~&lt;组合样式&gt;~~|\[仅背景链接\]\(https:\/\/example\.com\/background-only\)/,
  );

  assert.deepEqual(
    readEquationSources(html).toSorted(),
    expectedRichEquationSources.toSorted(),
  );

  const headingIds = [...html.matchAll(
    /<h[1-6]\b[^>]*\bid="(feishu-heading-\d+)"/g,
  )].map((match) => match[1]);
  assert.deepEqual(
    headingIds,
    headingIds.map((_, index) => 'feishu-heading-' + (index + 1)),
  );
  assert.equal(new Set(headingIds).size, headingIds.length);
  for (const [containerHeadingId, label] of [
    [calloutHeadingId, '高亮块内标题'],
    [sourceHeadingId, '同步块内标题'],
  ]) {
    assert.ok(headingIds.includes(containerHeadingId));
    assert.equal(
      (
        html.match(
          new RegExp(
            'href="#' + containerHeadingId + '"[^>]*>' + label + '<\\/a>',
            'g',
          ),
        ) ?? []
      ).length,
      2,
    );
  }
  for (const headingId of headingIds) {
    assert.ok(
      (html.match(new RegExp('href="#' + headingId + '"', 'g')) ?? [])
        .length >= 2,
      'desktop and mobile TOCs should link to ' + headingId,
    );
  }
  assert.equal(
    (
      html.match(
        /href="#feishu-heading-1"[^>]*>公式标题 h \+ i<\/a>/g,
      ) ?? []
    ).length,
    2,
  );
  const duplicateHeadingIds = [...html.matchAll(
    /<h3\b[^>]*id="(feishu-heading-\d+)"[^>]*data-feishu-heading-text="5pmu6YCa5qCH6aKY"/g,
  )].map((match) => match[1]);
  assert.equal(duplicateHeadingIds.length, 2);
  assert.equal(new Set(duplicateHeadingIds).size, 2);
  for (const headingId of duplicateHeadingIds) {
    assert.equal(
      (html.match(new RegExp('href="#' + headingId + '"', 'g')) ?? []).length,
      2,
    );
  }

  const legacyHtml = await readOutput(
    'posts/build-output-feishu-legacy/index.html',
  );
  assert.doesNotMatch(legacyHtml, /class="feishu-document"/);
  assert.match(legacyHtml, /<h2 id="二级标题">二级标题<\/h2>/);

  const protocolHtml = await readOutput(
    'posts/build-output-feishu-code-protocol/index.html',
  );
  assert.doesNotMatch(protocolHtml, /class="feishu-document"/);
  assert.match(protocolHtml, /伪公式/);
  assert.match(protocolHtml, /行内伪公式/);
  assert.match(protocolHtml, /行内伪标题/);
  assert.match(protocolHtml, /行内伪界面/);
  const markdownPunctuationFormula =
    'z + 1 + \\text{*x* `y` [z](w)}';
  const markdownPunctuationSource = Buffer.from(
    markdownPunctuationFormula,
  ).toString('base64url');
  const protocolParagraphs = [...protocolHtml.matchAll(
    /<p\b[^>]*>[\s\S]*?<\/p>/g,
  )].map((match) => match[0]);
  const markdownPunctuationParagraph = protocolParagraphs.find((paragraph) =>
    paragraph.includes(
      'data-feishu-equation-source="' + markdownPunctuationSource + '"',
    ));
  assert.ok(markdownPunctuationParagraph);
  assert.doesNotMatch(markdownPunctuationParagraph, /<(?:em|code|a)\b/);

  const styledParagraph = protocolParagraphs.find((paragraph) =>
    paragraph.includes('字面 ') && paragraph.includes('下一行'));
  assert.ok(styledParagraph);
  assert.match(styledParagraph, /<u class="feishu-underline">/);
  assert.match(
    styledParagraph,
    /class="feishu-text-background--light-orange"/,
  );
  assert.doesNotMatch(styledParagraph, /<(?:em|code|a)\b/);
  assert.equal(
    decodeFeishuHtmlEntities(styledParagraph.replace(/<[^>]+>/g, ''))
      .replace(/\r\n?/g, '\n'),
    '字面 *x* _y_ `z` [链接](target) \\ | 尾\n下一行',
  );

  const privateUrlParagraph = protocolParagraphs.find((paragraph) =>
    paragraph.includes('私有链接'));
  assert.ok(privateUrlParagraph);
  assert.match(privateUrlParagraph, /<!---->/);
  assert.doesNotMatch(privateUrlParagraph, /<a\b/);
  assert.equal(
    decodeFeishuHtmlEntities(privateUrlParagraph.replace(/<[^>]+>/g, '')),
    '私有链接 https://private.example/path',
  );

  const protocolTable = protocolHtml.match(/<table\b[\s\S]*?<\/table>/)?.[0];
  assert.ok(protocolTable);
  const protocolRows = [...protocolTable.matchAll(/<tr\b[\s\S]*?<\/tr>/g)]
    .map((match) => match[0]);
  assert.equal(protocolRows.length, 2);
  assert.equal((protocolRows[0].match(/<th\b/g) ?? []).length, 2);
  assert.equal((protocolRows[1].match(/<td\b/g) ?? []).length, 2);
  const protocolCells = [...protocolRows[1].matchAll(
    /<td\b[\s\S]*?<\/td>/g,
  )].map((match) => match[0]);
  assert.equal(protocolCells.length, 2);
  const [formulaCell, styledCell] = protocolCells;
  assert.match(
    formulaCell,
    /^<td\b[^>]*><a class="feishu-link" href="https:\/\/example\.com\/gfm-table"><span class="feishu-text-color--red feishu-text-background--light-orange"><u class="feishu-underline"><strong><span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="[A-Za-z0-9_-]+">[\s\S]*<\/span><\/strong><\/u><\/span><\/a><\/td>$/,
  );
  assert.doesNotMatch(formulaCell, /feishu-equation--block/);
  assert.match(
    styledCell,
    /class="feishu-text-background--light-orange"/,
  );
  assert.match(styledCell, /<u class="feishu-underline">/);
  assert.equal((styledCell.match(/<a\b/g) ?? []).length, 1);
  assert.match(
    styledCell,
    /class="feishu-link" href="https:\/\/example\.com\/a(?:\||&#124;)b"/,
  );
  assert.doesNotMatch(styledCell, /<(?:em|code)\b/);
  assert.equal(
    decodeFeishuHtmlEntities(styledCell.replace(/<[^>]+>/g, ''))
      .replace(/\r\n?/g, '\n'),
    '表格 | *字* `码`\n下一行',
  );
  assert.deepEqual(
    readEquationSources(protocolHtml).toSorted(),
    [markdownPunctuationFormula, 'm | n\n% 表格注释\n+ r'].toSorted(),
  );

  assert.equal(
    await readOutput('media/feishu/build-output-rich.svg'),
    richSvg,
  );
});

test('column articles render ordered series navigation without duplicate generic pagination', async () => {
  const index = assertPublicSearchIndexContract(
    await readOutput('search-index.json'),
  );
  const entriesByColumnRoute = new Map();

  for (const entry of index.entries) {
    if (entry.column === undefined || entry.columnOrder === undefined) {
      continue;
    }

    const columnRoute = normalizeTag(entry.column);
    let columnGroup = entriesByColumnRoute.get(columnRoute);

    if (columnGroup === undefined) {
      columnGroup = { label: entry.column, entries: [] };
      entriesByColumnRoute.set(columnRoute, columnGroup);
    }

    columnGroup.entries.push(entry);
  }

  assert.ok(
    entriesByColumnRoute.size > 0,
    'build should include at least one column',
  );

  for (const [columnRoute, columnGroup] of entriesByColumnRoute) {
    const columnOrders = new Set();

    for (const entry of columnGroup.entries) {
      assert.ok(
        !columnOrders.has(entry.columnOrder),
        `column route "${columnRoute}" should not repeat order ${entry.columnOrder}`,
      );
      columnOrders.add(entry.columnOrder);
    }

    const { label: column, entries: unorderedEntries } = columnGroup;
    const entries = unorderedEntries.toSorted(
      (first, second) => first.columnOrder - second.columnOrder,
    );
    const total = entries.length;
    const displayTotal = String(total).padStart(2, '0');
    const columnHref = `/columns/${normalizeTag(column)}/`;

    for (const [index, entry] of entries.entries()) {
      const articleHtml = await readOutput(getArticleOutputPath(entry.href));
      const seriesHtml = readSeriesNavigation(articleHtml);
      const position = index + 1;
      const displayPosition = String(position).padStart(2, '0');
      const previous = entries[index - 1];
      const next = entries[index + 1];

      assert.ok(seriesHtml.includes(`${displayPosition} / ${displayTotal}`));
      assert.ok(
        seriesHtml.includes(`专栏进度：第 ${position} 节，共 ${total} 节`),
      );
      assert.ok(seriesHtml.includes(`href="${columnHref}"`));

      const previousLink = readSeriesLink(seriesHtml, 'previous');
      if (previous === undefined) {
        assert.equal(previousLink, undefined);
      } else {
        assert.ok(previousLink, 'non-first column article should link back');
        assert.ok(previousLink.includes(`href="${previous.href}"`));
        assert.ok(previousLink.includes('rel="prev"'));
      }

      const nextLink = readSeriesLink(seriesHtml, 'next');
      if (next === undefined) {
        assert.equal(nextLink, undefined);
      } else {
        assert.ok(nextLink, 'non-final column article should link forward');
        assert.ok(nextLink.includes(`href="${next.href}"`));
        assert.ok(nextLink.includes('rel="next"'));
      }

      assert.doesNotMatch(articleHtml, /<nav class="post-pagination(?:\s|")/);
    }
  }
});

test('search index contains only deterministic public article data', async () => {
  const source = await readOutput('search-index.json');
  const index = assertPublicSearchIndexContract(source);
  const feishuEntry = index.entries.find(
    ({ href }) => href === '/posts/published-from-feishu/',
  );

  assert.ok(feishuEntry, 'the published Feishu article should be indexed');
  assert.ok(
    index.entries.some(({ href }) => href === '/posts/welcome/'),
    'the welcome article should be indexed',
  );
  assert.equal(feishuEntry.category, '技术');
  assert.equal(feishuEntry.column, '博客搭建手记');

  for (const entry of index.entries) {
    const articleHtml = await readOutput(getArticleOutputPath(entry.href));
    const jsonLd = readJsonLd(articleHtml);

    assert.equal(jsonLd.headline, entry.title);
    assert.equal(jsonLd.description, entry.description);
    assert.ok(entry.searchText.trim().length > 0);
  }
});

test('build indexes Feishu formulas once without visual or UI noise', async () => {
  const index = assertPublicSearchIndexContract(
    await readOutput('search-index.json'),
  );
  const entry = index.entries.find(
    ({ href }) => href === '/posts/build-output-feishu-rich-content/',
  );
  assert.ok(entry);
  for (const source of expectedRichEquationSources) {
    const normalizedSource = source.replace(/\s+/g, ' ');
    assert.equal(
      entry.searchText.split(normalizedSource).length - 1,
      1,
      'the search index should contain the equation source once: ' +
        normalizedSource,
    );
  }
  assert.match(entry.searchText, /伪公式/);
  assert.match(entry.searchText, /伪标题/);
  assert.match(entry.searchText, /伪界面/);
  assert.match(entry.searchText, /HTML 行内伪公式/);
  assert.match(entry.searchText, /HTML 行内伪标题/);
  assert.match(entry.searchText, /HTML 行内伪界面/);
  assert.doesNotMatch(entry.searchText, /private\.example|html-code/);
  assert.doesNotMatch(
    entry.searchText,
    /katex|mathml|↻ 同步内容|feishu-document|feishu-callout|feishu-equation--/i,
  );

  const protocolEntry = index.entries.find(
    ({ href }) => href === '/posts/build-output-feishu-code-protocol/',
  );
  assert.ok(protocolEntry);
  assert.match(protocolEntry.searchText, /伪公式/);
  assert.match(protocolEntry.searchText, /行内伪公式/);
  assert.match(protocolEntry.searchText, /行内伪标题/);
  assert.match(protocolEntry.searchText, /行内伪界面/);
  assert.equal((protocolEntry.searchText.match(/z \+ 1/g) ?? []).length, 1);
  assert.equal(
    (
      protocolEntry.searchText.match(/m \| n % 表格注释 \+ r/g) ?? []
    ).length,
    1,
  );
  assert.equal(
    (
      protocolEntry.searchText.match(
        /字面 \*x\* _y_ `z` \[链接\]\(target\) \\ \| 尾 下一行/g,
      ) ?? []
    ).length,
    1,
  );
  assert.match(protocolEntry.searchText, /私有链接/);
  assert.doesNotMatch(protocolEntry.searchText, /https?:|example\.com|private/i);

  const html = await readOutput(
    'posts/build-output-feishu-rich-content/index.html',
  );
  assert.match(html, /<link\b[^>]*href="[^"]+\.css"/);
  assert.doesNotMatch(html, /<script\b[^>]*src="[^"]*katex/i);
  const outputFiles = await readdir(fileURLToPath(distRoot), {
    recursive: true,
  });
  assert.ok(
    outputFiles.some((path) => /KaTeX_[^/]+\.(?:woff2?|ttf)$/i.test(path)),
    'the production build should emit KaTeX fonts',
  );
  const browserJavaScript = (
    await Promise.all(
      outputFiles
        .filter((path) => path.endsWith('.js'))
        .map((path) =>
          readFile(join(fileURLToPath(distRoot), path), 'utf8')),
    )
  ).join('\n');
  assert.doesNotMatch(browserJavaScript, /node:buffer|\bBuffer\.from\b/);
  assert.doesNotMatch(
    browserJavaScript,
    /KaTeX parse error|katex-error|\brenderToString\b/i,
  );
});

test('RSS identifies the site and links to the published article URL', async () => {
  const rss = await readOutput('rss.xml');

  assert.match(rss, /<title>小陌的博客<\/title>/);
  assert.match(rss, /https:\/\/xmo2004\.github\.io\/posts\/welcome\//);
});

test('robots allows crawling and points to the absolute sitemap URL', async () => {
  const robots = await readOutput('robots.txt');

  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(
    robots,
    /^Sitemap: https:\/\/xmo2004\.github\.io\/sitemap-index\.xml$/m,
  );
});

test('sitemap contains article and taxonomy destinations', async () => {
  const outputFiles = await readdir(distRoot);
  const sitemapFiles = outputFiles.filter(
    (fileName) => fileName.startsWith('sitemap-') && fileName !== 'sitemap-index.xml',
  );
  const sitemap = (
    await Promise.all(sitemapFiles.map((fileName) => readOutput(fileName)))
  ).join('\n');

  assert.match(sitemap, /https:\/\/xmo2004\.github\.io\/posts\/welcome\//);
  assert.ok(
    sitemap.includes(
      new URL(`/tags/${normalizeTag('建站')}/`, 'https://xmo2004.github.io').href,
    ),
  );
  assert.ok(
    sitemap.includes(
      new URL(
        `/categories/${normalizeTag('技术')}/`,
        'https://xmo2004.github.io',
      ).href,
    ),
  );
  assert.ok(
    sitemap.includes(
      new URL(
        `/columns/${normalizeTag('博客搭建手记')}/`,
        'https://xmo2004.github.io',
      ).href,
    ),
  );
});
