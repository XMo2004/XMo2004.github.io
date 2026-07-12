import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('BaseLayout provides Chinese document metadata and an accessible page shell', async () => {
  const [source, footerSource] = await Promise.all([
    readSource('src/layouts/BaseLayout.astro'),
    readSource('src/components/SiteFooter.astro'),
  ]);

  assert.match(source, /<html\s+lang=["']zh-CN["']/);
  assert.match(source, /跳到正文/);
  assert.match(source, /rel=["']canonical["']/);
  assert.match(source, /<main\s+id=["']main-content["']/);
  assert.match(
    source,
    /<main\s+(?=[^>]*id=["']main-content["'])(?=[^>]*tabindex=["']-1["'])[^>]*>/,
  );
  assert.match(source, /SiteHeader/);
  assert.match(source, /SiteFooter/);
  assert.match(footerSource, /new Date\(\)\.getFullYear\(\)/);
  assert.doesNotMatch(footerSource, /©\s*2026/);
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
  assert.match(source, /--accent-text:\s*#9f422e/i);
  assert.match(source, /--accent-hover:\s*#566444/i);
  assert.match(
    source,
    /(?:^|\n)a\s*\{[^}]*color:\s*var\(--accent-text\);[^}]*\}/s,
  );
  assert.match(
    source,
    /a:hover\s*\{[^}]*color:\s*var\(--accent-hover\);[^}]*\}/s,
  );
  assert.match(
    source,
    /\.eyebrow\s*\{[^}]*color:\s*var\(--accent-text\);[^}]*\}/s,
  );
  assert.match(
    source,
    /\.button\s*\{(?=[^}]*background:\s*var\(--accent-text\);)(?=[^}]*color:\s*var\(--surface\);)[^}]*\}/s,
  );
  assert.match(
    source,
    /\.button:hover\s*\{(?=[^}]*background:\s*var\(--accent-hover\);)(?=[^}]*color:\s*var\(--surface\);)[^}]*\}/s,
  );
  assert.doesNotMatch(
    source,
    /(?:^|[\s;{])color:\s*var\(--(?:terracotta|sage|moss)\)/,
  );
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

  for (const label of ['首页', '文章', '分类', '专栏', '标签', '关于']) {
    assert.match(source, new RegExp(label));
  }

  assert.match(source, /href:\s*['"]\/categories\/['"]/);
  assert.match(source, /normalizedPath\.startsWith\(['"]\/categories\/['"]\)/);
  assert.match(source, /href:\s*['"]\/columns\/['"]/);
  assert.match(source, /normalizedPath\.startsWith\(['"]\/columns\/['"]\)/);
  assert.match(source, /aria-current/);
  assert.match(source, /ThemeToggle/);
});

test('ThemeToggle exposes state and persists the selected theme', async () => {
  const source = await readSource('src/components/ThemeToggle.astro');

  assert.match(source, /aria-pressed/);
  assert.match(source, /aria-label=["']深色模式["']/);
  assert.doesNotMatch(source, /setAttribute\(["']aria-label["']/);
  assert.doesNotMatch(source, /切换到(?:浅色|深色)模式/);
  assert.match(source, /localStorage\.setItem\(["']xmo-theme["']/);
  assert.match(source, /dataset\.theme/);
});

test('post components use safe post and taxonomy routes', async () => {
  const [cardSource, rowSource, tagListSource] = await Promise.all([
    readSource('src/components/PostCard.astro'),
    readSource('src/components/PostRow.astro'),
    readSource('src/components/TagList.astro'),
  ]);

  assert.match(cardSource, /normalizeTag/);
  assert.match(cardSource, /data\.slug\s*\?\?/);
  assert.match(cardSource, /headingLevel\?:\s*'h2'\s*\|\s*'h3'/);
  assert.match(cardSource, /headingLevel\s*=\s*'h2'/);
  assert.match(cardSource, /<Heading>/);
  assert.match(cardSource, /<article/);
  assert.match(cardSource, /<time/);
  assert.match(rowSource, /CollectionEntry<'posts'>/);
  assert.match(rowSource, /headingLevel\?:\s*'h2'\s*\|\s*'h3'/);
  assert.match(rowSource, /entry\.body/);
  assert.match(rowSource, /estimateReadingMinutes/);
  assert.match(rowSource, /getPostHref/);
  assert.match(rowSource, /getCategoryHref/);
  assert.match(rowSource, /getColumnHref/);
  assert.match(rowSource, /normalizeTag/);
  assert.match(rowSource, /columnOrder/);
  assert.match(rowSource, /padStart\(2,\s*['"]0['"]\)/);
  assert.match(rowSource, /post-row__stretched-link/);
  assert.match(rowSource, /post-row__taxonomy-link/);
  assert.match(
    rowSource,
    /\.post-row__stretched-link::after\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*\}/s,
  );
  assert.match(
    rowSource,
    /\.post-row__taxonomy-link\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;[^}]*\}/s,
  );
  assert.match(rowSource, /cover\s*&&/);
  assert.match(rowSource, /<article/);
  assert.match(rowSource, /<time/);
  assert.match(tagListSource, /normalizeTag/);
  assert.match(tagListSource, /<ul/);
  assert.match(tagListSource, /\/tags\//);
});

test('homepage and archive pages use dense real-content indexes and rows', async () => {
  const [homeSource, postsSource, tagSource] = await Promise.all([
    readSource('src/pages/index.astro'),
    readSource('src/pages/posts/index.astro'),
    readSource('src/pages/tags/[tag].astro'),
  ]);

  assert.match(homeSource, /getCollection\(["']posts["']\)/);
  assert.match(homeSource, /sortNewestFirst/);
  assert.match(homeSource, /buildCategoryIndex/);
  assert.match(homeSource, /buildColumnIndex/);
  assert.match(homeSource, /const\s+categoryIndex\s*=\s*buildCategoryIndex\(posts\)/);
  assert.match(homeSource, /const\s+columnIndex\s*=\s*buildColumnIndex\(posts\)/);
  assert.match(homeSource, /const\s+featured\s*=\s*posts\.find/);
  assert.match(homeSource, /post\s*!==\s*featured/);
  assert.match(homeSource, /slice\(0,\s*4\)/);
  assert.match(homeSource, /<PostCard\s+entry=\{featured\}\s+headingLevel=["']h3["']/);
  assert.match(homeSource, /<PostRow\s+entry=\{post\}\s+headingLevel=["']h3["']/);
  assert.match(homeSource, /aria-label=["']xmo 的博客["']/i);
  assert.match(homeSource, /aria-hidden=["']true["']/);
  assert.match(homeSource, /<svg/);
  assert.doesNotMatch(homeSource, /关于技术、成长与日常的长期笔记。/);
  assert.doesNotMatch(homeSource, /home-hero__actions|editorial-note/);
  assert.match(postsSource, /getCollection\(["']posts["']\)/);
  assert.match(postsSource, /sortNewestFirst/);
  assert.match(postsSource, /<PostRow\s+entry=\{post\}\s+headingLevel=["']h2["']/);
  assert.match(tagSource, /<PostRow\s+entry=\{post\}\s+headingLevel=["']h2["']/);
  assert.doesNotMatch(`${postsSource}\n${tagSource}`, /<PostCard/);
});

test('category and column routes are generated from the real post collection', async () => {
  const [
    categoryIndexSource,
    categorySource,
    columnIndexSource,
    columnSource,
  ] = await Promise.all([
    readSource('src/pages/categories/index.astro'),
    readSource('src/pages/categories/[category].astro'),
    readSource('src/pages/columns/index.astro'),
    readSource('src/pages/columns/[column].astro'),
  ]);

  for (const source of [categoryIndexSource, categorySource]) {
    assert.match(source, /getCollection\(['"]posts['"]\)/);
    assert.match(source, /buildCategoryIndex/);
  }

  for (const source of [columnIndexSource, columnSource]) {
    assert.match(source, /getCollection\(['"]posts['"]\)/);
    assert.match(source, /buildColumnIndex/);
  }

  assert.match(categoryIndexSource, /posts\.length/);
  assert.match(categoryIndexSource, /pubDate/);
  assert.match(categorySource, /getStaticPaths/);
  assert.match(categorySource, /<PostRow\s+entry=\{post\}\s+headingLevel=['"]h2['"]/);
  assert.match(categorySource, /href=['"]\/categories\/['"]/);

  assert.match(columnIndexSource, /posts\.length/);
  assert.match(columnIndexSource, /pubDate/);
  assert.match(columnSource, /getStaticPaths/);
  assert.match(columnSource, /columnOrder/);
  assert.match(columnSource, /<PostRow\s+entry=\{post\}\s+headingLevel=['"]h2['"]/);
  assert.match(columnSource, /href=['"]\/columns\/['"]/);
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
    'headings',
    'previous',
    'next',
  ]) {
    assert.match(source, new RegExp(prop));
  }

  assert.match(source, /<article/);
  assert.match(source, /class=["']prose["']/);
  assert.match(source, /<slot\s*\/>/);
  assert.doesNotMatch(source, /sourceUrl|在飞书查看源文/);
});

test('article routes pass taxonomy data through to PostLayout', async () => {
  const source = await readSource('src/pages/posts/[...id].astro');

  assert.match(source, /category=\{post\.data\.category\}/);
  assert.match(source, /column=\{post\.data\.column\}/);
  assert.match(source, /columnOrder=\{post\.data\.columnOrder\}/);
});

test('PostLayout renders linked article taxonomy without nesting links', async () => {
  const source = await readSource('src/layouts/PostLayout.astro');

  assert.match(
    source,
    /interface Props\s*\{[\s\S]*category:\s*string;[\s\S]*column\?:\s*string;[\s\S]*columnOrder\?:\s*number;/,
  );
  assert.match(source, /getCategoryHref/);
  assert.match(source, /getColumnHref/);
  assert.match(source, /href=\{getCategoryHref\(category\)\}/);
  assert.match(source, /href=\{getColumnHref\(column\)\}/);
  assert.match(source, /padStart\(2,\s*['"]0['"]\)/);
  assert.match(source, /aria-label=["']文章分类与标签["']/);
  assert.match(source, /<TagList\s+tags=\{tags\}\s+compact\s*\/>/);
});

test('PostLayout derives both adaptive contents views from filtered h2 through h4 headings', async () => {
  const source = await readSource('src/layouts/PostLayout.astro');

  assert.match(
    source,
    /const tableOfContents\s*=\s*headings\.filter\([\s\S]*?heading\.depth\s*>=\s*2\s*&&\s*heading\.depth\s*<=\s*4/,
  );
  assert.match(
    source,
    /const hasTableOfContents\s*=\s*tableOfContents\.length\s*>=\s*2;/,
  );
  assert.match(
    source,
    /<aside\s+class=["']post-toc post-toc--desktop["']/,
  );
  assert.match(source, /<details\s+class=["']post-toc-compact["']/);
  assert.match(source, /<summary>本页目录<\/summary>/);
  assert.equal(
    source.match(/tableOfContents\.map/g)?.length,
    2,
    'desktop and compact contents should map the same filtered headings',
  );
  assert.doesNotMatch(source, /headings\.map/);
  assert.match(
    source,
    /hasTableOfContents\s*&&\s*['"]post-layout--with-toc['"]/,
  );
  assert.ok(
    source.indexOf('<details class="post-toc-compact"') <
      source.indexOf('<div class="prose">'),
    'compact contents should appear before the article body',
  );
});

test('PostLayout excludes blank heading labels and slugs from contents', async () => {
  const source = await readSource('src/layouts/PostLayout.astro');

  assert.match(
    source,
    /const tableOfContents\s*=\s*headings\.filter\(\s*\(heading\)\s*=>\s*heading\.depth\s*>=\s*2\s*&&\s*heading\.depth\s*<=\s*4\s*&&\s*heading\.text\.trim\(\)\.length\s*>\s*0\s*&&\s*heading\.slug\.trim\(\)\.length\s*>\s*0\s*,?\s*\);/,
  );
});

test('PostLayout shows compact contents only on narrow screens', async () => {
  const source = await readSource('src/layouts/PostLayout.astro');

  assert.match(
    source,
    /\.post-toc-compact\s*\{[^}]*display:\s*none;[^}]*\}/s,
  );
  assert.match(
    source,
    /@media\s*\(max-width:\s*64rem\)\s*\{[\s\S]*?\.post-toc-compact\s*\{[^}]*display:\s*block;[^}]*\}/,
  );
});

test('article layouts opt into safe BlogPosting metadata only when supplied', async () => {
  const [baseSource, postSource] = await Promise.all([
    readSource('src/layouts/BaseLayout.astro'),
    readSource('src/layouts/PostLayout.astro'),
  ]);

  assert.match(baseSource, /serializeJsonLd/);
  assert.match(baseSource, /application\/ld\+json/);
  assert.match(baseSource, /jsonLd\s*!==\s*undefined/);
  assert.match(postSource, /canonicalPath/);
  assert.match(postSource, /BlogPosting/);
  assert.match(postSource, /datePublished/);
  assert.match(postSource, /dateModified/);
  assert.match(postSource, /mainEntityOfPage/);
  assert.match(postSource, /articleSection:\s*category/);
  assert.match(postSource, /isPartOf/);
  assert.match(postSource, /['"]@type['"]:\s*['"]CollectionPage['"]/);
  assert.match(postSource, /name:\s*column/);
  assert.match(
    postSource,
    /new URL\(getColumnHref\(column\),\s*SITE\.canonicalOrigin\)\.href/,
  );
});

test('article and tag routes are driven by the real content collection', async () => {
  const [articleSource, tagsSource, tagSource] = await Promise.all([
    readSource('src/pages/posts/[...id].astro'),
    readSource('src/pages/tags/index.astro'),
    readSource('src/pages/tags/[tag].astro'),
  ]);

  assert.match(articleSource, /getCollection\(['"]posts['"]\)/);
  assert.match(articleSource, /render\(post\)/);
  assert.match(articleSource, /post\.body/);
  assert.match(articleSource, /getPostHref/);
  assert.match(tagsSource, /getCollection\(['"]posts['"]\)/);
  assert.match(tagsSource, /buildTagIndex/);
  assert.match(tagSource, /buildTagIndex/);
  assert.match(tagSource, /headingLevel=["']h2["']/);
});

test('tag pages keep touch targets accessible and collapse safely on mobile', async () => {
  const source = await readSource('src/styles/global.css');

  assert.match(
    source,
    /\.tag-directory__link\s*\{[^}]*min-height:\s*2\.75rem;[^}]*\}/s,
  );
  assert.match(source, /\.tag-page/);
  assert.match(
    source,
    /@media\s*\(max-width:[^)]+\)[\s\S]*\.tag-directory__link/s,
  );
});

test('article routes never expose an internal Feishu source URL', async () => {
  const [routeSource, schemaSource] = await Promise.all([
    readSource('src/pages/posts/[...id].astro'),
    readSource('src/content.config.ts'),
  ]);

  assert.doesNotMatch(`${routeSource}\n${schemaSource}`, /sourceUrl|feishuRecordId/);
});
