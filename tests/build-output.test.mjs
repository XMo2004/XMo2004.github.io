import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';

import { normalizeTag } from '../src/lib/posts.ts';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const distRoot = new URL('../dist/', import.meta.url);
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

async function runCleanBuild() {
  await rm(distRoot, { recursive: true, force: true });

  await new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'build'], {
      cwd: projectRoot,
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
}

async function readOutput(relativePath) {
  return readFile(new URL(relativePath, distRoot), 'utf8');
}

function readJsonLd(html) {
  const match = html.match(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/,
  );

  assert.ok(match, 'page should include JSON-LD');
  return JSON.parse(match[1]);
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
    assert.match(entry.pubDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof entry.category, 'string');
    assert.ok(Array.isArray(entry.tags));
    assert.ok(entry.tags.every((tag) => typeof tag === 'string'));
    assert.ok(Number.isInteger(entry.readingMinutes));
    assert.equal(typeof entry.searchText, 'string');
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
    'posts/published-from-feishu/index.html',
  );

  assert.doesNotMatch(articleHtml, /<aside class="post-toc post-toc--desktop"/);
  assert.doesNotMatch(articleHtml, /<details class="post-toc-compact"/);
  assert.doesNotMatch(articleHtml, /post-layout--with-toc/);
  assert.doesNotMatch(articleHtml, /<summary>本页目录<\/summary>/);
});

test('column articles render ordered series navigation without duplicate generic pagination', async () => {
  const welcome = await readOutput('posts/welcome/index.html');
  const feishu = await readOutput('posts/published-from-feishu/index.html');
  const columnHref = `/columns/${normalizeTag('博客搭建手记')}/`;

  assert.match(welcome, /01\s*\/\s*02/);
  assert.match(welcome, /下一节/);
  assert.match(welcome, /href="\/posts\/published-from-feishu\/"/);
  assert.match(welcome, new RegExp(`href="${columnHref}"`));
  assert.match(feishu, /02\s*\/\s*02/);
  assert.match(feishu, /上一节/);
  assert.match(feishu, /href="\/posts\/welcome\/"/);
  assert.match(feishu, new RegExp(`href="${columnHref}"`));
  assert.doesNotMatch(welcome, /上一篇|下一篇/);
  assert.doesNotMatch(feishu, /上一篇|下一篇/);
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
  assert.match(feishuEntry.searchText, /用飞书写作/);
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
