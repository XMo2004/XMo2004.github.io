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

import { normalizeTag } from '../src/lib/posts.ts';

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
