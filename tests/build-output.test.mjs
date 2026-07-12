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

before(runCleanBuild);

test('clean build emits every public entry point as a non-empty file', async () => {
  const tagSlug = normalizeTag('建站');
  const expectedFiles = [
    'index.html',
    'posts/index.html',
    'posts/welcome/index.html',
    'tags/index.html',
    `tags/${tagSlug}/index.html`,
    'about/index.html',
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

test('article output has canonical metadata, safe BlogPosting data, and article content', async () => {
  const articleHtml = await readOutput('posts/welcome/index.html');

  assert.match(
    articleHtml,
    /<link rel="canonical" href="https:\/\/xmo2004\.github\.io\/posts\/welcome\/">/,
  );
  assert.match(articleHtml, /"@type":"BlogPosting"/);
  assert.match(articleHtml, /<article\b/);
  assert.match(articleHtml, /欢迎来到小陌的博客/);
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

test('sitemap contains article and tag destinations', async () => {
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
});
