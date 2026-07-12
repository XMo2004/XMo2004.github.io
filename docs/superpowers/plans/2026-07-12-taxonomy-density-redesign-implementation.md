# Taxonomy and Dense Editorial Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class categories and ordered columns from Feishu through static routes, while shipping the approved high-density editorial redesign and motion system.

**Architecture:** Extend the post schema with one required category and an optional column/order pair. Reuse deterministic taxonomy slug logic to build category and column indexes, then render static Astro directory/detail routes. Keep Feishu as the publishing control plane, native CSS/SVG as the motion layer, and GitHub Pages as the only runtime.

**Tech Stack:** Astro 7 content collections, TypeScript helpers, Node test runner, native CSS/SVG/IntersectionObserver, Feishu Base CLI, GitHub Actions and GitHub Pages.

---

### Task 1: Taxonomy domain model and content schema

**Files:**
- Modify: `tests/posts.test.mjs`
- Modify: `src/lib/posts.ts`
- Modify: `src/content.config.ts`
- Modify: `src/content/posts/manual/welcome.md`

- [ ] **Step 1: Write failing taxonomy helper tests**

Add imports and tests for `buildCategoryIndex`, `buildColumnIndex`, `getCategoryHref`, and `getColumnHref`. The fixtures must prove that categories group newest-first, columns group by positive `columnOrder`, Unicode labels get safe stable paths, route collisions throw, and duplicate column orders throw with both post ids.

```js
assert.deepEqual(
  buildColumnIndex([second, first])[0].posts.map((post) => post.id),
  ['manual/first.md', 'feishu/second.md'],
);
assert.equal(getCategoryHref('技术'), `/categories/${normalizeTag('技术')}/`);
assert.equal(getColumnHref('博客搭建手记'), `/columns/${normalizeTag('博客搭建手记')}/`);
assert.throws(() => buildColumnIndex([first, duplicate]), /duplicate.*order.*1/i);
```

- [ ] **Step 2: Verify the new tests fail for missing exports**

Run:

```sh
PATH=/opt/homebrew/bin:$PATH node --experimental-strip-types --test tests/posts.test.mjs
```

Expected: FAIL because taxonomy functions do not exist.

- [ ] **Step 3: Implement the taxonomy helpers**

Add typed category/column index entries. Reuse the existing canonicalization and slug collision rules. Sort category posts with `sortNewestFirst`; sort column posts by `columnOrder`, reject missing/non-positive orders and duplicates, and sort directory entries with `localeCompare('zh-CN')`.

- [ ] **Step 4: Make the content schema enforce the model**

Add:

```ts
category: z.string().trim().min(1),
column: z.string().trim().min(1).optional(),
columnOrder: z.number().int().positive().optional(),
```

Use `superRefine` so `column` and `columnOrder` must appear together. Add the migrated manual post values:

```yaml
category: 随笔
column: 博客搭建手记
columnOrder: 1
```

- [ ] **Step 5: Verify Task 1**

Run the posts tests and `npm run check` with Node 24. Expected: all pass, 0 Astro diagnostics.

### Task 2: Feishu category and column ingestion

**Files:**
- Modify: `tests/feishu-records.test.mjs`
- Modify: `tests/feishu-sync.test.mjs`
- Modify: `scripts/feishu/records.mjs`
- Modify: `scripts/feishu/sync.mjs`
- Modify: `docs/FEISHU_SETUP.md`

- [ ] **Step 1: Write failing Feishu record tests**

Update `validFields()` with `分类: '技术'`, `专栏: '博客搭建手记'`, and `专栏序号: 2`. Assert the normalized record contains `category`, `column`, and `columnOrder`. Add failures for empty category, column without order, order without column, zero, fractional and string orders.

- [ ] **Step 2: Verify the record tests fail**

Run the single record test file with Node 24. Expected: FAIL because normalized output lacks the new fields and invalid combinations are accepted.

- [ ] **Step 3: Implement strict Feishu normalization**

Add a single-select text normalizer and a positive-integer order normalizer. Return:

```js
category: normalizeSingleSelect(fields.分类, recordId, '分类'),
column: normalizeSingleSelect(fields.专栏, recordId, '专栏', { optional: true }),
columnOrder: normalizeColumnOrder(fields.专栏序号, recordId),
```

Reject mismatched column/order pairs before returning the record.

- [ ] **Step 4: Write and verify failing sync frontmatter tests**

Update published record fixtures. Assert generated Markdown includes `category`, `column`, and `columnOrder`, and contains no Feishu internal ids. Run the sync test file and observe the expected failure.

- [ ] **Step 5: Serialize the public fields**

Add `category` unconditionally and the column pair conditionally in `postFrontmatter(article)`. Update the setup guide table and author workflow.

- [ ] **Step 6: Verify Task 2**

Run Feishu record and sync tests with Node 24. Expected: all pass.

### Task 3: Static category and column routes

**Files:**
- Create: `src/pages/categories/index.astro`
- Create: `src/pages/categories/[category].astro`
- Create: `src/pages/columns/index.astro`
- Create: `src/pages/columns/[column].astro`
- Create: `src/components/PostRow.astro`
- Modify: `src/components/SiteHeader.astro`
- Modify: `src/pages/index.astro`
- Modify: `src/pages/posts/index.astro`
- Modify: `src/pages/tags/[tag].astro`
- Modify: `tests/ui-source.test.mjs`
- Modify: `tests/build-output.test.mjs`

- [ ] **Step 1: Write failing route and source tests**

Require navigation labels `分类` and `专栏`; require the four new route files to call their corresponding index helpers; require the homepage to render real category and column indexes; require archive/taxonomy detail pages to use `PostRow`; and require build output for both directory routes and the migrated category/column detail routes.

- [ ] **Step 2: Verify the tests fail for missing routes/components**

Run the UI source tests. Expected: FAIL with missing files/labels.

- [ ] **Step 3: Implement a reusable dense `PostRow`**

Render optional thumbnail, date, title, one-line description, category link, optional column link/order and compact tag list. Keep one full-card post link plus independent taxonomy links without invalid nested anchors.

- [ ] **Step 4: Implement directory and detail routes**

Generate static paths from `buildCategoryIndex` and `buildColumnIndex`. Category details remain newest-first; column details show `01`, `02`, ... in the declared order. All pages use real counts and never fabricate descriptions.

- [ ] **Step 5: Integrate navigation and homepage indexes**

Add category/column navigation destinations and current-path detection. Replace the old hero description/actions/note with animated brand markup. Add compact real category and column index strips before content sections. Switch archive and taxonomy detail listings to `PostRow`.

- [ ] **Step 6: Verify Task 3**

Run UI tests and a clean build. Expected: new routes build successfully and sitemap includes both taxonomy families.

### Task 4: Article taxonomy and adaptive table of contents

**Files:**
- Modify: `src/pages/posts/[...id].astro`
- Modify: `src/layouts/PostLayout.astro`
- Modify: `tests/ui-source.test.mjs`

- [ ] **Step 1: Write failing article layout tests**

Assert the route passes category/column/order, the layout links to both taxonomy routes, and the TOC visibility threshold is `headings.filter(depth 2..4).length >= 2`. Require `<details>` markup for compact viewports.

- [ ] **Step 2: Verify the tests fail**

Run UI source tests and confirm failures are caused by missing taxonomy and adaptive TOC behavior.

- [ ] **Step 3: Implement the compact header and TOC rules**

Add category/column props, linked pills and column order. Build a filtered TOC once; omit it below two entries. Render desktop and native-details variants from the same items so navigation remains available without JavaScript.

- [ ] **Step 4: Verify Task 4**

Run UI tests and `astro check`. Expected: pass with 0 diagnostics.

### Task 5: Dense editorial styles and motion system

**Files:**
- Modify: `src/components/ThemeToggle.astro`
- Modify: `src/components/SiteFooter.astro`
- Modify: `src/styles/global.css`
- Modify: `tests/ui-source.test.mjs`

- [ ] **Step 1: Write failing visual contract tests**

Require animated title fragments with one accessible h1, hollow XMO SVG markup, a borderless theme control, footer brand icon/text reveal hook, pill radius, dense post rows, one-line-friendly desktop article title, right-side TOC, compact mobile details and explicit reduced-motion final states.

- [ ] **Step 2: Verify visual tests fail**

Run UI source tests. Expected: FAIL on the new selectors and removed legacy hero content.

- [ ] **Step 3: Implement the visual system**

Use existing color/font tokens. Reduce global desktop vertical spacing by roughly 25%–35%; keep 44px targets. Implement CSS/SVG animations with transforms, opacity, clip-path and stroke-dashoffset only. Use a tiny IntersectionObserver in the footer to add `is-visible`; treat it as progressive enhancement. Add explicit static states under `prefers-reduced-motion`.

- [ ] **Step 4: Verify Task 5**

Run UI tests, Astro check and production build. Expected: all pass and no warnings beyond Node's existing TypeScript stripping notice.

### Task 6: Feishu Base migration, end-to-end verification and deployment

**Files:**
- Modify through Feishu CLI: Base fields `分类`, `专栏`, `专栏序号`
- Generated by sync: `src/content/posts/feishu/published-from-feishu.md`

- [ ] **Step 1: Create Base fields safely**

List fields, dry-run and create only missing fields:

```json
{"name":"分类","type":"select","multiple":false,"options":[{"name":"技术"},{"name":"成长"},{"name":"日常"},{"name":"随笔"}]}
{"name":"专栏","type":"select","multiple":false,"options":[{"name":"博客搭建手记"}]}
{"name":"专栏序号","type":"number"}
```

- [ ] **Step 2: Populate and re-read the published record**

Patch the exact record with `分类=技术`, `专栏=博客搭建手记`, `专栏序号=2`; verify the title, status and all three values by CLI.

- [ ] **Step 3: Run fresh complete verification**

Run `npm run verify` under Node 24. Expected: every test passes, Astro reports 0 errors/warnings/hints, and all static routes build.

- [ ] **Step 4: Browser QA**

Verify desktop and mobile widths, light/dark themes, reduced motion, keyboard focus, horizontal mobile navigation, text fit, TOC variants and console output.

- [ ] **Step 5: Commit, push and verify Pages**

Push the reviewed implementation to `main`, watch the deploy workflow to success, then verify HTTP 200 for home, category directory/detail, column directory/detail, article and RSS. Confirm the deployed HTML contains the migrated taxonomy values and no Feishu internal metadata.
