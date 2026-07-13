# Responsive Cover Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert every Feishu article cover into deterministic responsive WebP variants, render the appropriate variant in each card, migrate the current 2 MiB PNG, and preserve the existing journaled transactional publishing and rollback guarantees.

**Architecture:** A focused Sharp-backed module validates and transforms one downloaded cover before the existing staging boundary. The generated frontmatter carries a validated responsive-cover object, while one reusable Astro component converts that object into `srcset`, `sizes` and intrinsic dimensions and remains compatible with legacy string covers. Code is deployed before generated content is migrated; the existing Feishu sync workflow then performs the real content/media replacement and deploys the optimized site.

**Tech Stack:** Node.js 24, Sharp 0.35.3, Astro 7, Zod through `astro/zod`, YAML, Node test runner, GitHub Actions, GitHub Pages and the in-app browser.

---

## Scope and release invariants

- Preserve the current visual crop, card dimensions, CSS and article content.
- Preserve the Base schema and the single Feishu cover attachment field.
- Preserve the existing `10 MiB` body-media limit, synchronization-wide network budget, document revision check, staging tree, transaction journal, three-target replacement, rollback and next-run recovery. This is a journaled transaction, not a single cross-path atomic syscall.
- A cover source is at most `5 MiB`, at most `24,000,000` oriented pixels, static and decodable.
- Generated widths are drawn from `320 / 640 / 960 / 1440`, never enlarged, strictly increasing and unique.
- The variants produced from each unique cover source total at most `1 MiB`; the current real cover must total less than `128 KiB`.
- Only derived WebP files are published for a cover unless the same source is independently referenced in the article body.
- Code deployment must accept the existing string cover before the Feishu migration runs.
- After migration, never roll back only the schema/rendering code to a string-only revision: revert code plus generated Markdown/media/manifest together, or restore a compatible revision and rerun the sync workflow.
- Never hand-edit `src/content/posts/feishu/`, `public/media/feishu/` or `.feishu-manifest.json`.
- Never expose Feishu record IDs, document IDs, file tokens, private URLs or credentials in generated metadata, logs, commits or browser output.
- Preserve the unrelated untracked `.playwright-cli/` directory in the main worktree.

## File responsibility map

Create:

- `scripts/feishu/covers.mjs` — validate one cover source and return deterministic responsive metadata plus content-addressed WebP assets.
- `tests/feishu-covers.test.mjs` — exercise dimensions, determinism, orientation, animation and every cover budget.
- `src/lib/cover.ts` — define the shared cover type and Zod schema for legacy and responsive metadata.
- `tests/cover.test.mjs` — validate accepted and rejected metadata shapes independently from Astro collection loading.
- `src/components/CoverImage.astro` — render one legacy or responsive cover without owning layout.

Modify:

- `package.json`, `package-lock.json` — declare exact direct dependency `sharp@0.35.3`.
- `src/content.config.ts` — consume the shared `coverSchema`.
- `src/components/PostCard.astro` — render the featured cover eagerly with the card `sizes` contract.
- `src/components/PostRow.astro` — render list covers lazily with the thumbnail `sizes` contract.
- `src/pages/index.astro` — identify the single above-the-fold featured card as the priority image.
- `scripts/feishu/sync.mjs` — replace the downloaded cover source with generated responsive assets before staging.
- `tests/feishu-sync.test.mjs` — use a real image fixture and assert structured metadata, derived-only public assets, manifest safety and idempotency.
- `tests/ui-source.test.mjs` — lock the reusable component, loading priority and exact `sizes` strings.
- `tests/build-output.test.mjs` — add temporary responsive/legacy articles and a build-only contract page that asserts both card and row markup.
- `docs/FEISHU_SETUP.md` — document cover-specific source, pixel, animation and derived-output gates.

Generated only by the remote Feishu sync after the code release:

- `src/content/posts/feishu/published-from-feishu.md`
- `public/media/feishu/*.webp`
- `.feishu-manifest.json`

### Task 1: Create an isolated worktree and verify the baseline

**Files:**

- Read: `docs/superpowers/specs/2026-07-14-responsive-cover-pipeline-design.md`
- Read: `scripts/feishu/sync.mjs`
- Read: `src/content.config.ts`
- Read: `src/components/PostCard.astro`
- Read: `src/components/PostRow.astro`

- [ ] **Step 1: Confirm the main worktree and remote are synchronized**

Run in `/Users/xmo/Documents/Blog`:

```bash
git fetch origin
git status --short --branch
git rev-list --left-right --count origin/main...main
```

Expected: local `main` may be ahead only by the approved responsive-cover design/plan commits; there are no tracked changes and the only unrelated untracked path is `.playwright-cli/`.

- [ ] **Step 2: Create the isolated implementation worktree**

Verify the existing local worktree directory is ignored, then create the branch from current `main`:

```bash
git check-ignore -q .worktrees
git worktree add .worktrees/responsive-cover-pipeline \
  -b codex/responsive-cover-pipeline main
```

Expected: worktree path is `/Users/xmo/Documents/Blog/.worktrees/responsive-cover-pipeline` and branch is `codex/responsive-cover-pipeline`.

- [ ] **Step 3: Install the locked baseline and run full verification**

Run in the new worktree:

```bash
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm ci
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run verify
```

Expected baseline: 212 tests pass, Astro reports zero errors/warnings/hints and 22 pages build. Stop and investigate any baseline failure before changing files.

### Task 2: Build the deterministic cover processor with TDD

**Files:**

- Create: `tests/feishu-covers.test.mjs`
- Create: `scripts/feishu/covers.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write processor tests before the module exists**

Create `tests/feishu-covers.test.mjs` with the following contracts. The dynamic loader converts a missing implementation into an assertion failure rather than a module-loader error:

```js
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import sharp from 'sharp';

const ANIMATED_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAExpcf8AACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgAAACwAAAAAAQABAAACAkwBACH5BAUKAAAALAAAAAABAAEAgExpcQAA/wICTAEAOw==',
  'base64',
);
const VECTOR_IMAGE = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="8" height="4"/></svg>',
);

async function loadCoverModule() {
  const module = await import('../scripts/feishu/covers.mjs').catch(() => ({}));
  assert.equal(typeof module.createResponsiveCover, 'function');
  return module;
}

function source(bytes, contentType = 'image/png') {
  return Object.freeze({ bytes: new Uint8Array(bytes), contentType });
}

async function solidPng(width, height) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 180, g: 90, b: 50 },
    },
  }).png().toBuffer();
}

test('responsive cover emits deterministic content-addressed WebP widths', async () => {
  const { createResponsiveCover } = await loadCoverModule();
  const input = source(await solidPng(1672, 941));
  const first = await createResponsiveCover(input);
  const second = await createResponsiveCover(input);

  assert.deepEqual(first.cover.variants.map(({ width }) => width), [320, 640, 960, 1440]);
  assert.equal(first.cover.width, 1440);
  assert.equal(first.cover.height, 810);
  assert.equal(first.cover.src, first.cover.variants.at(-1).src);
  assert.ok(first.assets.every((asset) => asset.contentType === 'image/webp'));
  assert.ok(first.assets.every((asset) => /^\/[a-z/]+\/[a-f0-9]{64}\.webp$/.test(asset.publicPath)));
  assert.deepEqual(
    first.assets.map(({ filename, bytes }) => [filename, Buffer.from(bytes).toString('hex')]),
    second.assets.map(({ filename, bytes }) => [filename, Buffer.from(bytes).toString('hex')]),
  );
});

test('responsive cover never enlarges or duplicates small and exact widths', async () => {
  const { createResponsiveCover } = await loadCoverModule();
  const cases = [
    [200, [200]],
    [320, [320]],
    [500, [320, 500]],
    [640, [320, 640]],
    [1000, [320, 640, 960, 1000]],
  ];

  for (const [inputWidth, expectedWidths] of cases) {
    const result = await createResponsiveCover(
      source(await solidPng(inputWidth, Math.max(1, Math.floor(inputWidth / 2)))),
    );
    assert.deepEqual(
      result.cover.variants.map(({ width }) => width),
      expectedWidths,
    );
    assert.equal(result.cover.width, expectedWidths.at(-1));
    assert.equal(new Set(result.cover.variants.map(({ width }) => width)).size, expectedWidths.length);
  }
});

test('responsive cover applies EXIF orientation before sizing', async () => {
  const { createResponsiveCover } = await loadCoverModule();
  const jpeg = await sharp({
    create: {
      width: 10,
      height: 20,
      channels: 3,
      background: { r: 40, g: 80, b: 120 },
    },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await createResponsiveCover(source(jpeg, 'image/jpeg'));

  assert.equal(result.cover.width, 20);
  assert.equal(result.cover.height, 10);
});

test('responsive cover rejects source, pixel, animation, decode and output budgets', async () => {
  const {
    createResponsiveCover,
    MAX_COVER_SOURCE_BYTES,
  } = await loadCoverModule();

  const overPixelBudget = await solidPng(5000, 5000);
  const tiny = await solidPng(8, 4);

  await assert.rejects(
    createResponsiveCover(source(new Uint8Array(MAX_COVER_SOURCE_BYTES + 1))),
    /5 MiB source limit/,
  );
  await assert.rejects(
    createResponsiveCover(source(overPixelBudget)),
    /24 MP pixel limit/,
  );
  await assert.rejects(
    createResponsiveCover(source(ANIMATED_GIF, 'image/gif')),
    /static image/,
  );
  await assert.rejects(
    createResponsiveCover(source(VECTOR_IMAGE, 'image/svg+xml')),
    /static image/,
  );
  await assert.rejects(
    createResponsiveCover(source(new TextEncoder().encode('not an image'))),
    /decodable static image/,
  );
  await assert.rejects(
    createResponsiveCover(source(tiny), { maxVariantBytes: 1 }),
    /1 MiB variant limit/,
  );
});

test('responsive cover filenames hash the emitted bytes', async () => {
  const { createResponsiveCover } = await loadCoverModule();
  const result = await createResponsiveCover(source(await solidPng(1600, 900)));

  for (const asset of result.assets) {
    const expectedHash = createHash('sha256').update(asset.bytes).digest('hex');
    assert.equal(asset.hash, expectedHash);
    assert.equal(asset.filename, `${expectedHash}.webp`);
    const metadata = await sharp(asset.bytes).metadata();
    assert.equal(metadata.format, 'webp');
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  node --experimental-strip-types --test tests/feishu-covers.test.mjs
```

Expected: tests fail by assertion because `createResponsiveCover` does not exist. A syntax error or missing `sharp` resolution is not an acceptable RED; fix the test harness until the failure describes the missing processor.

- [ ] **Step 3: Declare Sharp as a direct exact dependency**

```bash
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  npm install --save-exact sharp@0.35.3
```

Expected: `sharp` appears in `dependencies` with exact version `0.35.3`; the lockfile changes without unrelated dependency upgrades.

- [ ] **Step 4: Implement the processor**

Create `scripts/feishu/covers.mjs`:

```js
import sharp from 'sharp';

import { contentAddressedMedia } from './assets.mjs';

export const COVER_WIDTHS = Object.freeze([320, 640, 960, 1440]);
export const MAX_COVER_SOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_COVER_PIXELS = 24_000_000;
export const MAX_COVER_VARIANT_BYTES = 1024 * 1024;

const WEBP_OPTIONS = Object.freeze({
  quality: 78,
  effort: 4,
  smartSubsample: true,
});

function positiveBudget(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}

function orientedDimensions(metadata) {
  const width = metadata.autoOrient?.width ?? metadata.width;
  const height = metadata.autoOrient?.height ?? metadata.height;
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new Error('Cover must expose positive integer dimensions.');
  }
  if (metadata.autoOrient !== undefined) return { width, height };
  return [5, 6, 7, 8].includes(metadata.orientation)
    ? { width: height, height: width }
    : { width, height };
}

async function readCoverMetadata(bytes) {
  try {
    return await sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: MAX_COVER_PIXELS,
      sequentialRead: true,
    }).metadata();
  } catch {
    throw new Error('Cover must be a decodable static image within the 24 MP pixel limit.');
  }
}

export async function createResponsiveCover(
  { bytes } = {},
  { maxVariantBytes = MAX_COVER_VARIANT_BYTES } = {},
) {
  positiveBudget(maxVariantBytes, 'maxVariantBytes');
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('Cover source bytes must be a Uint8Array.');
  }
  if (bytes.byteLength === 0) {
    throw new Error('Cover source must not be empty.');
  }
  if (bytes.byteLength > MAX_COVER_SOURCE_BYTES) {
    throw new Error('Cover exceeds the 5 MiB source limit.');
  }

  const metadata = await readCoverMetadata(bytes);
  if ((metadata.pages ?? 1) !== 1 || metadata.format === 'svg' || metadata.format === 'pdf') {
    throw new Error('Cover must be a static image.');
  }
  const dimensions = orientedDimensions(metadata);
  if (dimensions.width * dimensions.height > MAX_COVER_PIXELS) {
    throw new Error('Cover exceeds the 24 MP pixel limit.');
  }

  const finalWidth = Math.min(dimensions.width, COVER_WIDTHS.at(-1));
  const widths = [...new Set([
    ...COVER_WIDTHS.filter((width) => width < finalWidth),
    finalWidth,
  ])];
  const generated = [];
  let generatedBytes = 0;

  for (const width of widths) {
    let output;
    try {
      output = await sharp(bytes, {
        failOn: 'warning',
        limitInputPixels: MAX_COVER_PIXELS,
        sequentialRead: true,
      })
        .autoOrient()
        .resize({ width, withoutEnlargement: true })
        .webp(WEBP_OPTIONS)
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new Error('Cover WebP conversion failed.');
    }
    if (output.info.format !== 'webp') {
      throw new Error('Cover WebP conversion returned an unexpected format.');
    }
    generatedBytes += output.data.byteLength;
    if (generatedBytes > maxVariantBytes) {
      throw new Error('Cover exceeds the 1 MiB variant limit.');
    }
    const asset = contentAddressedMedia({
      bytes: output.data,
      contentType: 'image/webp',
    });
    generated.push({
      asset,
      width: output.info.width,
      height: output.info.height,
    });
  }

  const largest = generated.at(-1);
  return Object.freeze({
    cover: Object.freeze({
      src: largest.asset.publicPath,
      width: largest.width,
      height: largest.height,
      variants: Object.freeze(
        generated.map(({ asset, width }) => Object.freeze({
          src: asset.publicPath,
          width,
        })),
      ),
    }),
    assets: Object.freeze(generated.map(({ asset }) => asset)),
  });
}
```

- [ ] **Step 5: Run RED-to-GREEN verification and commit**

```bash
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  node --experimental-strip-types --test tests/feishu-covers.test.mjs
git diff --check
git add package.json package-lock.json scripts/feishu/covers.mjs tests/feishu-covers.test.mjs
git commit -m "feat: generate responsive Feishu covers"
```

Expected: all processor tests pass and only the four named files are committed.

### Task 3: Define and validate the responsive cover content model

**Files:**

- Create: `src/lib/cover.ts`
- Create: `tests/cover.test.mjs`
- Modify: `src/content.config.ts`

- [ ] **Step 1: Write failing schema tests**

Create `tests/cover.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

async function loadCoverSchema() {
  const module = await import('../src/lib/cover.ts').catch(() => ({}));
  assert.equal(typeof module.coverSchema?.safeParse, 'function');
  return module.coverSchema;
}

const valid = {
  src: '/media/feishu/large.webp',
  width: 960,
  height: 540,
  variants: [
    { src: '/media/feishu/small.webp', width: 320 },
    { src: '/media/feishu/medium.webp', width: 640 },
    { src: '/media/feishu/large.webp', width: 960 },
  ],
};

test('cover schema accepts legacy strings and canonical responsive metadata', async () => {
  const schema = await loadCoverSchema();
  assert.equal(schema.parse('/media/feishu/legacy.png'), '/media/feishu/legacy.png');
  assert.deepEqual(schema.parse(valid), valid);
});

test('cover schema rejects unsafe paths and non-positive dimensions', async () => {
  const schema = await loadCoverSchema();
  assert.equal(schema.safeParse({ ...valid, src: 'https://example.com/a.webp' }).success, false);
  assert.equal(schema.safeParse({ ...valid, src: '//example.com/a.webp' }).success, false);
  assert.equal(schema.safeParse({ ...valid, src: 'media/a.webp' }).success, false);
  assert.equal(schema.safeParse({ ...valid, src: '/media\\a.webp' }).success, false);
  assert.equal(schema.safeParse({ ...valid, src: '/media/a.webp?token=private' }).success, false);
  assert.equal(schema.safeParse({ ...valid, width: 0 }).success, false);
  assert.equal(schema.safeParse({ ...valid, width: -1 }).success, false);
  assert.equal(schema.safeParse({ ...valid, height: 1.5 }).success, false);
  assert.equal(schema.safeParse({ ...valid, variants: [] }).success, false);
});

test('cover schema rejects unordered, duplicate and mismatched variants', async () => {
  const schema = await loadCoverSchema();
  assert.equal(schema.safeParse({ ...valid, variants: [...valid.variants].reverse() }).success, false);
  assert.equal(schema.safeParse({
    ...valid,
    variants: [valid.variants[0], { ...valid.variants[1], width: 320 }, valid.variants[2]],
  }).success, false);
  assert.equal(schema.safeParse({
    ...valid,
    variants: [valid.variants[0], { ...valid.variants[1], src: valid.variants[0].src }, valid.variants[2]],
  }).success, false);
  assert.equal(schema.safeParse({
    ...valid,
    variants: [valid.variants[0], { ...valid.variants[1], src: '//private.example/a.webp' }, valid.variants[2]],
  }).success, false);
  assert.equal(schema.safeParse({ ...valid, src: '/media/feishu/other.webp' }).success, false);
  assert.equal(schema.safeParse({ ...valid, width: 1440 }).success, false);
});
```

- [ ] **Step 2: Run the schema test and verify RED**

```bash
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  node --experimental-strip-types --test tests/cover.test.mjs
```

Expected: assertion failure because `coverSchema` is absent.

- [ ] **Step 3: Implement the shared schema and type**

Create `src/lib/cover.ts`:

```ts
import { z } from 'astro/zod';

const publicAssetPath = z.string().regex(
  /^\/(?!\/)[^\\\s?#]+$/,
  'Cover paths must be same-origin absolute paths without backslashes, a query or a fragment.',
);

const responsiveCoverSchema = z
  .object({
    src: publicAssetPath,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    variants: z
      .array(z.object({
        src: publicAssetPath,
        width: z.number().int().positive(),
      }))
      .min(1),
  })
  .superRefine((cover, context) => {
    const paths = new Set<string>();
    let previousWidth = 0;
    for (const [index, variant] of cover.variants.entries()) {
      if (variant.width <= previousWidth) {
        context.addIssue({
          code: 'custom',
          message: 'Cover variant widths must be strictly increasing.',
          path: ['variants', index, 'width'],
        });
      }
      if (paths.has(variant.src)) {
        context.addIssue({
          code: 'custom',
          message: 'Cover variant paths must be unique.',
          path: ['variants', index, 'src'],
        });
      }
      previousWidth = variant.width;
      paths.add(variant.src);
    }
    const largest = cover.variants.at(-1);
    if (largest?.src !== cover.src || largest?.width !== cover.width) {
      context.addIssue({
        code: 'custom',
        message: 'Cover src and width must match the largest variant.',
        path: ['variants'],
      });
    }
  });

export const coverSchema = z.union([
  z.string(),
  responsiveCoverSchema,
]);

export type Cover = z.infer<typeof coverSchema>;
export type ResponsiveCover = z.infer<typeof responsiveCoverSchema>;
```

Replace `cover: z.string().optional()` in `src/content.config.ts` with an import and shared schema:

```ts
import { coverSchema } from './lib/cover';
```

```ts
cover: coverSchema.optional(),
```

- [ ] **Step 4: Verify GREEN, collection compatibility and commit**

```bash
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  node --experimental-strip-types --test tests/cover.test.mjs
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  npm run check
git diff --check
git add src/lib/cover.ts src/content.config.ts tests/cover.test.mjs
git commit -m "feat: validate responsive cover metadata"
```

Expected: schema tests pass and the existing string cover still passes Astro content validation.

### Task 4: Render responsive covers without changing layout

**Files:**

- Create: `src/components/CoverImage.astro`
- Modify: `src/components/PostCard.astro`
- Modify: `src/components/PostRow.astro`
- Modify: `src/pages/index.astro`
- Modify: `tests/ui-source.test.mjs`
- Modify: `tests/build-output.test.mjs`

- [ ] **Step 1: Add source-level assertions that fail against the old components**

Extend `post components use safe post and taxonomy routes` in `tests/ui-source.test.mjs` to read `CoverImage.astro` and require:

```js
assert.match(cardSource, /import CoverImage from ['"]\.\/CoverImage\.astro['"]/);
assert.match(cardSource, /priority\?: boolean/);
assert.match(cardSource, /priority=\{priority\}/);
assert.match(
  cardSource,
  /sizes=["']\(max-width: 48rem\) calc\(100vw - 2rem\), 30rem["']/,
);
assert.match(rowSource, /import CoverImage from ['"]\.\/CoverImage\.astro['"]/);
assert.doesNotMatch(rowSource, /priority=|loading=/);
assert.match(
  rowSource,
  /sizes=["']\(max-width: 30rem\) 1px, \(max-width: 48rem\) 5\.25rem, 7rem["']/,
);
assert.match(coverImageSource, /responsiveCover\.variants/);
assert.match(coverImageSource, /srcset=/);
assert.match(coverImageSource, /width=/);
assert.match(coverImageSource, /height=/);
assert.match(coverImageSource, /alt=["']["']/);
assert.match(coverImageSource, /decoding=["']async["']/);
assert.doesNotMatch(coverImageSource, /<style|<div|<picture/);
assert.match(indexSource, /<PostCard[^>]*priority/);
```

Make the test read `coverImageSource` and `indexSource` with the other component sources. Keep the existing CSS contract assertions for `object-fit: cover`, hover scaling and the row-cover `30rem / 48rem` breakpoints. Before the new file exists, create the assertions against the old `PostCard`/`PostRow` call sites first so RED is an assertion failure, then add the new file read after confirming RED.

- [ ] **Step 2: Add a responsive-cover clean-build fixture and output assertion**

In `tests/build-output.test.mjs`, add a third temporary article:

```js
const responsiveCoverFixtureSlug = 'build-output-responsive-cover';
const responsiveCoverFixture = `---
title: 构建输出响应式封面文章
description: 验证文章列表输出真实响应式图片属性。
pubDate: 2026-01-03
category: 测试
tags: []
featured: false
slug: ${responsiveCoverFixtureSlug}
cover:
  src: /media/feishu/cover-960.webp
  width: 960
  height: 540
  variants:
    - src: /media/feishu/cover-320.webp
      width: 320
    - src: /media/feishu/cover-640.webp
      width: 640
    - src: /media/feishu/cover-960.webp
      width: 960
---

响应式封面构建夹具。
`;
```

Add a legacy-string fixture and a temporary contract page beside that fixture:

```js
const legacyCoverFixtureSlug = 'build-output-legacy-cover';
const legacyCoverFixture = `---
title: 构建输出旧封面文章
description: 验证迁移窗口仍可渲染字符串封面。
pubDate: 2026-01-04
category: 测试
tags: []
featured: false
slug: ${legacyCoverFixtureSlug}
cover: /media/feishu/legacy-cover.png
---

旧封面构建夹具。
`;

const coverContractPage = `---
import { getCollection } from 'astro:content';
import PostCard from '../components/PostCard.astro';
import PostRow from '../components/PostRow.astro';

const posts = await getCollection('posts');
const responsive = posts.find(({ data }) => data.slug === '${responsiveCoverFixtureSlug}');
const legacy = posts.find(({ data }) => data.slug === '${legacyCoverFixtureSlug}');
if (responsive === undefined || legacy === undefined) throw new Error('cover contract fixtures missing');
---
<main>
  <section id="responsive-card"><PostCard entry={responsive} priority /></section>
  <section id="responsive-row"><PostRow entry={responsive} /></section>
  <section id="legacy-card"><PostCard entry={legacy} priority /></section>
  <section id="legacy-row"><PostRow entry={legacy} /></section>
</main>
`;
```

Write both Markdown fixtures under `src/content/posts/manual/` and the page to `src/pages/build-output-cover-contract.astro` in the temporary copy. Add a helper that slices one section by id and the following tests:

```js
function readContractSection(html, id) {
  const start = html.indexOf(`<section id="${id}">`);
  assert.notEqual(start, -1, `missing ${id}`);
  const end = html.indexOf('</section>', start);
  assert.notEqual(end, -1, `missing closing section for ${id}`);
  return html.slice(start, end + '</section>'.length);
}

test('cover contract emits responsive card and row attributes', async () => {
  const html = await readOutput('build-output-cover-contract/index.html');
  const card = readContractSection(html, 'responsive-card');
  const row = readContractSection(html, 'responsive-row');
  const srcset = /srcset="\/media\/feishu\/cover-320\.webp 320w, \/media\/feishu\/cover-640\.webp 640w, \/media\/feishu\/cover-960\.webp 960w"/;

  assert.match(card, srcset);
  assert.match(card, /sizes="\(max-width: 48rem\) calc\(100vw - 2rem\), 30rem"/);
  assert.match(card, /width="960"/);
  assert.match(card, /height="540"/);
  assert.match(card, /loading="eager"/);
  assert.match(card, /fetchpriority="high"/);
  assert.match(card, /decoding="async"/);

  assert.match(row, srcset);
  assert.match(row, /sizes="\(max-width: 30rem\) 1px, \(max-width: 48rem\) 5\.25rem, 7rem"/);
  assert.match(row, /loading="lazy"/);
  assert.doesNotMatch(row, /fetchpriority=/);
});

test('cover contract keeps legacy string covers compatible', async () => {
  const html = await readOutput('build-output-cover-contract/index.html');
  const card = readContractSection(html, 'legacy-card');
  const row = readContractSection(html, 'legacy-row');

  assert.match(card, /src="\/media\/feishu\/legacy-cover\.png"/);
  assert.match(card, /loading="eager"/);
  assert.match(card, /fetchpriority="high"/);
  assert.doesNotMatch(card, /srcset=|sizes=|width=|height=/);
  assert.match(row, /src="\/media\/feishu\/legacy-cover\.png"/);
  assert.match(row, /loading="lazy"/);
  assert.doesNotMatch(row, /srcset=|sizes=|width=|height=|fetchpriority=/);
});
```

- [ ] **Step 3: Run focused tests and verify RED**

```bash
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  node --experimental-strip-types --test \
  --test-name-pattern="post components use safe|cover contract" \
  tests/ui-source.test.mjs tests/build-output.test.mjs
```

Expected: assertions fail because the old components emit plain `<img>` elements without the responsive contract.

- [ ] **Step 4: Create the reusable renderer**

Create `src/components/CoverImage.astro`:

```astro
---
import type { Cover } from '../lib/cover';

interface Props {
  cover: Cover;
  sizes: string;
  priority?: boolean;
}

const { cover, sizes, priority = false } = Astro.props;
const responsiveCover = typeof cover === 'string' ? undefined : cover;
const src = responsiveCover?.src ?? cover;
const srcset = responsiveCover?.variants
  .map((variant) => `${variant.src} ${variant.width}w`)
  .join(', ');
const loading = priority ? 'eager' : 'lazy';
const fetchPriority = priority ? 'high' : undefined;
---

<img
  src={src}
  srcset={srcset}
  sizes={responsiveCover === undefined ? undefined : sizes}
  width={responsiveCover?.width}
  height={responsiveCover?.height}
  alt=""
  loading={loading}
  decoding="async"
  fetchpriority={fetchPriority}
/>
```

- [ ] **Step 5: Replace only the two image call sites**

Import `CoverImage` into `PostCard.astro` and replace its cover image with:

```astro
<CoverImage
  cover={cover}
  sizes="(max-width: 48rem) calc(100vw - 2rem), 30rem"
  priority={priority}
/>
```

Import it into `PostRow.astro` and replace its cover image with:

```astro
<CoverImage
  cover={cover}
  sizes="(max-width: 30rem) 1px, (max-width: 48rem) 5.25rem, 7rem"
/>
```

Add `priority?: boolean` to `PostCard.astro`, then replace its props destructuring with:

```ts
const { entry, headingLevel = 'h2', priority = false } = Astro.props;
```

Pass `priority` only to `CoverImage`. In `src/pages/index.astro`, change the single featured call to:

```astro
<PostCard entry={featured} headingLevel="h3" priority />
```

Loading priority therefore belongs to the above-the-fold page position rather than every future reuse of `PostCard`. Do not edit the wrappers or any CSS.

- [ ] **Step 6: Verify emitted markup, legacy compatibility and commit**

```bash
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  node --experimental-strip-types --test \
  --test-name-pattern="post components use safe|cover contract" \
  tests/ui-source.test.mjs tests/build-output.test.mjs
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  npm run check
git diff --check
git add src/components/CoverImage.astro src/components/PostCard.astro \
  src/components/PostRow.astro src/pages/index.astro \
  tests/ui-source.test.mjs tests/build-output.test.mjs
git commit -m "feat: render responsive article covers"
```

Expected: responsive fixture outputs all attributes, the current string cover still builds, and no CSS changes are present.

### Task 5: Integrate derived covers into the journaled Feishu sync

**Files:**

- Modify: `scripts/feishu/sync.mjs`
- Modify: `tests/feishu-sync.test.mjs`
- Modify: `docs/FEISHU_SETUP.md`

- [ ] **Step 1: Replace the fake cover bytes with one valid static image fixture**

Add near the test constants:

```js
const COVER_IMAGE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPYEmWEFTFQTwIA4Q0oAYnU9ewAAAAASUVORK5CYII=',
  'base64',
);
const DIFFERENT_COVER_IMAGE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQmXYHK2KgngQAbWswwUGo0YkAAAAASUVORK5CYII=',
  'base64',
);
```

Change the cover attachment name/type to `cover.png` / `image/png`, add `coverBytes = COVER_IMAGE_BYTES`, `coverContentType = 'image/png'` and `coverFileToken = 'cover_token'` options to `stableClient`, then change `stableClient.downloadMedia` to:

```js
return {
  bytes: isCover
    ? new Uint8Array(coverBytes)
    : new TextEncoder().encode('body-image-bytes'),
  contentType: isCover ? coverContentType : 'image/png',
};
```

Define `isCover` as `fileToken === coverFileToken`. This keeps most synchronization tests fast while allowing invalid, different-pixel and shared-token cases to override the source explicitly.

- [ ] **Step 2: Change the main sync assertion to the responsive contract**

In `sync creates valid Markdown, localized media, and a deterministic manifest`, remove the expected original `coverAsset` and assert:

```js
assert.equal(typeof frontmatter.cover, 'object');
assert.equal(frontmatter.cover.width, 8);
assert.equal(frontmatter.cover.height, 4);
assert.deepEqual(frontmatter.cover.variants, [
  { src: frontmatter.cover.src, width: 8 },
]);
assert.match(frontmatter.cover.src, /^\/media\/feishu\/[a-f0-9]{64}\.webp$/);

const mediaFiles = (await readdir(join(root, 'public/media/feishu'))).sort();
const rawCoverAsset = contentAddressedMedia({
  bytes: COVER_IMAGE_BYTES,
  contentType: 'image/png',
});
assert.equal(mediaFiles.length, 2);
assert.ok(mediaFiles.includes(bodyAsset.filename));
assert.ok(mediaFiles.includes(frontmatter.cover.src.split('/').at(-1)));
assert.ok(!mediaFiles.includes(rawCoverAsset.filename));

const manifestAssets = manifest.records[0].assets;
assert.equal(manifestAssets.length, 2);
assert.ok(manifestAssets.some(({ filename }) => filename === bodyAsset.filename));
assert.ok(manifestAssets.some(({ filename }) => filename === frontmatter.cover.src.split('/').at(-1)));
assert.ok(!manifestAssets.some(({ filename }) => filename === rawCoverAsset.filename));
```

Keep the assertions that the manifest version is `2`, its public keys are only `assets` and `slug`, and no internal identifiers are serialized.

- [ ] **Step 3: Run the focused sync test and verify RED**

```bash
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  node --experimental-strip-types --test \
  --test-name-pattern="sync creates valid Markdown" \
  tests/feishu-sync.test.mjs
```

Expected: the old sync returns a string PNG cover and fails the structured-cover assertions.

- [ ] **Step 4: Separate remote source downloads from public body assets**

Import the processor in `scripts/feishu/sync.mjs`:

```js
import { createResponsiveCover } from './covers.mjs';
```

Replace the current `download()` helper, which prematurely turns every download into a public asset, with a shared raw-source cache and a body-only localization helper:

```js
function normalizeDownloadedSource(value) {
  if (value === null || typeof value !== 'object') {
    throw new Error('Downloaded media must be an object.');
  }
  const bytes = value.bytes instanceof Uint8Array
    ? new Uint8Array(value.bytes)
    : value.bytes instanceof ArrayBuffer
      ? new Uint8Array(value.bytes.slice(0))
      : undefined;
  if (bytes === undefined) {
    throw new Error('Downloaded media bytes must be a Uint8Array or ArrayBuffer.');
  }
  return Object.freeze({ bytes, contentType: value.contentType });
}

async function downloadSource(fileToken, extra) {
  const cacheKey = `${fileToken}\u0000${extra ?? ''}`;
  let pending = downloadCache.get(cacheKey);
  if (pending === undefined) {
    mediaBudget.reserveDownload();
    pending = client.downloadMedia(fileToken, extra).then((value) => {
      const source = normalizeDownloadedSource(value);
      mediaBudget.accountBytes(source.bytes.byteLength);
      return source;
    });
    downloadCache.set(cacheKey, pending);
  }
  return pending;
}

async function downloadBodyMedia(fileToken, extra) {
  return contentAddressedMedia(await downloadSource(fileToken, extra));
}
```

Use `downloadBodyMedia(reference.token)` in the body-media loop. This keeps the existing MIME whitelist and `10 MiB` public-body limit while allowing the cover processor to validate its own raw static-bitmap rules. The raw cache key preserves one network download and one synchronization-budget charge when a token/extra pair is reused.

- [ ] **Step 5: Transform covers and finish the build state**

Replace the existing cover block with:

```js
let cover;
if (record.cover !== null) {
  const source = await downloadSource(
    record.cover.file_token,
    preparedCoverExtra,
  );
  let responsiveCover;
  try {
    responsiveCover = await createResponsiveCover(source);
  } catch (error) {
    if (error instanceof Error) syncFailureSlug.set(error, record.slug);
    throw error;
  }
  for (const asset of responsiveCover.assets) {
    addAsset(assets, asset);
    articleAssets.set(asset.filename, asset);
  }
  cover = responsiveCover.cover;
}
```

Do not add `source` to either public asset map in this block. If the exact token/extra pair is also referenced by the body, the body loop retains one content-addressed original while the raw download remains shared. Keep `articleMediaKeys` unchanged so one cover remains one remote-media item; four variants do not count as four downloads.

At the end of `buildNextState`, construct the manifest in the same sanitized `build` phase and return it with the complete next state:

```js
return {
  articles,
  assets,
  warnings,
  manifest: buildFeishuManifest(articles),
};
```

Add `const syncFailureSlug = new WeakMap();` next to `syncFailurePhase`. In `publicSyncFailureMessage`, read this map only for the `build` phase and append `; slug: ${slug}` when it contains a string. Because `record.slug` has already passed the strict public slug validator, this satisfies the approved phase-plus-slug contract without exposing a record ID, document ID, file token, URL or Sharp message. Change the caller from constructing the manifest in the `stage` phase to `writeStage(next)`. Keep manifest `version: 2` and `TRANSACTION_VERSION = 1`.

- [ ] **Step 6: Add the migration and failure-regression cases**

Add explicit tests with the existing `generatedSnapshot`, `makeRoot`, `publishedRecord` and dependency-injection helpers:

```js
test('changing only cover token and extra with identical bytes does not rewrite output', async (t) => {
  const root = await makeRoot(t);
  await syncFeishu({ root, client: stableClient().client, appToken: APP_TOKEN, tableId: TABLE_ID });
  const before = await generatedSnapshot(root);
  const record = publishedRecord();
  record.fields.封面[0] = { ...record.fields.封面[0], file_token: 'replacement_cover', extra: { nonce: 'private' } };
  const second = stableClient({ records: [record], coverFileToken: 'replacement_cover' });
  const result = await syncFeishu({ root, client: second.client, appToken: APP_TOKEN, tableId: TABLE_ID });

  assert.equal(result.changed, false);
  assert.deepEqual(await generatedSnapshot(root), before);
  assert.doesNotMatch(JSON.stringify(before), /replacement_cover|nonce|private/);
});

test('a cover source reused by the body downloads once and remains public only for the body', async (t) => {
  const root = await makeRoot(t);
  const record = publishedRecord();
  record.fields.封面[0].file_token = 'body_image';
  const { client, calls } = stableClient({ records: [record], coverFileToken: 'body_image' });
  await syncFeishu({ root, client, appToken: APP_TOKEN, tableId: TABLE_ID });

  assert.equal(calls.media.filter(({ fileToken }) => fileToken === 'body_image').length, 1);
  const source = await readFile(join(root, 'src/content/posts/feishu/first-post.md'), 'utf8');
  const { frontmatter, body } = parseMarkdownFile(source);
  const original = contentAddressedMedia({ bytes: COVER_IMAGE_BYTES, contentType: 'image/png' });
  assert.match(body, new RegExp(original.publicPath));
  assert.notEqual(frontmatter.cover.src, original.publicPath);
  assert.ok((await readdir(join(root, 'public/media/feishu'))).includes(original.filename));
});

test('an invalid cover aborts in build and preserves the previous tree byte-for-byte', async (t) => {
  const root = await makeRoot(t);
  await syncFeishu({ root, client: stableClient().client, appToken: APP_TOKEN, tableId: TABLE_ID });
  const before = await generatedSnapshot(root);
  const invalid = stableClient({ coverBytes: new TextEncoder().encode('not an image') });

  let failure;
  try {
    await syncFeishu({ root, client: invalid.client, appToken: APP_TOKEN, tableId: TABLE_ID });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  const publicMessage = publicSyncFailureMessage(failure);
  assert.match(publicMessage, /\[build: 文档与素材生成; slug: first-post\]/);
  assert.doesNotMatch(publicMessage, /rec-one|doxcnExample123|cover_token|not an image/);
  assert.deepEqual(await generatedSnapshot(root), before);
  assert.equal((await readdir(root)).some((name) => name.startsWith('.feishu-sync-')), false);
});
```

Add the legacy-v2 migration test explicitly:

```js
test('sync migrates a legacy v2 raw-cover tree without a version bump', async (t) => {
  const root = await makeRoot(t);
  const oldBytes = new TextEncoder().encode('legacy raw cover');
  const oldAsset = contentAddressedMedia({ bytes: oldBytes, contentType: 'image/png' });
  await rm(join(root, 'src/content/posts/feishu/.gitkeep'));
  await rm(join(root, 'public/media/feishu/.gitkeep'));
  await writeFile(
    join(root, 'src/content/posts/feishu/first-post.md'),
    `---\ntitle: Legacy\ndescription: Legacy\npubDate: 2026-07-12\ncategory: 技术\ntags: []\nfeatured: true\ncover: ${oldAsset.publicPath}\nslug: first-post\n---\n\nLegacy.\n`,
  );
  await writeFile(join(root, 'public/media/feishu', oldAsset.filename), oldAsset.bytes);
  await writeFile(
    join(root, '.feishu-manifest.json'),
    `${JSON.stringify({ version: 2, records: [{ slug: 'first-post', assets: [{ hash: oldAsset.hash, filename: oldAsset.filename }] }] }, null, 2)}\n`,
  );

  await syncFeishu({ root, client: stableClient().client, appToken: APP_TOKEN, tableId: TABLE_ID });
  const generated = parseMarkdownFile(await readFile(
    join(root, 'src/content/posts/feishu/first-post.md'),
    'utf8',
  ));
  const files = await readdir(join(root, 'public/media/feishu'));
  const manifest = JSON.parse(await readFile(join(root, '.feishu-manifest.json'), 'utf8'));

  assert.equal(typeof generated.frontmatter.cover, 'object');
  assert.equal(files.includes(oldAsset.filename), false);
  assert.ok(generated.frontmatter.cover.variants.every(({ src }) => src.endsWith('.webp')));
  assert.equal(manifest.version, 2);
  assert.equal(JSON.stringify(manifest).includes(oldAsset.hash), false);
});
```

Do not assert manifest asset order: it is filename-sorted, not width-sorted.

Modify both existing rename-failure and journal-recovery tests so their second client is created with:

```js
stableClient({
  body: '不能留下的部分版本',
  coverBytes: DIFFERENT_COVER_IMAGE_BYTES,
})
```

Use the existing test-specific body text where it differs. Their before/after `generatedSnapshot` assertions must prove that Markdown, the full variant set and manifest roll back together. This is the existing journaled three-target transaction; do not describe it as a cross-path atomic syscall.

- [ ] **Step 7: Run the sync suite and verify idempotency/rollback stay green**

```bash
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  node --experimental-strip-types --test tests/feishu-sync.test.mjs
```

Expected: all sync tests pass, including identical responsive second sync with byte/inode/mtime equality, token/extra privacy, shared-source download de-duplication, legacy-v2 migration, invalid-cover old-tree preservation, changing-document abort, replacement rollback and interrupted-transaction recovery.

- [ ] **Step 8: Document the cover gates and commit the integration**

Update `docs/FEISHU_SETUP.md` to state: one static raster cover attachment; source `<= 5 MiB`; oriented decoded pixels `<= 24 MP`; generated WebPs total `<= 1 MiB`; animation/multipage/SVG rejected; original source is public only when separately used by the body. State that generated content/media/manifest must come from the sync workflow.

```bash
git diff --check
git add scripts/feishu/sync.mjs tests/feishu-sync.test.mjs docs/FEISHU_SETUP.md
git commit -m "feat: publish optimized Feishu covers"
```

Expected: only the sync code, its synchronization tests and the Feishu setup guide are committed.

### Task 6: Verify, review, merge and deploy the compatibility release

**Files:**

- Verify all modified source and test files.
- Do not modify generated Feishu content in this task.

- [ ] **Step 1: Run fresh full verification in the feature worktree**

```bash
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run verify
git diff --check
git status --short --branch
```

Expected: every test passes, Astro reports zero errors/warnings/hints, 22 production pages build and the feature worktree is clean.

- [ ] **Step 2: Complete two-stage review**

Dispatch a fresh specification reviewer with the complete design requirements and the base/head commit range. Only after it reports `Spec compliant`, dispatch a fresh quality reviewer for Sharp safety, deterministic output, schema invariants, CSS preservation and test quality. Fix every Critical or Important issue with the original implementer and re-run both the relevant test and reviewer.

Expected: both reviews approve; Minor observations are recorded without expanding scope.

- [ ] **Step 3: Merge into `main` and verify the merged result**

From `/Users/xmo/Documents/Blog`:

```bash
git fetch origin
git status --short --branch
git merge --ff-only codex/responsive-cover-pipeline
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm ci
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run verify
```

Expected: fast-forward merge; only `.playwright-cli/` remains untracked; the merged result passes fully while the current string cover still renders.

- [ ] **Step 4: Clean the owned worktree and branch**

```bash
git worktree remove /Users/xmo/Documents/Blog/.worktrees/responsive-cover-pipeline
git worktree prune
git branch -d codex/responsive-cover-pipeline
```

Expected: the worktree and merged feature branch are removed without touching `.playwright-cli/`.

- [ ] **Step 5: Push and wait for the code-only Pages deployment**

```bash
CODE_SHA="$(git rev-parse HEAD)"
git push origin main
CODE_RUN_ID=""
for attempt in {1..24}; do
  CODE_RUN_ID="$(gh run list --workflow deploy.yml --branch main \
    --commit "$CODE_SHA" --limit 1 --json databaseId \
    --jq '.[0].databaseId // empty')"
  [[ -n "$CODE_RUN_ID" ]] && break
  sleep 5
done
test -n "$CODE_RUN_ID"
gh run watch "$CODE_RUN_ID" --exit-status --interval 5
gh run view "$CODE_RUN_ID" --json conclusion,headSha,url \
  --jq '{conclusion,headSha,url}'
```

Use the run whose `headSha` equals local `main`; do not copy its numeric ID into repository files or the final user response.

Expected: verification/build and Pages deployment succeed. The live site still displays the legacy PNG through the compatibility branch of `CoverImage.astro`. The featured image is eager/high-priority during this intentionally short compatibility window, so dispatch Task 7 immediately after this check rather than leaving the 2 MiB source in that state.

### Task 7: Run the real Feishu migration and verify the optimized site

**Files:**

- Generated remotely: `src/content/posts/feishu/published-from-feishu.md`
- Generated remotely: `public/media/feishu/*.webp`
- Generated remotely: `.feishu-manifest.json`

- [ ] **Step 1: Ensure there is no unresolved Feishu sync run, then dispatch**

```bash
gh run list --workflow sync-feishu.yml --limit 10 \
  --json databaseId,status,conclusion,event,headSha,createdAt,url
ACTIVE_SYNC_RUN_ID="$(gh run list --workflow sync-feishu.yml --limit 10 \
  --json databaseId,status \
  --jq '.[] | select(.status != "completed") | .databaseId' | head -n 1)"
if [[ -n "$ACTIVE_SYNC_RUN_ID" ]]; then
  gh run watch "$ACTIVE_SYNC_RUN_ID" --exit-status --interval 5
fi
PREVIOUS_SYNC_RUN_ID="$(gh run list --workflow sync-feishu.yml \
  --event workflow_dispatch --limit 1 --json databaseId \
  --jq '.[0].databaseId // empty')"
gh workflow run sync-feishu.yml --ref main
```

If a scheduled or manual run is already queued/in progress on the same code, watch it first. Dispatch only when needed; the workflow concurrency is serialized and the sync is idempotent.

- [ ] **Step 2: Watch the migration and all resulting deployment paths**

```bash
SYNC_RUN_ID=""
for attempt in {1..24}; do
  CANDIDATE="$(gh run list --workflow sync-feishu.yml \
    --event workflow_dispatch --limit 1 --json databaseId \
    --jq '.[0].databaseId // empty')"
  if [[ -n "$CANDIDATE" && "$CANDIDATE" != "$PREVIOUS_SYNC_RUN_ID" ]]; then
    SYNC_RUN_ID="$CANDIDATE"
    break
  fi
  sleep 5
done
test -n "$SYNC_RUN_ID"
gh run watch "$SYNC_RUN_ID" --interval 5 || true
SYNC_JOB_CONCLUSION="$(gh run view "$SYNC_RUN_ID" --json jobs \
  --jq '.jobs[] | select(.name == "Sync published articles") | .conclusion')"
[[ "$SYNC_JOB_CONCLUSION" == success ]]
gh run view "$SYNC_RUN_ID" --json conclusion,url,jobs \
  --jq '{conclusion,url,jobs:[.jobs[]|{name,conclusion}]}'
```

Expected: the `Sync published articles` job succeeds and commits generated content. The workflow's deploy job or the push-triggered normal deploy may be cancelled by the shared Pages concurrency group; a cancellation is acceptable only after Step 3 captures the generated commit and one deployment for that exact commit/artifact succeeds. Any sync/build/test failure is not acceptable.

- [ ] **Step 3: Fast-forward local `main` and validate generated state**

```bash
git pull --ff-only origin main
GENERATED_SHA="$(git rev-parse HEAD)"
[[ "$(git log -1 --format=%s)" == "content: sync Feishu posts" ]]
PUSH_DEPLOY_RUN_ID=""
for attempt in {1..24}; do
  PUSH_DEPLOY_RUN_ID="$(gh run list --workflow deploy.yml --branch main \
    --commit "$GENERATED_SHA" --limit 1 --json databaseId \
    --jq '.[0].databaseId // empty')"
  [[ -n "$PUSH_DEPLOY_RUN_ID" ]] && break
  sleep 5
done
if [[ -n "$PUSH_DEPLOY_RUN_ID" ]]; then
  gh run watch "$PUSH_DEPLOY_RUN_ID" --interval 5 || true
fi
SYNC_DEPLOY_CONCLUSION="$(gh run view "$SYNC_RUN_ID" --json jobs \
  --jq '.jobs[] | select(.name == "Deploy synchronized site") | .conclusion')"
PUSH_DEPLOY_CONCLUSION="$(if [[ -n "$PUSH_DEPLOY_RUN_ID" ]]; then gh run view "$PUSH_DEPLOY_RUN_ID" --json conclusion --jq '.conclusion'; fi)"
[[ "$SYNC_DEPLOY_CONCLUSION" == success || "$PUSH_DEPLOY_CONCLUSION" == success ]]
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  node --input-type=module -e '
    import { readFile, readdir, stat } from "node:fs/promises";
    import { basename } from "node:path";
    import { parse } from "yaml";
    const legacyCover = "118f522a0876e4faa18683a021e85237d173203d69a4053358909a18d5c18570.png";
    const source = await readFile("src/content/posts/feishu/published-from-feishu.md", "utf8");
    const match = /^---\n([\s\S]*?)\n---/.exec(source);
    if (!match) throw new Error("generated article frontmatter is missing");
    const { cover } = parse(match[1]);
    if (typeof cover !== "object" || cover.variants.length !== 4) throw new Error("responsive cover metadata is missing");
    if (cover.variants.at(-1).src !== cover.src || cover.variants.at(-1).width !== cover.width) throw new Error("largest cover variant is inconsistent");
    if (new Set(cover.variants.map(({ src }) => src)).size !== 4) throw new Error("cover paths are not unique");
    const files = (await readdir("public/media/feishu")).filter((name) => !name.startsWith("."));
    if (files.includes(legacyCover)) throw new Error("legacy cover PNG remains public");
    const webps = cover.variants.map(({ src }) => basename(src));
    if (!webps.every((name) => name.endsWith(".webp") && files.includes(name))) throw new Error("a cover variant is missing");
    const total = (await Promise.all(webps.map(async (name) => (await stat(`public/media/feishu/${name}`)).size))).reduce((sum, size) => sum + size, 0);
    if (total >= 128 * 1024) throw new Error("current cover variants exceed the acceptance budget");
    const manifest = JSON.parse(await readFile(".feishu-manifest.json", "utf8"));
    if (manifest.version !== 2 || JSON.stringify(manifest).includes(legacyCover)) throw new Error("manifest migration is invalid");
    console.log(JSON.stringify({ widths: cover.variants.map(({ width }) => width), fileCount: webps.length, totalBytes: total }));
  '
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run verify
! rg -n "118f522a0876e4faa18683a021e85237d173203d69a4053358909a18d5c18570\.png" dist
```

Expected: widths are `320,640,960,1440`, the four cover WebPs total less than `128 KiB`, the specific legacy cover PNG is absent from public media, manifest and built HTML, all tests pass, Astro has zero diagnostics and 22 pages build. Other PNG files remain legal when independently referenced by article bodies.

- [ ] **Step 4: Verify live responsive selection at 320, 768 and 1440**

Use a fresh browser context for every page/viewport pair, set `deviceScaleFactor: 2` before navigation, disable cache, and inspect `https://xmo2004.github.io/` only after `await image.decode()`. Reusing one context can retain a larger already-downloaded candidate and make `currentSrc` refuse to downshift.

```js
const image = document.querySelector('.post-card__cover img');
({
  src: image.getAttribute('src'),
  srcset: image.getAttribute('srcset'),
  sizes: image.getAttribute('sizes'),
  currentSrc: image.currentSrc,
  width: image.getAttribute('width'),
  height: image.getAttribute('height'),
  complete: image.complete,
  naturalWidth: image.naturalWidth,
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
});
```

Expected:

- 320px at DPR 2 selects `640w` or smaller and has no overflow.
- 768px renders the same crop without overflow, layout shift or broken media.
- 1440px at DPR 2 selects `960w` or smaller and has no overflow.
- `srcset` exposes all four widths, intrinsic dimensions are `1440 × 810`, loading is eager and fetch priority is high.

Then inspect `https://xmo2004.github.io/posts/` in fresh DPR-2 contexts. At 320px the row cover is hidden and `currentSrc` may legitimately be empty; at 768px the visible `5.25rem × 5.75rem` row and at 1440px the visible `7rem × 6.25rem` row must select `320w`, use lazy loading and preserve the existing crop. Scroll the lazy row into view before awaiting decode.

- [ ] **Step 5: Finish browser and repository acceptance**

At all three viewports confirm visible images are complete with `naturalWidth > 0`, wrappers retain `object-fit: cover`, and there is no broken image, clipping, layout shift, console error or horizontal overflow. Install the layout-shift observer before navigation rather than after load. Reset the viewport override, close temporary contexts/tabs, leave the public home page open, then run:

```bash
git status --short --branch
git rev-list --left-right --count origin/main...main
```

Expected: `main` equals `origin/main`; the only unrelated local path is `.playwright-cli/`; the live home page is visible at the normal viewport.
