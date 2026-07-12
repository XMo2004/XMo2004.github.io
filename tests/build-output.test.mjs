import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';

import { normalizeTag } from '../src/lib/posts.ts';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const distRoot = new URL('../dist/', import.meta.url);

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

before(runCleanBuild);

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

test('search index contains only deterministic public article data', async () => {
  const source = await readOutput('search-index.json');
  const index = JSON.parse(source);
  const requiredEntryFields = [
    'href',
    'title',
    'description',
    'pubDate',
    'category',
    'tags',
    'readingMinutes',
    'searchText',
  ];
  const allowedEntryFields = new Set([
    ...requiredEntryFields,
    'column',
    'columnOrder',
  ]);

  assert.equal(index.version, 1);
  assert.deepEqual(index.entries.map(({ href }) => href), [
    '/posts/published-from-feishu/',
    '/posts/welcome/',
  ]);
  assert.equal(index.entries[0].category, '技术');
  assert.equal(index.entries[0].column, '博客搭建手记');
  assert.match(index.entries[0].searchText, /用飞书写作/);

  for (const entry of index.entries) {
    assert.ok(
      requiredEntryFields.every((field) => Object.hasOwn(entry, field)),
      'search entries should contain every required public field',
    );
    assert.ok(
      Object.keys(entry).every((field) => allowedEntryFields.has(field)),
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

  assert.doesNotMatch(
    source,
    /recvp|dspq|file_token|document_id|record_id|source[ _-]?id|my\.feishu\.cn|file:\/\/|\/Users\/|\/home\/|[a-z]:\\|Documents\/Blog|\.worktrees/iu,
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
