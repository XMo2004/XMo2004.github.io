# Feishu-Powered Personal Blog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, deploy, and verify `https://xmo2004.github.io/` as a polished Astro 7 blog whose published Feishu documents are synchronized through a Bitable publishing console and GitHub Actions.

**Architecture:** Feishu documents contain article bodies and a Bitable row contains publication metadata. A Bitable automation sends a GitHub `workflow_dispatch`; a sync workflow reads every published row, converts document blocks and media into versioned local Markdown assets, commits the snapshot, verifies it, and deploys the Pages artifact. The public runtime remains fully static.

**Tech Stack:** Astro 7, TypeScript, native CSS, Node 24, Node test runner, GitHub Actions, GitHub Pages, Feishu OpenAPI (`docx`, `bitable`, and `drive` APIs).

---

## File map

The implementation uses focused files with these responsibilities:

- `package.json`, `astro.config.mjs`, `tsconfig.json`: toolchain and scripts.
- `src/config/site.ts`: all editable site identity and canonical URL values.
- `src/content.config.ts`: post schema and content loader.
- `src/lib/posts.ts`: sorting, filtering, reading-time, and tag helpers.
- `src/layouts/BaseLayout.astro`, `src/layouts/PostLayout.astro`: shared page and article shells.
- `src/components/*`: header, footer, theme toggle, post card, and empty-state UI.
- `src/pages/*`: home, posts, tags, about, RSS, robots, and 404 routes.
- `src/styles/global.css`: tokens, responsive layout, typography, prose, focus, and reduced-motion rules.
- `src/content/posts/manual/welcome.md`: initial public article independent from Feishu.
- `scripts/feishu/ids.mjs`: safe document-token and slug parsing.
- `scripts/feishu/blocks.mjs`: Feishu rich-text and block-tree conversion.
- `scripts/feishu/client.mjs`: authenticated, paginated, retried API access.
- `scripts/feishu/assets.mjs`: media downloads and hash-based filenames.
- `scripts/feishu/records.mjs`: Bitable field normalization and validation.
- `scripts/feishu/sync.mjs`: all-or-nothing synchronization and manifest generation.
- `tests/*.test.mjs`, `tests/fixtures/*`: unit, contract, and built-output tests.
- `.github/workflows/deploy.yml`, `.github/workflows/sync-feishu.yml`: deployment and content synchronization.
- `docs/FEISHU_SETUP.md`, `README.md`: operator instructions and recovery procedures.

## Task 1: Pin the Astro 7 toolchain and prove an empty static build

**Files:**
- Create: `package.json`
- Create: `.nvmrc`
- Create: `.gitignore`
- Create: `astro.config.mjs`
- Create: `tsconfig.json`
- Create: `src/pages/index.astro`
- Create: `tests/toolchain.test.mjs`

- [ ] **Step 1: Write the failing toolchain test**

```js
// tests/toolchain.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Astro is configured for the canonical GitHub Pages origin', async () => {
  const source = await readFile(new URL('../astro.config.mjs', import.meta.url), 'utf8');
  assert.match(source, /site:\s*['"]https:\/\/xmo2004\.github\.io['"]/);
  assert.match(source, /output:\s*['"]static['"]/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH node --test tests/toolchain.test.mjs`

Expected: FAIL because `astro.config.mjs` does not exist.

- [ ] **Step 3: Add the pinned toolchain and minimal page**

```json
{
  "name": "xmo2004-blog",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "dev": "astro dev",
    "check": "astro check",
    "test": "node --test tests/*.test.mjs",
    "build": "astro build",
    "verify": "npm run test && npm run check && npm run build",
    "sync:feishu": "node scripts/feishu/sync.mjs"
  },
  "dependencies": {
    "@astrojs/rss": "latest",
    "@astrojs/sitemap": "latest",
    "astro": "7.0.7",
    "yaml": "latest"
  },
  "devDependencies": {
    "@astrojs/check": "latest",
    "@types/node": "latest",
    "typescript": "latest"
  }
}
```

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://xmo2004.github.io',
  output: 'static',
  integrations: [sitemap()],
});
```

Set `.nvmrc` to `24`, ignore `node_modules`, `.astro`, `dist`, `.env`, and `.DS_Store`, extend `astro/tsconfigs/strict` in `tsconfig.json`, and render a semantic `<main><h1>小陌的博客</h1></main>` in the initial page.

- [ ] **Step 4: Install dependencies and verify GREEN**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npm install && PATH=/opt/homebrew/opt/node/bin:$PATH npm test && PATH=/opt/homebrew/opt/node/bin:$PATH npm run build`

Expected: the test passes, Astro emits `dist/index.html`, and both commands exit 0.

- [ ] **Step 5: Commit the toolchain**

```bash
git add package.json package-lock.json .nvmrc .gitignore astro.config.mjs tsconfig.json src/pages/index.astro tests/toolchain.test.mjs
git commit -m "build: initialize Astro 7 static site"
```

## Task 2: Define the content contract and post helpers

**Files:**
- Create: `src/config/site.ts`
- Create: `src/content.config.ts`
- Create: `src/lib/posts.ts`
- Create: `src/content/posts/manual/welcome.md`
- Create: `tests/posts.test.mjs`

- [ ] **Step 1: Write failing tests for stable post behavior**

```js
// tests/posts.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateReadingMinutes, normalizeTag, sortNewestFirst } from '../src/lib/posts.ts';

test('Chinese reading time never drops below one minute', () => {
  assert.equal(estimateReadingMinutes('这是一个短段落。'), 1);
});

test('tag paths are stable and URL-safe', () => {
  assert.equal(normalizeTag(' 前端 工程 '), '前端-工程');
});

test('posts sort newest first without mutating input', () => {
  const input = [{ data: { pubDate: new Date('2026-01-01') } }, { data: { pubDate: new Date('2026-06-01') } }];
  const output = sortNewestFirst(input);
  assert.equal(output[0].data.pubDate.toISOString(), '2026-06-01T00:00:00.000Z');
  assert.equal(input[0].data.pubDate.toISOString(), '2026-01-01T00:00:00.000Z');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH node --experimental-strip-types --test tests/posts.test.mjs`

Expected: FAIL because `src/lib/posts.ts` does not exist.

- [ ] **Step 3: Implement schema, helpers, identity, and the welcome post**

```ts
// src/lib/posts.ts
export function estimateReadingMinutes(text: string): number {
  const han = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const words = (text.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+/g) ?? []).length;
  return Math.max(1, Math.ceil(han / 450 + words / 220));
}

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '-');
}

export function sortNewestFirst<T extends { data: { pubDate: Date } }>(posts: T[]): T[] {
  return [...posts].sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}
```

Configure a `posts` collection with `glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' })`. Its schema requires `title`, `description`, and `pubDate`; accepts `updatedDate`, `tags` defaulting to `[]`, `featured` defaulting to `false`, optional `cover`, optional `sourceUrl`, and optional `feishuRecordId`. Set the canonical site values from the design in `site.ts`. Write `welcome.md` with real explanatory content, `featured: true`, and no invented biography.

- [ ] **Step 4: Verify helper tests and Astro content validation**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npm test && PATH=/opt/homebrew/opt/node/bin:$PATH npm run check`

Expected: all tests pass and Astro reports zero errors.

- [ ] **Step 5: Commit the content contract**

```bash
git add src/config/site.ts src/content.config.ts src/lib/posts.ts src/content/posts/manual/welcome.md tests/posts.test.mjs
git commit -m "feat: define blog content model"
```

## Task 3: Build the editorial UI and responsive page set

**Files:**
- Create: `src/layouts/BaseLayout.astro`
- Create: `src/layouts/PostLayout.astro`
- Create: `src/components/SiteHeader.astro`
- Create: `src/components/SiteFooter.astro`
- Create: `src/components/ThemeToggle.astro`
- Create: `src/components/PostCard.astro`
- Create: `src/components/TagList.astro`
- Create: `src/styles/global.css`
- Modify: `src/pages/index.astro`
- Create: `src/pages/posts/index.astro`
- Create: `src/pages/about.astro`
- Create: `src/pages/404.astro`
- Create: `tests/ui-source.test.mjs`

- [ ] **Step 1: Write failing structural and accessibility tests**

```js
// tests/ui-source.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('base layout declares language, skip link, canonical metadata, and theme bootstrap', async () => {
  const source = await readFile(new URL('../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');
  assert.match(source, /<html lang="zh-CN"/);
  assert.match(source, /跳到正文/);
  assert.match(source, /rel="canonical"/);
  assert.match(source, /localStorage/);
});

test('global styles include visible focus, reduced motion, and mobile rules', async () => {
  const source = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  assert.match(source, /:focus-visible/);
  assert.match(source, /prefers-reduced-motion/);
  assert.match(source, /@media\s*\(max-width:/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH node --test tests/ui-source.test.mjs`

Expected: FAIL because the layout and stylesheet do not exist.

- [ ] **Step 3: Implement the shared visual system**

Use these exact root tokens as the base, with semantic aliases for surfaces and text:

```css
:root {
  color-scheme: light;
  --paper: #f4f0e7;
  --paper-raised: #fbf8f1;
  --ink: #1d211d;
  --muted: #646960;
  --line: #d7d0c3;
  --terracotta: #b84f35;
  --sage: #6f7d57;
  --serif: "Songti SC", STSong, "Noto Serif CJK SC", Georgia, serif;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
  --content: 72rem;
  --reading: 44rem;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --paper: #171a17;
  --paper-raised: #202420;
  --ink: #eee9de;
  --muted: #a9afa5;
  --line: #3b413a;
  --terracotta: #e27a5f;
  --sage: #a8b98c;
}
```

Build a sticky, translucent header with text wordmark `XMO / NOTES`, navigation for 首页/文章/标签/关于, an accessible theme button, a main-content skip link, and a quiet footer. Use a restrained editorial grid, large serif headings, thin rules, 44px touch targets, `text-wrap: pretty`, and container-safe prose. The theme bootstrap must run in `<head>` before paint, prefer saved choice, otherwise follow `prefers-color-scheme`, and update `aria-pressed`.

- [ ] **Step 4: Implement the page content**

Home must show the exact introduction “关于技术、成长与日常的长期笔记。” and sections for featured and latest posts. The posts page lists all posts. About explains that Feishu is the writing desk and the site is a static archive without claiming personal facts. The 404 page includes a link to `/`. Post cards display date, title, description, tags, and a typographic cover treatment when no image exists.

- [ ] **Step 5: Verify tests, type checks, and build**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npm run verify`

Expected: tests, Astro check, and production build all exit 0.

- [ ] **Step 6: Commit the UI**

```bash
git add src/layouts src/components src/styles src/pages tests/ui-source.test.mjs
git commit -m "feat: build editorial blog interface"
```

## Task 4: Add post, tag, RSS, robots, sitemap, and output contracts

**Files:**
- Create: `src/pages/posts/[...id].astro`
- Create: `src/pages/tags/index.astro`
- Create: `src/pages/tags/[tag].astro`
- Create: `src/pages/rss.xml.js`
- Create: `src/pages/robots.txt.ts`
- Create: `tests/build-output.test.mjs`

- [ ] **Step 1: Write the failing production-output test**

```js
// tests/build-output.test.mjs
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

for (const path of ['../dist/index.html', '../dist/posts/index.html', '../dist/about/index.html', '../dist/rss.xml', '../dist/sitemap-index.xml', '../dist/robots.txt', '../dist/404.html']) {
  test(`build emits ${path.replace('../dist/', '')}`, async () => {
    const info = await stat(new URL(path, import.meta.url));
    assert.ok(info.size > 0);
  });
}

test('welcome article carries canonical and article metadata', async () => {
  const html = await readFile(new URL('../dist/posts/welcome/index.html', import.meta.url), 'utf8');
  assert.match(html, /<link rel="canonical"/);
  assert.match(html, /"@type":"BlogPosting"/);
  assert.match(html, /<article/);
});
```

- [ ] **Step 2: Run build and the output test to verify RED**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npm run build && PATH=/opt/homebrew/opt/node/bin:$PATH node --test tests/build-output.test.mjs`

Expected: FAIL because RSS, tag routes, robots, or the article route are absent.

- [ ] **Step 3: Implement static routes and metadata**

Use `getStaticPaths()` over `getCollection('posts')` for articles and unique normalized tags. Render article content inside `PostLayout`, including reading time, table of contents derived from rendered headings, tags, and adjacent navigation. Generate RSS with `@astrojs/rss`, output `User-agent: *`, `Allow: /`, and the absolute sitemap URL from `robots.txt.ts`, and emit JSON-LD with `BlogPosting` on article pages. Ensure the article ID is `entry.id` without a duplicate directory prefix.

- [ ] **Step 4: Verify GREEN**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npm run build && PATH=/opt/homebrew/opt/node/bin:$PATH node --test tests/build-output.test.mjs`

Expected: every output assertion passes.

- [ ] **Step 5: Commit publication routes**

```bash
git add src/pages src/layouts/PostLayout.astro tests/build-output.test.mjs
git commit -m "feat: add static publication routes and feeds"
```

## Task 5: Implement Feishu IDs, record validation, and Block-to-Markdown conversion

**Files:**
- Create: `scripts/feishu/ids.mjs`
- Create: `scripts/feishu/records.mjs`
- Create: `scripts/feishu/blocks.mjs`
- Create: `tests/feishu-conversion.test.mjs`
- Create: `tests/fixtures/feishu-document.json`

- [ ] **Step 1: Add a representative fixture and failing conversion tests**

The fixture must contain a page, heading, formatted paragraph with link and inline code, nested bullet items, quote, code block with language, divider, image token, and a 2×2 table. Add tests with these exact expectations:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { documentIdFromUrl, validateSlug } from '../scripts/feishu/ids.mjs';
import { blocksToMarkdown } from '../scripts/feishu/blocks.mjs';
import { normalizeRecord } from '../scripts/feishu/records.mjs';

test('extracts docx token and rejects unsafe slugs', () => {
  assert.equal(documentIdFromUrl('https://example.feishu.cn/docx/doxcnExample123'), 'doxcnExample123');
  assert.throws(() => validateSlug('../admin'), /Slug/);
});

test('normalizes required Bitable fields', () => {
  const record = normalizeRecord({ record_id: 'rec1', fields: { 标题: '文章', 文档链接: { link: 'https://example.feishu.cn/docx/doxcnExample123' }, Slug: 'hello-world', 摘要: '摘要', 标签: ['技术'], 发布日期: 1783785600000, 状态: '已发布', 精选: true } });
  assert.equal(record.slug, 'hello-world');
  assert.deepEqual(record.tags, ['技术']);
});

test('converts supported block tree without losing structured content', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/feishu-document.json', import.meta.url), 'utf8'));
  const result = blocksToMarkdown(fixture.items);
  assert.match(result.markdown, /## 二级标题/);
  assert.match(result.markdown, /\*\*粗体\*\*/);
  assert.match(result.markdown, /```javascript/);
  assert.deepEqual(result.mediaTokens, ['img_v2_example']);
});

test('unsupported blocks fail with block id and type', () => {
  assert.throws(() => blocksToMarkdown([{ block_id: 'blk1', block_type: 43 }]), /blk1.*43/);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH node --test tests/feishu-conversion.test.mjs`

Expected: FAIL because conversion modules do not exist.

- [ ] **Step 3: Implement strict parsing and deterministic Markdown**

Accept only slugs matching `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. Extract tokens only from `/docx/<token>`. Normalize hyperlink objects, text values, selections, checkbox booleans, and millisecond dates from Bitable. Build the block tree using `block_id`, `parent_id`, and `children`; render rich-text marks in the stable order code → bold → italic → strikethrough → link. Escape Markdown punctuation in plain text. Map official block types for page, text, headings 1–6, bullet, ordered, code, quote, todo, divider, image, table, and table cells. Throw one aggregated error listing every invalid record or unsupported block.

- [ ] **Step 4: Verify GREEN**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH node --test tests/feishu-conversion.test.mjs`

Expected: all conversion tests pass.

- [ ] **Step 5: Commit the conversion core**

```bash
git add scripts/feishu/ids.mjs scripts/feishu/records.mjs scripts/feishu/blocks.mjs tests/feishu-conversion.test.mjs tests/fixtures/feishu-document.json
git commit -m "feat: convert Feishu documents to Markdown"
```

## Task 6: Implement the retried Feishu client and media localization

**Files:**
- Create: `scripts/feishu/client.mjs`
- Create: `scripts/feishu/assets.mjs`
- Create: `tests/feishu-client.test.mjs`

- [ ] **Step 1: Write failing client contract tests with a local fake fetch**

Test these behaviors independently: missing `FEISHU_APP_ID` and `FEISHU_APP_SECRET` list both names; tenant token POST body contains `app_id` and `app_secret`; list-records and list-blocks follow `has_more/page_token`; HTTP 429 retries after the injected sleeper; nonzero Feishu `code` includes `msg`; media bytes are named by SHA-256 plus an extension derived from `Content-Type`.

```js
test('429 is retried through the injected sleeper', async () => {
  let calls = 0;
  const sleeps = [];
  const fetchImpl = async () => ++calls === 1
    ? new Response(JSON.stringify({ code: 99991400, msg: 'rate limit' }), { status: 429 })
    : new Response(JSON.stringify({ code: 0, data: { ok: true } }));
  const client = createFeishuClient({ appId: 'id', appSecret: 'secret', fetchImpl, sleep: (ms) => sleeps.push(ms), random: () => 0 });
  const result = await client.request('/example');
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.equal(sleeps.length, 1);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH node --test tests/feishu-client.test.mjs`

Expected: FAIL because the client and asset modules do not exist.

- [ ] **Step 3: Implement dependency-injected API and media helpers**

Use native `fetch`, never log request headers, cache the tenant token for the process lifetime, cap block pages at 500 records, cap Bitable pages at 500 records, and serialize requests to remain below 5 QPS. Retry HTTP 429, 500, 502, 503, and 504 at most four times with `500ms × 2^attempt + jitter`. Expose `listPublishedRecords(appToken, tableId)`, `getDocument(documentId)`, `listDocumentBlocks(documentId, revisionId)`, and `downloadMedia(fileToken, extra)`. Write assets only after all network reads and validations succeed.

- [ ] **Step 4: Verify GREEN**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH node --test tests/feishu-client.test.mjs`

Expected: all client tests pass without real network access.

- [ ] **Step 5: Commit the client**

```bash
git add scripts/feishu/client.mjs scripts/feishu/assets.mjs tests/feishu-client.test.mjs
git commit -m "feat: add reliable Feishu API client"
```

## Task 7: Build the all-or-nothing content synchronizer

**Files:**
- Create: `scripts/feishu/sync.mjs`
- Create: `scripts/feishu/manifest.mjs`
- Create: `tests/feishu-sync.test.mjs`
- Create: `src/content/posts/feishu/.gitkeep`
- Create: `public/media/feishu/.gitkeep`

- [ ] **Step 1: Write failing synchronization tests in temporary directories**

Cover four exact scenarios: one published row creates Markdown with valid YAML; a second run produces no file changes; removing the row removes its generated Markdown and unreferenced media; any invalid row leaves the previous output tree byte-for-byte unchanged. Also assert duplicate slugs across records fail before writes.

```js
test('invalid input preserves the previous generated tree', async () => {
  const root = await makeFixtureTree();
  const before = await snapshotTree(root);
  await assert.rejects(() => syncFeishu({ root, client: invalidRecordClient }), /rec-invalid/);
  assert.deepEqual(await snapshotTree(root), before);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH node --test tests/feishu-sync.test.mjs`

Expected: FAIL because the synchronizer does not exist.

- [ ] **Step 3: Implement staging, revision checks, and atomic replacement**

Validate `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_BITABLE_APP_TOKEN`, and `FEISHU_BITABLE_TABLE_ID`. Fetch every published row, validate all metadata and unique slugs, read a document revision before and after fetching blocks, retry once if changed, localize body images and optional cover, then render YAML with the `yaml` package. Build the entire next tree inside an OS temporary directory. Only after every article succeeds, atomically replace `src/content/posts/feishu`, `public/media/feishu`, and `.feishu-manifest.json`. Preserve `.gitkeep` for an empty published set.

- [ ] **Step 4: Verify GREEN and the full regression suite**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npm test`

Expected: all tests pass, including conversion, client, and sync tests.

- [ ] **Step 5: Commit the synchronizer**

```bash
git add scripts/feishu/sync.mjs scripts/feishu/manifest.mjs tests/feishu-sync.test.mjs src/content/posts/feishu/.gitkeep public/media/feishu/.gitkeep
git commit -m "feat: synchronize published Feishu articles"
```

## Task 8: Add production workflows and operator documentation

**Files:**
- Create: `.github/workflows/deploy.yml`
- Create: `.github/workflows/sync-feishu.yml`
- Create: `docs/FEISHU_SETUP.md`
- Create: `README.md`
- Create: `tests/workflows.test.mjs`

- [ ] **Step 1: Write failing workflow policy tests**

Assert `deploy.yml` has `pages: write`, `id-token: write`, a Node 24 setup, `npm ci`, `npm run verify`, `actions/upload-pages-artifact`, and `actions/deploy-pages`. Assert `sync-feishu.yml` handles `repository_dispatch` type `feishu_publish`, `workflow_dispatch`, cron `*/30 * * * *`, declares `contents: write`, maps exactly four Feishu secrets, runs `npm run sync:feishu`, and commits only generated content and the manifest.

- [ ] **Step 2: Run the policy tests and verify RED**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH node --test tests/workflows.test.mjs`

Expected: FAIL because workflows do not exist.

- [ ] **Step 3: Add exact workflows**

```yaml
# .github/workflows/deploy.yml
name: Deploy blog
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run verify
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v4
        with: { path: dist }
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
```

The sync workflow checks out `main`, installs with `npm ci`, runs the sync command with repository secrets, stages only `src/content/posts/feishu`, `public/media/feishu`, and `.feishu-manifest.json`, exits successfully on no diff, otherwise commits as `github-actions[bot]` and pushes.

- [ ] **Step 4: Write complete setup and recovery instructions**

`docs/FEISHU_SETUP.md` must contain the exact nine Bitable fields and types, the Open Platform permissions (`docx:document:readonly`, `docs:document.media:download`, `bitable:app:readonly`), resource-sharing requirement, four GitHub secret names, the fine-grained PAT restriction, and this automation request:

```http
POST https://api.github.com/repos/XMo2004/XMo2004.github.io/actions/workflows/sync-feishu.yml/dispatches
Accept: application/vnd.github+json
Authorization: Bearer <fine-grained token stored only in Feishu>
X-GitHub-Api-Version: 2026-03-10
Content-Type: application/json

{"ref":"main"}
```

Also document how to inspect a failed Action, manually run the sync workflow, rotate both secrets, and restore a previous content commit.

- [ ] **Step 5: Verify workflows and full build**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npm run verify && PATH=/opt/homebrew/opt/node/bin:$PATH node --test tests/workflows.test.mjs`

Expected: all checks exit 0.

- [ ] **Step 6: Commit automation and docs**

```bash
git add .github README.md docs/FEISHU_SETUP.md tests/workflows.test.mjs
git commit -m "ci: automate Feishu sync and Pages deployment"
```

## Task 9: Perform local browser quality assurance

**Files:**
- Modify only files implicated by observed issues.
- Create: `artifacts/qa/desktop-home.png`
- Create: `artifacts/qa/mobile-post.png`

- [ ] **Step 1: Start a production preview**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npm run build && PATH=/opt/homebrew/opt/node/bin:$PATH npm run preview -- --host 127.0.0.1`

Expected: preview serves the built site at `http://127.0.0.1:4321`.

- [ ] **Step 2: Inspect desktop and mobile states in a real browser**

Check 1440×1000 and 390×844 viewports for home, posts, welcome article, tags, about, and 404. Verify no console errors, no horizontal overflow, visible keyboard focus, 44px interactive targets, theme persistence across navigation, readable code/table overflow, and reduced-motion behavior. Save the two screenshots named above.

- [ ] **Step 3: Fix every observed defect with a regression check**

For a source-level issue, add a focused assertion to `tests/ui-source.test.mjs`; for generated markup, add it to `tests/build-output.test.mjs`. Run the new assertion once to observe failure, implement the smallest fix, then rerun the full verification.

- [ ] **Step 4: Commit verified visual fixes and QA evidence**

```bash
git add src tests artifacts/qa
git commit -m "test: verify responsive blog experience"
```

## Task 10: Create the public repository and deploy GitHub Pages

**Files:**
- No new source files unless the live workflow exposes a defect.

- [ ] **Step 1: Run the release gate locally**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH npm run verify && git status --short`

Expected: all checks pass and the worktree is clean.

- [ ] **Step 2: Create and push the public repository**

```bash
gh repo create XMo2004/XMo2004.github.io --public --source=. --remote=origin --push --description "小陌的个人博客，由飞书驱动并静态发布。"
```

Expected: repository creation and initial push succeed.

- [ ] **Step 3: Enable Pages through GitHub Actions and watch deployment**

Run `gh api --method POST repos/XMo2004/XMo2004.github.io/pages -f build_type=workflow`; if Pages already exists, update it with `gh api --method PUT repos/XMo2004/XMo2004.github.io/pages -f build_type=workflow`. Watch the `Deploy blog` run to completion with `gh run watch --exit-status`.

- [ ] **Step 4: Verify the live static surface**

Request `/`, `/posts/`, `/posts/welcome/`, `/about/`, `/rss.xml`, `/sitemap-index.xml`, `/robots.txt`, and `/404.html`. Every expected public page must return 200 over HTTPS; the welcome page must contain its title and canonical URL.

## Task 11: Configure Feishu and prove publish/update/unpublish end to end

**Files:**
- Modify: `docs/FEISHU_SETUP.md` only if the actual Feishu UI differs from the documented steps.

- [ ] **Step 1: Create the Feishu self-built app**

In the user's existing Feishu session, create an app named “小陌博客发布器”, add the three read-only permissions from Task 8, publish the app version, and copy App ID and App Secret without exposing them in logs or source files. Add the app as a collaborator to the publishing Bitable and test document.

- [ ] **Step 2: Create the Bitable publishing console**

Create “博客发布中心” with table “博客文章” and all nine fields from the design. Add one row pointing to a dedicated test document titled “从飞书发布的第一篇文章”, slug `published-from-feishu`, summary “这篇文章用于验证飞书到静态博客的完整发布链路。”, tag “发布测试”, current date, and initial state “草稿”.

- [ ] **Step 3: Store GitHub secrets and the trigger token**

Save the four Feishu values with `gh secret set` using stdin so values never appear in command arguments or output. Create a fine-grained GitHub token restricted to `XMo2004.github.io` with Contents write permission, and place it only in the Feishu automation header.

- [ ] **Step 4: Configure and test the outgoing automation**

Create a Bitable automation whose trigger is “状态变为已发布” and action is “发送 HTTP 请求” using the exact Task 8 request. Add a second trigger path for “状态变为已下线”, or configure one condition that fires whenever 状态 is either 已发布 or 已下线. Confirm the automation receives HTTP 204 from GitHub.

- [ ] **Step 5: Prove initial publication**

Change the test row to “已发布”. Verify the `Sync Feishu posts` run succeeds, a generated Markdown commit appears, `Deploy blog` succeeds, and `https://xmo2004.github.io/posts/published-from-feishu/` contains the test title and body image/text from the source document.

- [ ] **Step 6: Prove update propagation**

Add the sentence “更新验证：内容已从飞书重新发布。” to the Feishu document and retrigger publication. Verify the live article contains that sentence after deployment and only one URL exists for the stable slug.

- [ ] **Step 7: Prove unpublish propagation**

Set the row to “已下线”. Verify the sync commit removes the generated Markdown, Pages deploy succeeds, and the article URL returns the site 404 while the welcome article remains available.

- [ ] **Step 8: Restore a useful published example and record final evidence**

Return the test row to “已发布” so the live site demonstrates the integration. Record the final repository URL, Pages URL, Bitable name, workflow run IDs, and last successful deployment time in the final handoff; do not record any credential values.

## Final release audit

- [ ] Re-read `docs/superpowers/specs/2026-07-12-feishu-blog-design.md` and map every requirement to current evidence.
- [ ] Run a fresh `npm run verify` with Node 24 and read the complete output.
- [ ] Confirm the Git worktree is clean and GitHub Actions are green.
- [ ] Re-request the live home, article, RSS, sitemap, robots, and 404 endpoints.
- [ ] Confirm the real Feishu publish, update, and unpublish evidence exists.
- [ ] Confirm repository files and workflow logs contain none of the credential values.
- [ ] Mark the goal complete only after all checks above pass.
