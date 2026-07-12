# Content Discovery and Series Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private, dependency-free static article search plus deterministic series navigation and related reading, then deploy and verify the complete experience on GitHub Pages.

**Architecture:** Astro emits a same-origin JSON search index from validated public content. A progressively enhanced native `<dialog>` lazy-loads that index and ranks results with shared pure functions. Separate pure post-discovery helpers compute series position and related posts at build time; article components only render already-resolved public links.

**Tech Stack:** Astro 7 static output, TypeScript, native browser APIs, Node test runner, existing CSS design tokens, GitHub Actions and GitHub Pages.

---

## File responsibility map

Create:

- `src/lib/search.ts` — public search entry construction, Markdown-to-text normalization, safe JSON serialization, query normalization and deterministic ranking.
- `src/pages/search-index.json.ts` — static same-origin search-index endpoint.
- `src/components/SearchToggle.astro` — progressively revealed header button.
- `src/components/SearchDialog.astro` — accessible dialog markup and templates.
- `src/scripts/search-dialog.ts` — lazy loading, keyboard control, safe result rendering and failure recovery.
- `src/components/PostSeriesNavigation.astro` — column progress and previous/next section links.
- `src/components/RelatedPostList.astro` — compact related-reading links.
- `tests/search.test.mjs` — pure search-domain tests.

Modify:

- `src/components/SiteHeader.astro` — add a utility cluster with search and theme controls.
- `src/layouts/BaseLayout.astro` — mount one search dialog per page.
- `src/lib/posts.ts` — add pure series-navigation and related-post helpers.
- `src/pages/posts/[...id].astro` — calculate article discovery props at build time.
- `src/layouts/PostLayout.astro` — choose series or generic navigation and render related content.
- `src/styles/global.css` — search and article-discovery presentation across breakpoints and themes.
- `tests/posts.test.mjs` — series and related-ranking tests.
- `tests/ui-source.test.mjs` — source-level accessibility and progressive-enhancement assertions.
- `tests/build-output.test.mjs` — production index and article-output assertions.

Do not modify the Feishu Base schema, sync manifest schema, publishing workflow triggers or generated media behavior.

### Task 1: Search domain and deterministic ranking

**Files:**

- Create: `src/lib/search.ts`
- Create: `tests/search.test.mjs`

- [ ] **Step 1: Confirm the baseline before feature work**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" npm run verify
```

Expected: 157 tests pass, Astro reports zero diagnostics and 16 pages build successfully.

- [ ] **Step 2: Write failing tests for public entries, normalization and ranking**

Create `tests/search.test.mjs` with frozen fixtures and these exact behaviors:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSearchEntry,
  markdownToSearchText,
  normalizeSearchQuery,
  searchEntries,
  serializeSearchIndex,
} from '../src/lib/search.ts';

const feishu = Object.freeze({
  id: 'feishu/private-record-name.md',
  body: '# 用飞书写作\n\n自动发布到博客。',
  data: Object.freeze({
    title: '从飞书发布的第一篇文章',
    description: '验证飞书写作与静态部署。',
    pubDate: new Date('2026-07-12T00:00:00.000Z'),
    category: '技术',
    column: '博客搭建手记',
    columnOrder: 2,
    tags: Object.freeze(['飞书发布', '自动化']),
    slug: 'published-from-feishu',
  }),
});

test('buildSearchEntry emits only normalized public fields', () => {
  const entry = buildSearchEntry(feishu);
  assert.equal(entry.href, '/posts/published-from-feishu/');
  assert.equal(entry.readingMinutes, 1);
  assert.equal(entry.columnOrder, 2);
  assert.match(entry.searchText, /用飞书写作 自动发布到博客/);
  assert.doesNotMatch(JSON.stringify(entry), /private-record-name|record_id|document_id/);
});

test('markdownToSearchText keeps visible text, removes destinations and caps the body', () => {
  const source = '[公开文字](https://internal.example/private) `代码` ' + '长'.repeat(13_000);
  const text = markdownToSearchText(source);
  assert.match(text, /^公开文字 代码/);
  assert.doesNotMatch(text, /internal\.example/);
  assert.ok(text.length <= 12_000);
});

test('normalizeSearchQuery applies NFKC, lowercase and whitespace collapse', () => {
  assert.equal(normalizeSearchQuery('  ＡＳＴＲＯ   飞书  '), 'astro 飞书');
});

test('searchEntries supports Chinese metadata search and stable weighted ordering', () => {
  const entries = Object.freeze([
    { ...buildSearchEntry(feishu), title: '自动化记录' },
    buildSearchEntry(feishu),
  ]);
  const results = searchEntries(entries, '飞书', 8);
  assert.equal(results[0].title, '从飞书发布的第一篇文章');
  assert.equal(searchEntries(entries, '博客搭建', 8).length, 2);
  assert.deepEqual(entries.map(({ title }) => title), ['自动化记录', '从飞书发布的第一篇文章']);
});

test('searchEntries requires every query term and returns newest entries for an empty query', () => {
  const first = buildSearchEntry(feishu);
  const second = { ...first, href: '/posts/older/', title: 'Older', pubDate: '2025-01-01' };
  assert.equal(searchEntries([first, second], '飞书 不存在', 8).length, 0);
  assert.deepEqual(searchEntries([second, first], '', 1).map(({ href }) => href), [first.href]);
});

test('serializeSearchIndex escapes HTML-significant characters as valid JSON', () => {
  const serialized = serializeSearchIndex({ version: 1, entries: [{ title: '</script>&' }] });
  assert.doesNotMatch(serialized, /<|>|&/);
  assert.equal(JSON.parse(serialized).entries[0].title, '</script>&');
});
```

- [ ] **Step 3: Run the new test and confirm RED**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types --test tests/search.test.mjs
```

Expected: FAIL because `src/lib/search.ts` does not exist.

- [ ] **Step 4: Implement the search domain**

Create `src/lib/search.ts` with these public contracts:

```ts
import { estimateReadingMinutes, getPostHref } from './posts';

const BODY_LIMIT = 12_000;

export interface SearchSourcePost {
  id: string;
  body?: string;
  data: {
    title: string;
    description: string;
    pubDate: Date;
    category: string;
    column?: string;
    columnOrder?: number;
    tags: readonly string[];
    slug?: string;
  };
}

export interface SearchEntry {
  href: string;
  title: string;
  description: string;
  pubDate: string;
  category: string;
  column?: string;
  columnOrder?: number;
  tags: string[];
  readingMinutes: number;
  searchText: string;
}

export function markdownToSearchText(markdown: string): string {
  return markdown
    .normalize('NFKC')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_>#~|=\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, BODY_LIMIT);
}

export function buildSearchEntry(post: SearchSourcePost): SearchEntry {
  if (post.body === undefined) {
    throw new Error(`Post "${post.id}" does not expose its public Markdown body.`);
  }
  return {
    href: getPostHref(post),
    title: post.data.title,
    description: post.data.description,
    pubDate: post.data.pubDate.toISOString().slice(0, 10),
    category: post.data.category,
    ...(post.data.column === undefined ? {} : { column: post.data.column }),
    ...(post.data.columnOrder === undefined ? {} : { columnOrder: post.data.columnOrder }),
    tags: [...post.data.tags],
    readingMinutes: estimateReadingMinutes(post.body),
    searchText: markdownToSearchText(post.body),
  };
}

export function normalizeSearchQuery(query: string): string {
  return query.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
}
```

Implement `searchEntries(entries, query, limit)` without mutating `entries`. For each normalized term require at least one field match, then add these weights per term: title exact 120, title prefix 80, title contains 60, category/column/tag 35, description 15, body 5. Sort by score descending, `pubDate` descending, then `href` ascending. Empty query returns the newest `limit` entries. Implement `serializeSearchIndex` as `JSON.stringify` followed by replacements for `<`, `>`, `&`, U+2028 and U+2029.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types --test tests/search.test.mjs tests/posts.test.mjs
git diff --check
```

Expected: all focused tests pass and diff check is clean.

Commit:

```bash
git add src/lib/search.ts tests/search.test.mjs
git commit -m "feat: add deterministic static search domain"
```

### Task 2: Static search-index endpoint

**Files:**

- Create: `src/pages/search-index.json.ts`
- Modify: `tests/build-output.test.mjs`

- [ ] **Step 1: Add failing production-output assertions**

Add `search-index.json` to `expectedFiles`, then add:

```js
test('search index contains only deterministic public article data', async () => {
  const source = await readOutput('search-index.json');
  const index = JSON.parse(source);
  assert.equal(index.version, 1);
  assert.deepEqual(index.entries.map(({ href }) => href), [
    '/posts/published-from-feishu/',
    '/posts/welcome/',
  ]);
  assert.equal(index.entries[0].category, '技术');
  assert.equal(index.entries[0].column, '博客搭建手记');
  assert.match(index.entries[0].searchText, /用飞书写作/);
  assert.doesNotMatch(source, /recvp|DsPQ|file_token|document_id|my\.feishu\.cn/);
});
```

- [ ] **Step 2: Run the build-output test and confirm RED**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types --test --test-name-pattern="search index|public entry" tests/build-output.test.mjs
```

Expected: FAIL because `dist/search-index.json` is missing.

- [ ] **Step 3: Implement the endpoint**

Create `src/pages/search-index.json.ts`:

```ts
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

import { buildSearchEntry, serializeSearchIndex } from '../lib/search';
import { sortNewestFirst } from '../lib/posts';

export const GET: APIRoute = async () => {
  const posts = sortNewestFirst(await getCollection('posts'));
  const entries = posts
    .map(buildSearchEntry)
    .sort(
      (first, second) =>
        second.pubDate.localeCompare(first.pubDate, 'en') ||
        first.href.localeCompare(second.href, 'en'),
    );
  return new Response(serializeSearchIndex({ version: 1, entries }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate',
    },
  });
};
```

- [ ] **Step 4: Verify endpoint output and commit**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types --test tests/search.test.mjs tests/build-output.test.mjs
PATH="/opt/homebrew/bin:$PATH" npm run check
git diff --check
```

Expected: search and build-output tests pass; Astro reports zero diagnostics.

Commit:

```bash
git add src/pages/search-index.json.ts tests/build-output.test.mjs
git commit -m "feat: emit the public search index"
```

### Task 3: Accessible search shell and client behavior

**Files:**

- Create: `src/components/SearchToggle.astro`
- Create: `src/components/SearchDialog.astro`
- Create: `src/scripts/search-dialog.ts`
- Modify: `src/components/SiteHeader.astro`
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `tests/ui-source.test.mjs`

- [ ] **Step 1: Write failing UI-source tests**

Add a test that reads all five UI files and asserts:

```js
test('search is progressive, same-origin, accessible and keyboard operable', async () => {
  const [header, base, toggle, dialog, script] = await Promise.all([
    readSource('src/components/SiteHeader.astro'),
    readSource('src/layouts/BaseLayout.astro'),
    readSource('src/components/SearchToggle.astro'),
    readSource('src/components/SearchDialog.astro'),
    readSource('src/scripts/search-dialog.ts'),
  ]);
  assert.match(header, /SearchToggle/);
  assert.match(base, /SearchDialog/);
  assert.match(toggle, /hidden[^>]*data-search-open|data-search-open[^>]*hidden/);
  assert.match(toggle, /aria-label=["']搜索文章["']/);
  assert.match(dialog, /<dialog[^>]*id=["']site-search["']/);
  assert.match(dialog, /aria-labelledby|aria-describedby/);
  assert.match(dialog, /aria-live=["']polite["']/);
  assert.match(script, /fetch\(["']\/search-index\.json["']/);
  assert.match(script, /metaKey|ctrlKey/);
  assert.match(script, /ArrowDown|ArrowUp|Escape|Enter/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML|https?:\/\//);
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types --test --test-name-pattern="search is progressive" tests/ui-source.test.mjs
```

Expected: FAIL because the search files and imports are absent.

- [ ] **Step 3: Create the toggle and dialog markup**

`SearchToggle.astro` must render a 44px button that starts hidden:

```astro
<button class="search-toggle" type="button" aria-label="搜索文章" data-search-open hidden>
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
    <circle cx="10.5" cy="10.5" r="5.75"></circle>
    <path d="m15 15 4 4"></path>
  </svg>
  <kbd aria-hidden="true">⌘K</kbd>
</button>
```

`SearchDialog.astro` must include a native dialog, labelled title, description, search input, close button, polite result status, ordered result container, loading/error/empty text hooks and an archive fallback. Add a processed Astro script that imports `../scripts/search-dialog`.

- [ ] **Step 4: Implement client behavior with safe DOM creation**

In `src/scripts/search-dialog.ts`:

- Import `searchEntries` and `SearchEntry` from `../lib/search`.
- Query `#site-search`, `[data-search-open]`, `[data-search-input]`, `[data-search-results]`, and `[data-search-status]`; return without side effects if required nodes are missing.
- Reveal every opener only after setup succeeds.
- Cache exactly one promise from `fetch('/search-index.json', { headers: { accept: 'application/json' } })`.
- Validate `response.ok`, `payload.version === 1`, and `Array.isArray(payload.entries)` before accepting entries.
- Open on button click, `Command/Ctrl + K`, or `/` outside `input`, `textarea`, `select`, and `[contenteditable]`.
- Render no more than eight results using `document.createElement` and `textContent`; never concatenate public data into HTML.
- Empty query renders newest entries with status “最近更新”。
- Input uses `searchEntries`; arrows update an integer active index and `aria-current`, Enter activates the selected anchor, Escape relies on dialog close behavior.
- On failure set status to “搜索暂不可用” and leave the static archive link visible.
- A click whose target is the dialog itself closes it.

- [ ] **Step 5: Integrate one shell per page and commit**

In `SiteHeader.astro`, import `SearchToggle` and wrap it with `ThemeToggle` in `<div class="site-header__utilities">`. In `BaseLayout.astro`, import and render `<SearchDialog />` once after `<SiteHeader />` and before `<main>`.

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types --test --test-name-pattern="search is progressive|SiteHeader|BaseLayout" tests/ui-source.test.mjs
PATH="/opt/homebrew/bin:$PATH" npm run check
git diff --check
```

Expected: focused UI tests and Astro check pass.

Commit:

```bash
git add src/components/SearchToggle.astro src/components/SearchDialog.astro src/scripts/search-dialog.ts src/components/SiteHeader.astro src/layouts/BaseLayout.astro tests/ui-source.test.mjs
git commit -m "feat: add accessible static search interaction"
```

### Task 4: Search visual system and responsive behavior

**Files:**

- Modify: `src/styles/global.css`
- Modify: `tests/ui-source.test.mjs`

- [ ] **Step 1: Add failing style-contract assertions**

Assert the stylesheet contains:

```js
assert.match(styles, /\.search-toggle\s*\{[^}]*min-width:\s*2\.75rem;[^}]*min-height:\s*2\.75rem;/s);
assert.match(styles, /\.search-dialog::backdrop/);
assert.match(styles, /\.search-dialog__result\s+a\s*\{[^}]*min-height:\s*2\.75rem;/s);
assert.match(styles, /@media\s*\(max-width:[^)]*\)[\s\S]*\.search-toggle\s+kbd\s*\{[^}]*display:\s*none;/s);
assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.search-dialog/s);
```

- [ ] **Step 2: Run the style test and confirm RED**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types --test --test-name-pattern="search.*responsive|global styles" tests/ui-source.test.mjs
```

Expected: FAIL because search selectors are absent.

- [ ] **Step 3: Implement exact responsive rules**

Add styles using existing color, border, type and spacing tokens:

```css
.site-header__utilities { display: flex; align-items: center; gap: 0.125rem; }
.search-toggle { min-width: 2.75rem; min-height: 2.75rem; border: 0; border-radius: 999px; background: transparent; color: var(--ink); display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem; }
.search-toggle svg { width: 1.25rem; height: 1.25rem; stroke: currentColor; stroke-width: 1.5; }
.search-toggle kbd { font: inherit; font-size: 0.68rem; letter-spacing: 0.08em; }
.search-dialog { width: min(46rem, calc(100vw - 1.5rem)); max-height: min(44rem, calc(100dvh - 1.5rem)); margin: auto; padding: 0; border: 1px solid var(--line); background: var(--surface); color: var(--ink); box-shadow: var(--shadow); }
.search-dialog::backdrop { background: color-mix(in srgb, var(--ink) 38%, transparent); }
.search-dialog__result a { min-height: 2.75rem; display: grid; text-decoration: none; }
.search-dialog__result a[aria-current="true"] { background: var(--surface-soft); outline: 1px solid var(--accent-text); outline-offset: -1px; }
.search-dialog__panel { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); max-height: inherit; }
.search-dialog__header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem; border-bottom: 1px solid var(--line); }
.search-dialog__close { width: 2.75rem; height: 2.75rem; border: 0; border-radius: 999px; background: transparent; color: currentColor; }
.search-dialog__input { width: calc(100% - 2rem); min-height: 2.75rem; margin: 1rem; padding: 0.65rem 0.8rem; border: 1px solid var(--line-strong); background: var(--paper); color: var(--ink); font: inherit; }
.search-dialog__status { min-height: 1.5rem; margin: 0; padding: 0 1rem 0.75rem; color: var(--muted); }
.search-dialog__results { min-width: 0; margin: 0; padding: 0 1rem 1rem; overflow-y: auto; list-style: none; }
.search-dialog__result-title { font-family: var(--font-display); font-size: 1.12rem; }
.search-dialog__result-description, .search-dialog__result-meta { color: var(--muted); }
.search-dialog__fallback { min-height: 2.75rem; display: inline-flex; align-items: center; }
@media (max-width: 48rem) { .search-toggle kbd { display: none; } .search-dialog { width: calc(100vw - 1rem); max-height: calc(100dvh - 1rem); } }
@media (prefers-reduced-motion: reduce) { .search-dialog, .search-dialog__result { animation: none; transition: none; } }
```

Use these selectors in the component markup. Empty and error states use `.search-dialog__status`; the archive recovery link uses `.search-dialog__fallback`. Do not add fixed heights or `white-space: nowrap` to result text.

- [ ] **Step 4: Run source tests and commit**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types --test tests/ui-source.test.mjs tests/design-contrast.test.mjs
PATH="/opt/homebrew/bin:$PATH" npm run check
git diff --check
```

Commit:

```bash
git add src/styles/global.css tests/ui-source.test.mjs
git commit -m "feat: style the responsive search surface"
```

### Task 5: Series navigation and related-post ranking

**Files:**

- Modify: `src/lib/posts.ts`
- Modify: `tests/posts.test.mjs`

- [ ] **Step 1: Write failing pure-domain tests**

Import `buildSeriesNavigation` and `buildRelatedPosts`, then add fixtures for three ordered column posts and two standalone posts. Assert:

```js
const series = buildSeriesNavigation(posts, 'column-two');
assert.deepEqual(series, {
  label: '博客搭建手记',
  href: getColumnHref('博客搭建手记'),
  position: 2,
  total: 3,
  previous: { href: '/posts/column-one/', title: 'Column one' },
  next: { href: '/posts/column-three/', title: 'Column three' },
});
assert.equal(buildSeriesNavigation(posts, 'standalone'), undefined);

const related = buildRelatedPosts(posts, 'column-two', {
  excludeHrefs: new Set(['/posts/column-one/', '/posts/column-three/']),
  limit: 3,
});
assert.deepEqual(related.map(({ href }) => href), ['/posts/same-category/']);
assert.deepEqual(posts.map(({ id }) => id), originalIds);
```

Also assert a zero-score candidate is omitted, ties fall back to date then href, and a one-post column returns position 1/total 1 with no adjacent links.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types --test --test-name-pattern="SeriesNavigation|series navigation|related" tests/posts.test.mjs
```

Expected: FAIL because both helpers are absent.

- [ ] **Step 3: Implement public discovery types and helpers**

Add these types to `src/lib/posts.ts`:

```ts
export interface SeriesNavigation {
  label: string;
  href: string;
  position: number;
  total: number;
  previous?: AdjacentPostLink;
  next?: AdjacentPostLink;
}

export interface RelatedPostLink extends AdjacentPostLink {
  description: string;
  pubDate: Date;
  category: string;
  column?: string;
  tags: readonly string[];
}
```

`buildSeriesNavigation(posts, currentId)` must call the validated `buildColumnIndex`, locate the current post by `id`, derive the 1-based position, and map immediate lower/higher order posts to public links.

`buildRelatedPosts(posts, currentId, { excludeHrefs = new Set(), limit = 3 })` must:

- Exclude current and every public href in `excludeHrefs`.
- Score same column +60, same category +24 and each canonical shared tag +8.
- Drop candidates with score zero.
- Sort by score descending, absolute publication-date distance ascending, publication date descending and href ascending.
- Return public metadata without score and without mutating input.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types --test tests/posts.test.mjs tests/search.test.mjs
git diff --check
```

Commit:

```bash
git add src/lib/posts.ts tests/posts.test.mjs
git commit -m "feat: add article discovery helpers"
```

### Task 6: Article discovery UI

**Files:**

- Create: `src/components/PostSeriesNavigation.astro`
- Create: `src/components/RelatedPostList.astro`
- Modify: `src/pages/posts/[...id].astro`
- Modify: `src/layouts/PostLayout.astro`
- Modify: `src/styles/global.css`
- Modify: `tests/ui-source.test.mjs`
- Modify: `tests/build-output.test.mjs`

- [ ] **Step 1: Write failing route, layout and build assertions**

Source tests must assert the article route imports and calls both discovery helpers; `PostLayout` renders `PostSeriesNavigation` when `series` exists, renders generic `post-pagination` only when it does not, and renders `RelatedPostList` only for a non-empty array.

Add production assertions:

```js
test('column articles render ordered series navigation without duplicate generic pagination', async () => {
  const welcome = await readOutput('posts/welcome/index.html');
  const feishu = await readOutput('posts/published-from-feishu/index.html');
  assert.match(welcome, /01\s*\/\s*02/);
  assert.match(welcome, /下一节/);
  assert.match(welcome, /href="\/posts\/published-from-feishu\/"/);
  assert.match(feishu, /02\s*\/\s*02/);
  assert.match(feishu, /上一节/);
  assert.match(feishu, /href="\/posts\/welcome\/"/);
  assert.doesNotMatch(welcome, /上一篇|下一篇/);
  assert.doesNotMatch(feishu, /上一篇|下一篇/);
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types --test --test-name-pattern="column articles|article routes pass|PostLayout" tests/ui-source.test.mjs tests/build-output.test.mjs
```

Expected: FAIL because series UI and props are absent.

- [ ] **Step 3: Compute discovery props in static paths**

In `getStaticPaths`, build the existing route records, then for each route:

```ts
const series = buildSeriesNavigation(posts, route.props.post.id);
const excluded = new Set([
  route.props.previous?.href,
  route.props.next?.href,
  series?.previous?.href,
  series?.next?.href,
].filter((href): href is string => href !== undefined));
const related = buildRelatedPosts(posts, route.props.post.id, {
  excludeHrefs: excluded,
  limit: 3,
});
return {
  ...route,
  props: { ...route.props, series, related },
};
```

Extend route and layout prop types with `SeriesNavigation` and `RelatedPostLink[]`.

- [ ] **Step 4: Implement focused components and layout selection**

`PostSeriesNavigation.astro` renders:

- Eyebrow `专栏阅读`.
- Column archive link.
- Zero-padded progress with an accessible full text label.
- Optional previous and next links labelled `上一节` / `下一节` with `rel` values.

`RelatedPostList.astro` renders nothing for an empty array; otherwise it renders a `继续阅读` section with title, description, date and taxonomy for each public link.

In `PostLayout.astro`, render series navigation when present; otherwise render the existing generic adjacent navigation. Render related content after navigation. Never nest interactive links.

- [ ] **Step 5: Add dense responsive styling**

Use a two-column previous/next grid on desktop, one column below 48rem, 44px links, tabular progress numerals, current border/surface tokens and no fixed-height text clipping. Add reduced-motion final states. Keep the related list visually subordinate to the article title and distinct from the footer.

- [ ] **Step 6: Verify focused behavior and commit**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types --test tests/posts.test.mjs tests/ui-source.test.mjs tests/build-output.test.mjs
PATH="/opt/homebrew/bin:$PATH" npm run check
git diff --check
```

Commit:

```bash
git add src/components/PostSeriesNavigation.astro src/components/RelatedPostList.astro src/pages/posts/'[...id].astro' src/layouts/PostLayout.astro src/styles/global.css tests/ui-source.test.mjs tests/build-output.test.mjs
git commit -m "feat: add continuous article discovery"
```

### Task 7: Full verification, review and production deployment

**Files:**

- Modify only files required by review findings.

- [ ] **Step 1: Run the full local gate**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" npm run verify
git diff dd79722..HEAD --check
git status --short --branch
```

Expected: all tests pass, Astro has zero diagnostics, the build includes `/search-index.json`, and the only unrelated untracked path remains `.playwright-cli/`.

- [ ] **Step 2: Browser QA on the local production-equivalent site**

Start Astro locally and verify at 1117×837, 375×812 and 320×760:

- Search button is visible only after setup.
- `/`, `Command/Ctrl + K`, Escape, arrows and Enter work.
- “飞书” returns the Feishu article first.
- “博客搭建” returns both articles.
- Search fetch occurs once per page session.
- Loading, empty and simulated failure states are readable.
- Light, dark and reduced-motion states are stable.
- No page-level horizontal overflow or console errors.
- Welcome shows `01 / 02` and next section; Feishu shows `02 / 02` and previous section.

- [ ] **Step 3: Run two-stage review**

Dispatch a spec-compliance reviewer and then a code-quality reviewer. Block deployment for any Critical or Important finding. Fix findings with a failing regression test first, rerun focused tests, and commit each independent fix.

- [ ] **Step 4: Re-run final evidence gate**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" npm run verify
git diff dd79722..HEAD --check
git status --short --branch
```

Expected: green and clean except the pre-existing `.playwright-cli/` directory.

- [ ] **Step 5: Push and watch Pages deployment**

Run:

```bash
git push origin main
head_sha="$(git rev-parse HEAD)"
run_id="$(gh run list --workflow deploy.yml --branch main --limit 10 --json databaseId,headSha --jq ".[] | select(.headSha == \"${head_sha}\") | .databaseId" | head -n 1)"
test -n "$run_id"
gh run watch "$run_id" --exit-status
```

Expected: `Verify and build` and `Deploy to GitHub Pages` both succeed for the pushed HEAD.

- [ ] **Step 6: Verify production**

Confirm HTTP 200 and expected content for:

```text
https://xmo2004.github.io/
https://xmo2004.github.io/search-index.json
https://xmo2004.github.io/posts/welcome/
https://xmo2004.github.io/posts/published-from-feishu/
```

In the live browser, repeat one desktop and one mobile search flow and confirm series links, no overflow and no console errors. Finally run the Feishu sync workflow once; it must succeed and report no generated content change.
