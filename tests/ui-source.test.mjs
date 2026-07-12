import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('BaseLayout provides Chinese document metadata and an accessible page shell', async () => {
  const source = await readSource('src/layouts/BaseLayout.astro');

  assert.match(source, /<html\s+lang=["']zh-CN["']/);
  assert.match(source, /跳到正文/);
  assert.match(source, /rel=["']canonical["']/);
  assert.match(source, /<main\s+id=["']main-content["']/);
  assert.match(source, /SiteHeader/);
  assert.match(source, /SiteFooter/);
});

test('BaseLayout emits site metadata without inventing a social preview image', async () => {
  const source = await readSource('src/layouts/BaseLayout.astro');

  assert.match(source, /SITE/);
  assert.match(source, /property=["']og:title["']/);
  assert.match(source, /property=["']og:description["']/);
  assert.match(source, /name=["']twitter:card["']/);
  assert.match(source, /name=["']theme-color["']/);
  assert.doesNotMatch(source, /og:image|twitter:image/);
});

test('BaseLayout starts the saved or system theme before paint', async () => {
  const source = await readSource('src/layouts/BaseLayout.astro');

  assert.match(source, /localStorage\.getItem\(["']xmo-theme["']\)/);
  assert.match(source, /matchMedia\(["']\(prefers-color-scheme: dark\)["']\)/);
  assert.match(source, /dataset\.theme/);
});

test('global styles define the editorial tokens and accessibility safeguards', async () => {
  const [source, homeSource, archiveSource, aboutSource, notFoundSource] =
    await Promise.all([
      readSource('src/styles/global.css'),
      readSource('src/pages/index.astro'),
      readSource('src/pages/posts/index.astro'),
      readSource('src/pages/about.astro'),
      readSource('src/pages/404.astro'),
    ]);

  assert.match(source, /--paper:\s*#f4f0e7/i);
  assert.match(source, /--terracotta:\s*#b84f35/i);
  assert.match(source, /\[data-theme=["']dark["']\]/);
  assert.match(source, /:focus-visible/);
  assert.match(source, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(source, /@media\s*\(max-width:/);
  assert.match(source, /text-wrap:\s*pretty/);
  assert.match(
    source,
    /\.tag-list a\s*\{[^}]*min-height:\s*2\.75rem;[^}]*\}/s,
  );
  assert.match(
    source,
    /\.tag-list--compact a\s*\{[^}]*min-height:\s*2\.75rem;[^}]*\}/s,
  );
  assert.match(
    source,
    /\.wordmark\s*\{(?=[^}]*min-height:\s*2\.75rem;)(?=[^}]*display:\s*inline-flex;)[^}]*\}/s,
  );
  assert.match(
    source,
    /\.site-footer__inner a\s*\{(?=[^}]*min-height:\s*2\.75rem;)(?=[^}]*display:\s*inline-flex;)[^}]*\}/s,
  );
  assert.match(
    source,
    /\.text-link\s*\{[^}]*min-height:\s*2\.75rem;[^}]*\}/s,
  );
  assert.match(
    source,
    /\.standalone-action\s*\{(?=[^}]*min-height:\s*2\.75rem;)(?=[^}]*display:\s*inline-flex;)[^}]*\}/s,
  );

  for (const pageSource of [
    homeSource,
    archiveSource,
    aboutSource,
    notFoundSource,
  ]) {
    assert.match(pageSource, /class=["']standalone-action["']/);
  }
});

test('SiteHeader keeps all primary destinations available and marks the current one', async () => {
  const source = await readSource('src/components/SiteHeader.astro');

  for (const label of ['首页', '文章', '标签', '关于']) {
    assert.match(source, new RegExp(label));
  }

  assert.match(source, /aria-current/);
  assert.match(source, /ThemeToggle/);
});

test('ThemeToggle exposes state and persists the selected theme', async () => {
  const source = await readSource('src/components/ThemeToggle.astro');

  assert.match(source, /aria-pressed/);
  assert.match(source, /aria-label/);
  assert.match(source, /localStorage\.setItem\(["']xmo-theme["']/);
  assert.match(source, /dataset\.theme/);
});

test('post components use safe post and tag routes', async () => {
  const [cardSource, tagListSource] = await Promise.all([
    readSource('src/components/PostCard.astro'),
    readSource('src/components/TagList.astro'),
  ]);

  assert.match(cardSource, /normalizeTag/);
  assert.match(cardSource, /data\.slug\s*\?\?/);
  assert.match(cardSource, /<article/);
  assert.match(cardSource, /<time/);
  assert.match(tagListSource, /normalizeTag/);
  assert.match(tagListSource, /<ul/);
  assert.match(tagListSource, /\/tags\//);
});

test('index and archive pages use the real collection in newest-first order', async () => {
  const [homeSource, postsSource] = await Promise.all([
    readSource('src/pages/index.astro'),
    readSource('src/pages/posts/index.astro'),
  ]);

  assert.match(homeSource, /getCollection\(["']posts["']\)/);
  assert.match(homeSource, /sortNewestFirst/);
  assert.match(homeSource, /关于技术、成长与日常的长期笔记。/);
  assert.match(homeSource, /featured/);
  assert.match(postsSource, /getCollection\(["']posts["']\)/);
  assert.match(postsSource, /sortNewestFirst/);
});

test('supporting pages keep their copy honest and offer recovery', async () => {
  const [aboutSource, notFoundSource] = await Promise.all([
    readSource('src/pages/about.astro'),
    readSource('src/pages/404.astro'),
  ]);

  assert.match(aboutSource, /技术、成长与日常/);
  assert.match(aboutSource, /飞书/);
  assert.match(aboutSource, /Git/);
  assert.match(aboutSource, /Markdown/);
  assert.match(notFoundSource, /404/);
  assert.match(notFoundSource, /返回首页/);
});

test('PostLayout renders only the article extras supplied by a caller', async () => {
  const source = await readSource('src/layouts/PostLayout.astro');

  for (const prop of [
    'updatedDate',
    'readingMinutes',
    'sourceUrl',
    'headings',
    'previous',
    'next',
  ]) {
    assert.match(source, new RegExp(prop));
  }

  assert.match(source, /<article/);
  assert.match(source, /class=["']prose["']/);
  assert.match(source, /<slot\s*\/>/);
});
