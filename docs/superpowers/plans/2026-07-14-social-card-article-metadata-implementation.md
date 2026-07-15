# Article Social Cards and Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate one deterministic `1200 × 630` editorial PNG for every article at static-build time, publish truthful article Open Graph/Twitter/BlogPosting metadata that all reference that image, deploy it through the existing GitHub Pages workflows, and verify the live result.

**Architecture:** One shared `src/lib/social-card.ts` module owns normalized visual inputs, the content-hashed public path, the serializable render model, the pinned local font, the Satori node tree and Sharp encoding. The article route and the static PNG endpoint both derive input through the same helper; only the endpoint renders bytes. `BaseLayout` remains generic and conditional, while `PostLayout` supplies article-only metadata and structured data. Generated PNG files exist only in `dist/` and therefore remain outside the Feishu generated tree, manifest and Git history.

**Tech Stack:** Node.js 24, Astro 7.0.7 static endpoints, Satori 0.26.0, Sharp 0.35.3, Fontsource ZCOOL XiaoWei 4.5.12, TypeScript 6, Node test runner, GitHub Actions, GitHub Pages and the in-app browser.

---

## Scope and release invariants

- Generate cards for article pages only. Homepage, archive, category, column, tag, about and 404 pages retain text-only `twitter:card=summary` metadata.
- Use a fixed opaque `1200 × 630` editorial card independent of the article cover and visitor theme.
- Use only true article fields: title, publication date, category, optional column, tags, optional update date and reading minutes.
- Never invent a Twitter/X handle, author URL, `sameAs`, organization logo, `article:author` URL or update date.
- Preserve the existing HTML `<title>` suffix. Use the raw page title for `og:title` and `twitter:title` on every page.
- Resolve the complete local WOFF from the exact Fontsource dependency. A build after dependency installation must not fetch fonts, emoji, images or other remote assets.
- Every visual input, template/encoding constant, font digest and pinned renderer version participates in the 16-hex content digest. Description, tags and `updatedDate` do not participate because they are not drawn.
- Fail the build for missing font bytes, unexpected font digest, unsupported glyphs, unsafe/empty normalized fields, layout overflow, invalid PNG properties or a card over `350 KiB`.
- Failure messages may include the public slug and missing Unicode code points, but never the article title, body, Feishu record/document identifiers, URLs or credentials.
- Do not modify `src/content/posts/feishu/`, `public/media/feishu/`, `.feishu-manifest.json`, either deployment workflow or Feishu schema/sync code.
- Do not commit `dist/social/posts/*.png`; both workflows already upload the complete `dist/` directory.
- Preserve the unrelated untracked `.playwright-cli/` directory in the main worktree.

## Fixed visual recipe

The implementation must encode these values in one frozen `SOCIAL_CARD_RECIPE` object and hash the whole object:

```ts
export const SOCIAL_CARD_RECIPE = Object.freeze({
  version: 'article-social-card-v1',
  width: 1200,
  height: 630,
  maxBytes: 350 * 1024,
  leftWidth: 852,
  rightWidth: 348,
  safeInset: 80,
  titleSizes: [76, 64, 54],
  titleBreakpoints: [18, 32],
  titleLineHeight: 1.08,
  titleLineClamp: 3,
  titleWordBreak: 'break-all',
  fontFamily: 'ZCOOL XiaoWei',
  fontWeight: 400,
  fontStyle: 'normal',
  language: 'zh-CN',
  dateSeparator: '.',
  hollowMark: 'XMO',
  footerLabel: 'LONG-TERM NOTES',
  colors: {
    paper: '#f4efe4',
    panel: '#fbf8f1',
    ink: '#1d211d',
    muted: '#646960',
    terracotta: '#9f422e',
    moss: '#566444',
  },
  layout: {
    leftPadding: '80px',
    markFontSize: 23,
    markLetterSpacing: '0.18em',
    titleFramePaddingTop: 24,
    titleFramePaddingBottom: 20,
    titleLetterSpacing: '-0.02em',
    categoryFontSize: 24,
    categoryLetterSpacing: '0.08em',
    categoryMaxWidth: 180,
    dividerWidth: 24,
    dividerHeight: 1,
    dividerOpacity: 0.35,
    dividerMargin: '0 16px',
    columnFontSize: 22,
    columnMaxWidth: 270,
    dateFontSize: 21,
    dateLetterSpacing: '0.08em',
    dateWidth: 142,
    metadataRowHeight: 32,
    metadataWhiteSpace: 'nowrap',
    metadataTextOverflow: 'ellipsis',
    rightPadding: '54px 50px 48px',
    rightBorderWidth: 1,
    rightBorderAlpha: '33',
    textureTops: [130, 250, 370, 490],
    textureLeft: -36,
    textureWidth: 420,
    textureHeight: 1,
    textureOpacity: 0.06,
    textureTransform: 'rotate(-45deg)',
    yearFontSize: 30,
    yearLetterSpacing: '0.12em',
    hollowFontSize: 86,
    hollowLineHeight: 0.88,
    hollowStrokeWidth: 2,
    hollowMarginTop: -8,
    footerFontSize: 14,
    footerLetterSpacing: '0.16em',
  },
  satori: {
    embedFont: true,
    pointScaleFactor: 1,
  },
  raster: {
    density: 72,
    failOn: 'warning',
    limitInputPixels: 1200 * 630,
    flattenBackground: '#f4efe4',
    removeAlpha: true,
    colourspace: 'srgb',
  },
  png: {
    compressionLevel: 9,
    adaptiveFiltering: true,
    palette: true,
    quality: 100,
    effort: 10,
    colours: 256,
    dither: 0,
  },
} as const);
```

Changing any property requires incrementing `version`, even though the full object is also hashed. The explicit version makes deliberate visual revisions visible in review.

## File responsibility map

Create:

- `src/assets/fonts/ZCOOL-XiaoWei-OFL.txt` — complete unmodified SIL OFL 1.1 license for the pinned font.
- `src/lib/social-card.ts` — input normalization, hash/path, render model, font gate, Satori tree and Sharp encoder.
- `src/pages/social/posts/[asset].png.ts` — static binary endpoint producing one card for every article.
- `tests/social-card.test.mjs` — pure path, normalization, renderer, determinism, font coverage, network and size tests.

Modify:

- `package.json`, `package-lock.json` — exact production dependencies `satori@0.26.0` and `@fontsource/zcool-xiaowei@4.5.12`.
- `tests/toolchain.test.mjs` — dependency, license and font-byte integrity contract.
- `tests/build-output.test.mjs` — clean-build image inventory, HTML head and BlogPosting contract.
- `tests/ui-source.test.mjs` — conditional layout wiring and truthfulness source contract.
- `src/layouts/BaseLayout.astro` — conditional Open Graph/Twitter image and `article:*` output.
- `src/layouts/PostLayout.astro` — article metadata plus expanded truthful `BlogPosting`.
- `src/pages/posts/[...id].astro` — compute article social-image metadata through the shared helper.
- `tests/workflows.test.mjs` — maintenance-documentation contract only; workflow files remain unchanged.
- `docs/FEISHU_SETUP.md` — explain the build-only images, limits, failure and verification path.

---

### Task 1: Create an isolated worktree and verify the baseline

**Files:**

- Read: `docs/superpowers/specs/2026-07-14-social-card-article-metadata-design.md`
- Read: `package.json`
- Read: `src/layouts/BaseLayout.astro`
- Read: `src/layouts/PostLayout.astro`
- Read: `src/pages/posts/[...id].astro`
- Read: `tests/build-output.test.mjs`

- [ ] **Step 1: Confirm the main worktree state without touching user files**

Run in `/Users/xmo/Documents/Blog`:

```bash
git fetch origin
git status --short --branch
git rev-list --left-right --count origin/main...main
git check-ignore -q .worktrees
```

Expected before implementation: `main` contains the approved design and implementation-plan commits, there are no tracked changes, `.worktrees` is ignored, and `.playwright-cli/` remains the only unrelated untracked path. If remote `main` advanced, inspect and integrate it before creating the feature worktree; do not reset either history.

- [ ] **Step 2: Create the isolated branch and worktree**

```bash
git worktree add .worktrees/article-social-cards \
  -b codex/article-social-cards main
```

Expected: `/Users/xmo/Documents/Blog/.worktrees/article-social-cards` exists on `codex/article-social-cards` and the main worktree stays on `main`.

- [ ] **Step 3: Install the locked baseline and run full verification**

Run in the new worktree:

```bash
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm ci
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run verify
```

Expected baseline: 260 tests pass, Astro reports zero errors/warnings/hints, and the static build emits 22 HTML pages. Stop and diagnose any baseline failure before editing files.

---

### Task 2: Pin the renderer, local font and license with TDD

**Files:**

- Modify: `tests/toolchain.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/assets/fonts/ZCOOL-XiaoWei-OFL.txt`

- [ ] **Step 1: Add a failing dependency, font and license integrity test**

Add these imports to `tests/toolchain.test.mjs`:

```js
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
```

Add the test below. It deliberately resolves the full WOFF through the package rather than copying font bytes into `src/`:

```js
test('social-card renderer and local font are exact reproducible dependencies', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );

  assert.equal(packageJson.dependencies.satori, '0.26.0');
  assert.equal(
    packageJson.dependencies['@fontsource/zcool-xiaowei'],
    '4.5.12',
  );
  assert.equal(packageJson.dependencies.sharp, '0.35.3');

  const require = createRequire(import.meta.url);
  const fontPath = require.resolve(
    '@fontsource/zcool-xiaowei/files/zcool-xiaowei-all-400-normal.woff',
  );
  const fontBytes = await readFile(fontPath);
  const licenseBytes = await readFile(
    new URL(
      '../src/assets/fonts/ZCOOL-XiaoWei-OFL.txt',
      import.meta.url,
    ),
  );

  assert.ok(fontBytes.byteLength > 2 * 1024 * 1024);
  assert.equal(fontBytes.subarray(0, 4).toString('ascii'), 'wOFF');
  assert.equal(
    createHash('sha256').update(fontBytes).digest('hex'),
    '0f8ebd46b6f1272b92f63a68a35339d44fef89d25691c2e29a4dfdd13ac7c1e2',
  );
  assert.match(
    licenseBytes.toString('utf8'),
    /SIL OPEN FONT LICENSE Version 1\.1 - 26 February 2007/,
  );
  assert.equal(
    createHash('sha256').update(licenseBytes).digest('hex'),
    'a094514ca57cf8f9c5e8d8d1adab5d8cd3a377297ff016f9df2c05b3ecd77f0a',
  );
});
```

- [ ] **Step 2: Prove the test is red**

```bash
node --experimental-strip-types --test tests/toolchain.test.mjs
```

Expected: failure because the two direct dependencies and the license file do not exist.

- [ ] **Step 3: Install exact production dependencies**

```bash
npm install --save-exact \
  satori@0.26.0 \
  @fontsource/zcool-xiaowei@4.5.12
npm ls satori @fontsource/zcool-xiaowei sharp --depth=0
```

Expected: exact top-level versions `0.26.0`, `4.5.12` and `0.35.3`; `package.json` contains no caret or tilde for them.

- [ ] **Step 4: Add the complete license and verify its source bytes**

Read the complete unmodified file from:

```text
https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolxiaowei/OFL.txt
```

Create `src/assets/fonts/ZCOOL-XiaoWei-OFL.txt` with those exact bytes using `apply_patch`. Do not add a heading, source note, BOM or trailing commentary. Verify:

```bash
shasum -a 256 src/assets/fonts/ZCOOL-XiaoWei-OFL.txt
```

Expected:

```text
a094514ca57cf8f9c5e8d8d1adab5d8cd3a377297ff016f9df2c05b3ecd77f0a
```

- [ ] **Step 5: Prove the dependency gate is green and commit**

```bash
node --experimental-strip-types --test tests/toolchain.test.mjs
git diff --check
git add \
  package.json \
  package-lock.json \
  src/assets/fonts/ZCOOL-XiaoWei-OFL.txt \
  tests/toolchain.test.mjs
git commit -m "build: pin social card renderer and font"
```

Expected: the focused test passes and the commit contains only dependency, font-license and toolchain-test files.

---

### Task 3: Implement normalized inputs and content-hashed paths with TDD

**Files:**

- Create: `tests/social-card.test.mjs`
- Create: `src/lib/social-card.ts`

The module's externally used types and functions are fixed as follows:

```ts
export interface SocialCardInput {
  slug: string;
  title: string;
  pubDate: Date;
  category: string;
  column?: string;
  siteMark: string;
}

export interface SocialCardModel {
  readonly slug: string;
  readonly siteMark: string;
  readonly title: string;
  readonly pubDate: string;
  readonly displayDate: string;
  readonly year: string;
  readonly category: string;
  readonly column?: string;
  readonly titleFontSize: 76 | 64 | 54;
}

export interface SocialImageMetadata {
  readonly path: string;
  readonly width: 1200;
  readonly height: 630;
  readonly mimeType: 'image/png';
  readonly alt: string;
}

export interface PreparedSocialCard {
  readonly metadata: SocialImageMetadata;
  readonly model: SocialCardModel;
}

export interface ArticleOpenGraphMetadata {
  readonly publishedTime: string;
  readonly modifiedTime?: string;
  readonly section: string;
  readonly tags: readonly string[];
}
```

Only `getSocialImageMetadata(getSocialCardInput(post))` is used by the article route/layout path. The endpoint uses `prepareSocialCard(getSocialCardInput(post))` and `renderSocialCard(model)`.

- [ ] **Step 1: Write the path and normalization tests before the module exists**

Start `tests/social-card.test.mjs` with:

```js
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import packageJson from '../package.json' with { type: 'json' };

async function loadSocialCardModule() {
  const module = await import('../src/lib/social-card.ts').catch(() => ({}));

  for (const name of [
    'SOCIAL_CARD_RECIPE',
    'getSocialCardInput',
    'getSocialImageMetadata',
    'prepareSocialCard',
  ]) {
    assert.equal(typeof module[name], name === 'SOCIAL_CARD_RECIPE' ? 'object' : 'function');
  }

  return module;
}

const baseInput = Object.freeze({
  slug: 'welcome',
  title: '从飞书发布的第一篇文章',
  pubDate: new Date('2026-07-12T00:00:00.000Z'),
  category: '技术',
  column: '博客搭建手记',
  siteMark: 'XMO / NOTES',
});

function changed(field, value) {
  return { ...baseInput, [field]: value };
}
```

Add these exact behavioral tests:

```js
test('social image metadata is deterministic, safe and descriptive', async () => {
  const { getSocialImageMetadata } = await loadSocialCardModule();
  const first = await getSocialImageMetadata(baseInput);
  const second = await getSocialImageMetadata(baseInput);

  assert.deepEqual(first, second);
  assert.match(
    first.path,
    /^\/social\/posts\/welcome-[a-f0-9]{16}\.png$/u,
  );
  assert.deepEqual(first, {
    path: first.path,
    width: 1200,
    height: 630,
    mimeType: 'image/png',
    alt: '“从飞书发布的第一篇文章”文章分享卡片，来自 XMO / NOTES',
  });
});

test('every drawn field and the safe slug prefix change the public path', async () => {
  const { getSocialImageMetadata } = await loadSocialCardModule();
  const original = await getSocialImageMetadata(baseInput);
  const variants = [
    changed('slug', 'welcome-renamed'),
    changed('title', '另一篇文章'),
    changed('pubDate', new Date('2026-07-13T00:00:00.000Z')),
    changed('category', '随笔'),
    changed('column', '另一专栏'),
    { ...baseInput, column: undefined },
    changed('siteMark', 'XMO / JOURNAL'),
  ];

  for (const variant of variants) {
    const metadata = await getSocialImageMetadata(variant);
    assert.notEqual(metadata.path, original.path);
  }
});

test('visual text normalization shares a digest while alt keeps the real title', async () => {
  const { getSocialImageMetadata, prepareSocialCard } =
    await loadSocialCardModule();
  const first = await prepareSocialCard({
    ...baseInput,
    title: '从飞书 发布的 第一篇 文章',
  });
  const visuallyEquivalent = {
    ...baseInput,
    title: '从飞书\u0000发布的\n第一篇\t文章',
  };
  const second = await prepareSocialCard(visuallyEquivalent);
  const metadata = await getSocialImageMetadata(visuallyEquivalent);

  assert.equal(second.model.title, '从飞书 发布的 第一篇 文章');
  assert.equal(first.metadata.path, second.metadata.path);
  assert.equal(
    metadata.alt,
    '“从飞书\u0000发布的\n第一篇\t文章”文章分享卡片，来自 XMO / NOTES',
  );

  const composed = await prepareSocialCard({
    ...baseInput,
    title: 'Café 发布记录',
  });
  const decomposed = await prepareSocialCard({
    ...baseInput,
    title: 'Cafe\u0301 发布记录',
  });
  assert.equal(decomposed.model.title, 'Café 发布记录');
  assert.equal(composed.metadata.path, decomposed.metadata.path);
});

test('nonvisual extra properties cannot affect the card digest', async () => {
  const { getSocialImageMetadata } = await loadSocialCardModule();
  const first = await getSocialImageMetadata(baseInput);
  const second = await getSocialImageMetadata({
    ...baseInput,
    description: '不绘制的摘要',
    tags: ['不绘制的标签'],
    updatedDate: new Date('2026-07-14T00:00:00.000Z'),
  });

  assert.equal(first.path, second.path);
});

test('invalid public or visual fields fail without leaking title content', async () => {
  const { prepareSocialCard } = await loadSocialCardModule();
  const secretTitle = '不应出现在错误中的文章标题';
  const cases = [
    [{ ...baseInput, slug: '../escape', title: secretTitle }, /safe slug/u],
    [{ ...baseInput, title: '\u0000\n\t' }, /title/u],
    [{ ...baseInput, category: '\u0000' }, /category/u],
    [{ ...baseInput, siteMark: '\n' }, /site mark/u],
    [{ ...baseInput, pubDate: new Date(Number.NaN) }, /publication date/u],
  ];

  for (const [input, pattern] of cases) {
    await assert.rejects(
      prepareSocialCard(input),
      (error) => {
        assert.match(error.message, pattern);
        if (input.slug === baseInput.slug) {
          assert.match(error.message, /welcome/u);
        }
        assert.doesNotMatch(error.message, new RegExp(secretTitle, 'u'));
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  }
});
```

The second test intentionally expects a slug change to alter the full path through its safe filename prefix even though slug is not a drawn/hash field.

- [ ] **Step 2: Prove the new suite is red**

```bash
node --experimental-strip-types --test tests/social-card.test.mjs
```

Expected: failure because `src/lib/social-card.ts` does not exist.

- [ ] **Step 3: Implement package/font constants and cached validation**

Create `src/lib/social-card.ts` with these imports and constants:

```ts
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import packageJson from '../../package.json' with { type: 'json' };
import satori from 'satori';
import sharp from 'sharp';

import { SITE } from '../config/site.ts';
import { getPostSlug } from './posts.ts';
```

Immediately add the exact recipe from this plan's “Fixed visual recipe” section. Derive output dimensions from that recipe so the renderer cannot drift from the hashed values, then add the remaining constants:

```ts
export const SOCIAL_CARD_WIDTH = SOCIAL_CARD_RECIPE.width;
export const SOCIAL_CARD_HEIGHT = SOCIAL_CARD_RECIPE.height;
export const MAX_SOCIAL_CARD_BYTES = SOCIAL_CARD_RECIPE.maxBytes;

const FONT_FAMILY = SOCIAL_CARD_RECIPE.fontFamily;
const EXPECTED_FONT_SHA256 =
  '0f8ebd46b6f1272b92f63a68a35339d44fef89d25691c2e29a4dfdd13ac7c1e2';
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const require = createRequire(import.meta.url);
const FONT_PATH = require.resolve(
  '@fontsource/zcool-xiaowei/files/zcool-xiaowei-all-400-normal.woff',
);
```

Then define the types from this task. Add a structural post type and the single shared adapter:

```ts
interface SocialCardPostEntry {
  id: string;
  data: {
    slug?: string;
    title: string;
    pubDate: Date;
    category: string;
    column?: string;
  };
}

export function getSocialCardInput(
  post: SocialCardPostEntry,
): SocialCardInput {
  return {
    slug: getPostSlug(post),
    title: post.data.title,
    pubDate: post.data.pubDate,
    category: post.data.category,
    column: post.data.column,
    siteMark: SITE.mark,
  };
}
```

Cache the exact same font byte buffer and font-array identity for all cards:

```ts
interface LoadedFont {
  bytes: Buffer;
  sha256: string;
  fonts: Array<{
    name: string;
    data: ArrayBuffer;
    weight: typeof SOCIAL_CARD_RECIPE.fontWeight;
    style: typeof SOCIAL_CARD_RECIPE.fontStyle;
    lang: typeof SOCIAL_CARD_RECIPE.language;
  }>;
}

let fontPromise: Promise<LoadedFont> | undefined;

async function loadFont(): Promise<LoadedFont> {
  fontPromise ??= readFile(FONT_PATH).then((bytes) => {
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    if (bytes.subarray(0, 4).toString('ascii') !== 'wOFF') {
      throw new Error('Social card font validation failed: expected WOFF.');
    }
    if (sha256 !== EXPECTED_FONT_SHA256) {
      throw new Error('Social card font validation failed: SHA-256 mismatch.');
    }

    return {
      bytes,
      sha256,
      fonts: [{
        name: FONT_FAMILY,
        data: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
        weight: SOCIAL_CARD_RECIPE.fontWeight,
        style: SOCIAL_CARD_RECIPE.fontStyle,
        lang: SOCIAL_CARD_RECIPE.language,
      }],
    };
  });

  try {
    return await fontPromise;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Social card font validation failed:')
    ) {
      throw error;
    }

    throw new Error(
      'Social card font validation failed: missing or unreadable WOFF.',
    );
  }
}
```

- [ ] **Step 4: Implement normalization, model selection and the exact digest preimage**

Use NFC before replacing control/format characters and whitespace:

```ts
function normalizeVisualText(value: string, field: string): string {
  const normalized = value
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  if (normalized.length === 0) {
    throw new Error(`Social card ${field} must not be empty.`);
  }

  return normalized;
}

function normalizePublicationDate(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error('Social card publication date must be valid.');
  }

  return value.toISOString().slice(0, 10);
}

function countGraphemes(value: string): number {
  return [...new Intl.Segmenter(SOCIAL_CARD_RECIPE.language, {
    granularity: 'grapheme',
  }).segment(value)].length;
}

function chooseTitleFontSize(title: string): 76 | 64 | 54 {
  const count = countGraphemes(title);

  if (count <= SOCIAL_CARD_RECIPE.titleBreakpoints[0]) return 76;
  if (count <= SOCIAL_CARD_RECIPE.titleBreakpoints[1]) return 64;
  return 54;
}

function safePreparationFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const safeMessage = /^(?:Social card (?:title|site mark|category|column) must not be empty|Social card publication date must be valid|Social card font validation failed(?:: (?:expected WOFF|SHA-256 mismatch|missing or unreadable WOFF))?)\.?$/u.exec(
    message,
  );

  return safeMessage?.[0].replace(/\.$/u, '') ??
    'unexpected preparation failure';
}
```

`prepareSocialCard` must validate `slug` before reading/hash work, build a model from only normalized visual fields, and use this exact ordered preimage:

```ts
const preimage = JSON.stringify({
  template: SOCIAL_CARD_RECIPE,
  engines: {
    satori: packageJson.dependencies.satori,
    sharp: packageJson.dependencies.sharp,
    fontsource: packageJson.dependencies['@fontsource/zcool-xiaowei'],
  },
  fontSha256: font.sha256,
  visual: {
    siteMark: model.siteMark,
    title: model.title,
    pubDate: model.pubDate,
    category: model.category,
    column: model.column ?? null,
    titleFontSize: model.titleFontSize,
  },
});
const digest = createHash('sha256')
  .update(preimage)
  .digest('hex')
  .slice(0, 16);
```

Build the final return value without passing extra input properties into the hash:

```ts
export async function prepareSocialCard(
  input: SocialCardInput,
): Promise<PreparedSocialCard> {
  if (!SAFE_SLUG.test(input.slug)) {
    throw new Error('Social card requires a safe slug.');
  }

  try {
  const pubDate = normalizePublicationDate(input.pubDate);
  const title = normalizeVisualText(input.title, 'title');
  const model: SocialCardModel = {
    slug: input.slug,
    siteMark: normalizeVisualText(input.siteMark, 'site mark'),
    title,
    pubDate,
    displayDate: pubDate.replaceAll(
      '-',
      SOCIAL_CARD_RECIPE.dateSeparator,
    ),
    year: pubDate.slice(0, 4),
    category: normalizeVisualText(input.category, 'category'),
    ...(input.column === undefined
      ? {}
      : { column: normalizeVisualText(input.column, 'column') }),
    titleFontSize: chooseTitleFontSize(title),
  };
  const font = await loadFont();
  const preimage = JSON.stringify({
    template: SOCIAL_CARD_RECIPE,
    engines: {
      satori: packageJson.dependencies.satori,
      sharp: packageJson.dependencies.sharp,
      fontsource: packageJson.dependencies['@fontsource/zcool-xiaowei'],
    },
    fontSha256: font.sha256,
    visual: {
      siteMark: model.siteMark,
      title: model.title,
      pubDate: model.pubDate,
      category: model.category,
      column: model.column ?? null,
      titleFontSize: model.titleFontSize,
    },
  });
  const digest = createHash('sha256')
    .update(preimage)
    .digest('hex')
    .slice(0, 16);

  return {
    metadata: {
      path: `/social/posts/${model.slug}-${digest}.png`,
      width: SOCIAL_CARD_WIDTH,
      height: SOCIAL_CARD_HEIGHT,
      mimeType: 'image/png',
      alt: `“${input.title}”文章分享卡片，来自 ${input.siteMark}`,
    },
    model,
  };
  } catch (error) {
    throw new Error(
      `Social card "${input.slug}" preparation failed: ` +
        `${safePreparationFailure(error)}.`,
    );
  }
}

export async function getSocialImageMetadata(
  input: SocialCardInput,
): Promise<SocialImageMetadata> {
  return (await prepareSocialCard(input)).metadata;
}
```

- [ ] **Step 5: Add an independent digest regression test**

In `tests/social-card.test.mjs`, import `readFile`, `createRequire`, and add a test that recalculates the digest without calling production digest code:

```js
test('digest preimage pins recipe, engines and the exact font', async () => {
  const { SOCIAL_CARD_RECIPE, prepareSocialCard } =
    await loadSocialCardModule();
  const require = createRequire(import.meta.url);
  const fontBytes = await readFile(require.resolve(
    '@fontsource/zcool-xiaowei/files/zcool-xiaowei-all-400-normal.woff',
  ));
  const prepared = await prepareSocialCard(baseInput);
  const preimage = JSON.stringify({
    template: SOCIAL_CARD_RECIPE,
    engines: {
      satori: packageJson.dependencies.satori,
      sharp: packageJson.dependencies.sharp,
      fontsource: packageJson.dependencies['@fontsource/zcool-xiaowei'],
    },
    fontSha256: createHash('sha256').update(fontBytes).digest('hex'),
    visual: {
      siteMark: prepared.model.siteMark,
      title: prepared.model.title,
      pubDate: prepared.model.pubDate,
      category: prepared.model.category,
      column: prepared.model.column ?? null,
      titleFontSize: prepared.model.titleFontSize,
    },
  });
  const expectedDigest = createHash('sha256')
    .update(preimage)
    .digest('hex')
    .slice(0, 16);

  assert.equal(
    prepared.metadata.path,
    `/social/posts/welcome-${expectedDigest}.png`,
  );

  for (const [engine, replacement] of [
    ['satori', '0.26.1'],
    ['sharp', '0.35.4'],
    ['fontsource', '4.5.13'],
  ]) {
    const changedPreimage = JSON.stringify({
      ...JSON.parse(preimage),
      engines: {
        ...JSON.parse(preimage).engines,
        [engine]: replacement,
      },
    });
    assert.notEqual(
      createHash('sha256').update(changedPreimage).digest('hex').slice(0, 16),
      expectedDigest,
    );
  }

  const parsedPreimage = JSON.parse(preimage);
  for (const changedPreimage of [
    JSON.stringify({
      ...parsedPreimage,
      template: {
        ...parsedPreimage.template,
        version: 'article-social-card-v2',
      },
    }),
    JSON.stringify({
      ...parsedPreimage,
      visual: {
        ...parsedPreimage.visual,
        titleFontSize: 64,
      },
    }),
    JSON.stringify({
      ...parsedPreimage,
      fontSha256: 'f'.repeat(64),
    }),
  ]) {
    assert.notEqual(
      createHash('sha256').update(changedPreimage).digest('hex').slice(0, 16),
      expectedDigest,
    );
  }
});
```

Add `readFile` and `createRequire` to the test imports before running it.

- [ ] **Step 6: Run the pure path tests and commit**

```bash
node --experimental-strip-types --test tests/social-card.test.mjs
npm run check
git diff --check
git add src/lib/social-card.ts tests/social-card.test.mjs
git commit -m "feat: derive article social card paths"
```

Expected: path/normalization/digest tests pass and Astro reports zero diagnostics. Rendering is added as the next independently tested slice.

---

### Task 4: Render the fixed Satori card and deterministic PNG with TDD

**Files:**

- Modify: `tests/social-card.test.mjs`
- Modify: `src/lib/social-card.ts`

- [ ] **Step 1: Add renderer tests before the renderer export exists**

Add Sharp and these renderer cases:

```js
import sharp from 'sharp';

test('renderer emits deterministic opaque palette PNG within budget', async () => {
  const module = await loadSocialCardModule();
  assert.equal(typeof module.renderSocialCard, 'function');
  const { prepareSocialCard, renderSocialCard } = module;
  const { model } = await prepareSocialCard(baseInput);
  const first = Buffer.from(await renderSocialCard(model));
  const second = Buffer.from(await renderSocialCard(model));
  const metadata = await sharp(first, { failOn: 'error' }).metadata();

  assert.deepEqual(first, second);
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 630);
  assert.equal(metadata.hasAlpha, false);
  assert.equal(metadata.channels, 3);
  assert.equal(metadata.isPalette, true);
  assert.ok(first.byteLength <= 350 * 1024);
  await sharp(first, { failOn: 'error' }).raw().toBuffer();
});

test('renderer handles long, mixed and markup-like titles as text', async () => {
  const module = await loadSocialCardModule();
  assert.equal(typeof module.renderSocialCard, 'function');
  const { prepareSocialCard, renderSocialCard } = module;
  const titles = [
    '这是一篇用于验证三行截断与真实字体度量的很长中文文章标题并且仍然不能越过安全边界',
    'Astro 7 × Feishu：Static Publishing 2026 实践记录',
    '<svg><script>alert(1)</script></svg> 不是节点结构',
    '「标点」、《书名号》与——破折号：都应正常排版',
  ];

  for (const [index, title] of titles.entries()) {
    const { model } = await prepareSocialCard({
      ...baseInput,
      slug: `render-case-${index + 1}`,
      title,
    });
    const png = await renderSocialCard(model);
    assert.ok(png.byteLength > 0);
  }
});

test('renderer keeps long category and column inside one metadata row', async () => {
  const module = await loadSocialCardModule();
  assert.equal(typeof module.renderSocialCard, 'function');
  const { prepareSocialCard, renderSocialCard } = module;
  const { model } = await prepareSocialCard({
    ...baseInput,
    slug: 'long-taxonomy',
    category: '超长分类名称'.repeat(30),
    column: '超长专栏名称'.repeat(30),
  });
  const png = await renderSocialCard(model);

  assert.ok(png.byteLength > 0);
});

test('renderer performs no network access', async () => {
  const module = await loadSocialCardModule();
  assert.equal(typeof module.renderSocialCard, 'function');
  const { prepareSocialCard, renderSocialCard } = module;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('network access is forbidden');
  };

  try {
    const { model } = await prepareSocialCard(baseInput);
    await renderSocialCard(model);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unsupported glyph failure names only slug and code points', async () => {
  const module = await loadSocialCardModule();
  assert.equal(typeof module.renderSocialCard, 'function');
  const { prepareSocialCard, renderSocialCard } = module;
  const secretTitle = '私密标题🙂';
  const { model } = await prepareSocialCard({
    ...baseInput,
    slug: 'unsupported-glyph',
    title: secretTitle,
  });

  await assert.rejects(
    renderSocialCard(model),
    (error) => {
      assert.match(error.message, /unsupported-glyph/u);
      assert.match(error.message, /font coverage/u);
      assert.match(error.message, /U\+1F642/u);
      assert.doesNotMatch(error.message, new RegExp(secretTitle, 'u'));
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});
```

- [ ] **Step 2: Prove the renderer tests are red**

```bash
node --experimental-strip-types --test \
  --test-name-pattern="renderer|glyph" \
  tests/social-card.test.mjs
```

Expected: failures report that `renderSocialCard` is not yet exported.

- [ ] **Step 3: Build nodes as plain objects, never as interpolated markup**

Do not import React and do not rely on a Satori JSX subpath. Add this small structural factory:

```ts
interface SocialNode {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
}

function node(
  type: string,
  props: Record<string, unknown>,
  ...children: unknown[]
): SocialNode {
  return {
    type,
    props: {
      ...props,
      children: children.length === 1 ? children[0] : children,
    },
  };
}
```

Implement the complete tree below. Every multi-child `div` explicitly uses flex, both columns use border-box sizing, and article fields remain text children rather than markup:

```ts
function buildSocialCardNode(model: SocialCardModel): SocialNode {
  const colors = SOCIAL_CARD_RECIPE.colors;
  const titleSlotHeight =
    model.titleFontSize *
    SOCIAL_CARD_RECIPE.titleLineHeight *
    SOCIAL_CARD_RECIPE.titleLineClamp;
  const metadataChildren: unknown[] = [
    node(
      'div',
      {
        style: {
          display: 'flex',
          color: colors.terracotta,
          fontSize: SOCIAL_CARD_RECIPE.layout.categoryFontSize,
          letterSpacing:
            SOCIAL_CARD_RECIPE.layout.categoryLetterSpacing,
          maxWidth: SOCIAL_CARD_RECIPE.layout.categoryMaxWidth,
          overflow: 'hidden',
          whiteSpace:
            SOCIAL_CARD_RECIPE.layout.metadataWhiteSpace,
          textOverflow:
            SOCIAL_CARD_RECIPE.layout.metadataTextOverflow,
        },
      },
      model.category,
    ),
  ];

  if (model.column !== undefined) {
    metadataChildren.push(
      node('div', {
        style: {
          display: 'flex',
          width: SOCIAL_CARD_RECIPE.layout.dividerWidth,
          height: SOCIAL_CARD_RECIPE.layout.dividerHeight,
          margin: SOCIAL_CARD_RECIPE.layout.dividerMargin,
          backgroundColor: colors.muted,
          opacity: SOCIAL_CARD_RECIPE.layout.dividerOpacity,
        },
      }),
      node(
        'div',
        {
          style: {
            display: 'flex',
            color: colors.muted,
            fontSize: SOCIAL_CARD_RECIPE.layout.columnFontSize,
            maxWidth: SOCIAL_CARD_RECIPE.layout.columnMaxWidth,
            overflow: 'hidden',
            whiteSpace:
              SOCIAL_CARD_RECIPE.layout.metadataWhiteSpace,
            textOverflow:
              SOCIAL_CARD_RECIPE.layout.metadataTextOverflow,
          },
        },
        model.column,
      ),
    );
  }

  metadataChildren.push(
    node(
      'div',
      {
        style: {
          display: 'flex',
          marginLeft: 'auto',
          width: SOCIAL_CARD_RECIPE.layout.dateWidth,
          flexShrink: 0,
          justifyContent: 'flex-end',
          color: colors.muted,
          fontSize: SOCIAL_CARD_RECIPE.layout.dateFontSize,
          letterSpacing: SOCIAL_CARD_RECIPE.layout.dateLetterSpacing,
        },
      },
      model.displayDate,
    ),
  );

  const leftColumn = node(
    'div',
    {
      style: {
        display: 'flex',
        boxSizing: 'border-box',
        width: SOCIAL_CARD_RECIPE.leftWidth,
        height: SOCIAL_CARD_RECIPE.height,
        flexDirection: 'column',
        padding: SOCIAL_CARD_RECIPE.layout.leftPadding,
      },
    },
    node(
      'div',
      {
        style: {
          display: 'flex',
          color: colors.terracotta,
          fontSize: SOCIAL_CARD_RECIPE.layout.markFontSize,
          letterSpacing: SOCIAL_CARD_RECIPE.layout.markLetterSpacing,
        },
      },
      model.siteMark,
    ),
    node(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          justifyContent: 'center',
          paddingTop: SOCIAL_CARD_RECIPE.layout.titleFramePaddingTop,
          paddingBottom:
            SOCIAL_CARD_RECIPE.layout.titleFramePaddingBottom,
        },
      },
      node(
        'div',
        {
          'data-social-node': 'title-slot',
          style: {
            display: 'flex',
            width: '100%',
            height: titleSlotHeight,
            maxHeight: titleSlotHeight,
            alignItems: 'center',
            overflow: 'hidden',
          },
        },
        node(
          'div',
          {
            style: {
              display: 'flex',
              width: '100%',
              maxHeight: titleSlotHeight,
              color: colors.ink,
              fontSize: model.titleFontSize,
              lineHeight: SOCIAL_CARD_RECIPE.titleLineHeight,
              lineClamp: SOCIAL_CARD_RECIPE.titleLineClamp,
              overflow: 'hidden',
              wordBreak: SOCIAL_CARD_RECIPE.titleWordBreak,
              letterSpacing:
                SOCIAL_CARD_RECIPE.layout.titleLetterSpacing,
            },
          },
          model.title,
        ),
      ),
    ),
    node(
      'div',
      {
        'data-social-node': 'metadata-row',
        style: {
          display: 'flex',
          width: '100%',
          height: SOCIAL_CARD_RECIPE.layout.metadataRowHeight,
          maxHeight: SOCIAL_CARD_RECIPE.layout.metadataRowHeight,
          alignItems: 'center',
          overflow: 'hidden',
        },
      },
      ...metadataChildren,
    ),
  );

  const textureLines = SOCIAL_CARD_RECIPE.layout.textureTops.map((top) =>
    node('div', {
      style: {
        display: 'flex',
        position: 'absolute',
        top,
        left: SOCIAL_CARD_RECIPE.layout.textureLeft,
        width: SOCIAL_CARD_RECIPE.layout.textureWidth,
        height: SOCIAL_CARD_RECIPE.layout.textureHeight,
        backgroundColor: colors.moss,
        opacity: SOCIAL_CARD_RECIPE.layout.textureOpacity,
        transform: SOCIAL_CARD_RECIPE.layout.textureTransform,
      },
    }),
  );
  const hollowMark = node(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: SOCIAL_CARD_RECIPE.layout.hollowMarginTop,
      },
    },
    ...[...SOCIAL_CARD_RECIPE.hollowMark].map((letter) =>
      node(
        'div',
        {
          style: {
            display: 'flex',
            color: 'transparent',
            fontSize: SOCIAL_CARD_RECIPE.layout.hollowFontSize,
            lineHeight: SOCIAL_CARD_RECIPE.layout.hollowLineHeight,
            WebkitTextStroke:
              `${SOCIAL_CARD_RECIPE.layout.hollowStrokeWidth}px ${colors.moss}`,
          },
        },
        letter,
      ),
    ),
  );
  const rightPanel = node(
    'div',
    {
      style: {
        display: 'flex',
        boxSizing: 'border-box',
        position: 'relative',
        width: SOCIAL_CARD_RECIPE.rightWidth,
        height: SOCIAL_CARD_RECIPE.height,
        flexDirection: 'column',
        padding: SOCIAL_CARD_RECIPE.layout.rightPadding,
        borderLeft:
          `${SOCIAL_CARD_RECIPE.layout.rightBorderWidth}px solid ` +
          `${colors.moss}${SOCIAL_CARD_RECIPE.layout.rightBorderAlpha}`,
        backgroundColor: colors.panel,
        overflow: 'hidden',
      },
    },
    ...textureLines,
    node(
      'div',
      {
        style: {
          display: 'flex',
          alignSelf: 'flex-end',
          color: colors.muted,
          fontSize: SOCIAL_CARD_RECIPE.layout.yearFontSize,
          letterSpacing: SOCIAL_CARD_RECIPE.layout.yearLetterSpacing,
        },
      },
      model.year,
    ),
    hollowMark,
    node(
      'div',
      {
        style: {
          display: 'flex',
          alignSelf: 'flex-end',
          color: colors.muted,
          fontSize: SOCIAL_CARD_RECIPE.layout.footerFontSize,
          letterSpacing:
            SOCIAL_CARD_RECIPE.layout.footerLetterSpacing,
        },
      },
      SOCIAL_CARD_RECIPE.footerLabel,
    ),
  );

  return node(
    'div',
    {
      lang: SOCIAL_CARD_RECIPE.language,
      style: {
        display: 'flex',
        width: SOCIAL_CARD_WIDTH,
        height: SOCIAL_CARD_HEIGHT,
        backgroundColor: colors.paper,
        color: colors.ink,
        fontFamily: FONT_FAMILY,
        fontWeight: SOCIAL_CARD_RECIPE.fontWeight,
        overflow: 'hidden',
      },
    },
    leftColumn,
    rightPanel,
  );
}
```

Article fields are always children text values; never concatenate them into an SVG or HTML source string.

- [ ] **Step 4: Add the missing-glyph, horizontal title-bound and PNG gates**

Add this helper:

```ts
function codePoints(segment: string): string {
  return [...segment]
    .map((character) =>
      `U+${character.codePointAt(0)!.toString(16).toUpperCase()}`,
    )
    .join(',');
}

function safeSatoriFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const coverage =
    /font coverage failed \((U\+[0-9A-F]+(?:,U\+[0-9A-F]+)*)\)/u.exec(
      message,
    );

  if (coverage !== null) {
    return `font coverage failed (${coverage[1]})`;
  }
  if (message.includes('title slot exceeded its safe bounds')) {
    return 'title slot exceeded its safe bounds';
  }
  if (message.includes('metadata row exceeded its safe bounds')) {
    return 'metadata row exceeded its safe bounds';
  }

  return 'Satori layout failed';
}
```

Add the renderer export:

```ts
export async function renderSocialCard(
  model: SocialCardModel,
): Promise<Uint8Array> {
  let font: LoadedFont;

  try {
    font = await loadFont();
  } catch {
    throw new Error(
      `Social card "${model.slug}" font validation failed.`,
    );
  }

  let svg: string;
  try {
    svg = await satori(
      buildSocialCardNode(model) as Parameters<typeof satori>[0],
      {
        width: SOCIAL_CARD_WIDTH,
        height: SOCIAL_CARD_HEIGHT,
        fonts: font.fonts,
        embedFont: SOCIAL_CARD_RECIPE.satori.embedFont,
        pointScaleFactor:
          SOCIAL_CARD_RECIPE.satori.pointScaleFactor,
        loadAdditionalAsset: async (_languageCode, segment) => {
          throw new Error(
            `font coverage failed (${codePoints(segment)})`,
          );
        },
        onNodeDetected(detected) {
          const socialNode = detected.props['data-social-node'];
          if (
            socialNode !== 'title-slot' &&
            socialNode !== 'metadata-row'
          ) return;

          const expectedHeight = socialNode === 'title-slot'
            ? model.titleFontSize *
              SOCIAL_CARD_RECIPE.titleLineHeight *
              SOCIAL_CARD_RECIPE.titleLineClamp
            : SOCIAL_CARD_RECIPE.layout.metadataRowHeight;

          if (
            detected.left < SOCIAL_CARD_RECIPE.safeInset - 1 ||
            detected.left + detected.width >
              SOCIAL_CARD_RECIPE.leftWidth -
                SOCIAL_CARD_RECIPE.safeInset +
                1 ||
            detected.height > expectedHeight + 1
          ) {
            throw new Error(
              socialNode === 'title-slot'
                ? 'title slot exceeded its safe bounds'
                : 'metadata row exceeded its safe bounds',
            );
          }
        },
      },
    );
  } catch (error) {
    throw new Error(
      `Social card "${model.slug}" rendering failed: ${safeSatoriFailure(error)}.`,
    );
  }

  let output: { data: Buffer; info: sharp.OutputInfo };
  try {
    let pipeline = sharp(Buffer.from(svg), {
      density: SOCIAL_CARD_RECIPE.raster.density,
      failOn: SOCIAL_CARD_RECIPE.raster.failOn,
      limitInputPixels:
        SOCIAL_CARD_RECIPE.raster.limitInputPixels,
    })
      .flatten({
        background: SOCIAL_CARD_RECIPE.raster.flattenBackground,
      });
    if (SOCIAL_CARD_RECIPE.raster.removeAlpha) {
      pipeline = pipeline.removeAlpha();
    }
    output = await pipeline
      .toColourspace(SOCIAL_CARD_RECIPE.raster.colourspace)
      .png(SOCIAL_CARD_RECIPE.png)
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new Error(
      `Social card "${model.slug}" PNG encoding failed.`,
    );
  }

  const { data, info } = output;
  if (
    info.format !== 'png' ||
    info.width !== SOCIAL_CARD_WIDTH ||
    info.height !== SOCIAL_CARD_HEIGHT ||
    info.channels !== 3
  ) {
    throw new Error(
      `Social card "${model.slug}" PNG validation failed.`,
    );
  }
  if (data.byteLength > MAX_SOCIAL_CARD_BYTES) {
    throw new Error(
      `Social card "${model.slug}" exceeds the 350 KiB output limit.`,
    );
  }

  return new Uint8Array(data);
}
```

Satori reports the text node's pre-clamp height to `onNodeDetected`; the callback therefore observes the fixed `title-slot` wrapper, never the inner text node. The slot height is derived from font size, line height and the three-line clamp, so a correctly clamped long title remains valid while the wrapper still has a measurable vertical gate. If a Sharp option name differs from this snippet, inspect the installed `sharp` declarations and use the exact 0.35.3 declaration while retaining every recipe value.

- [ ] **Step 5: Prove renderer determinism and type safety, then commit**

```bash
node --experimental-strip-types --test tests/social-card.test.mjs
npm run check
git diff --check
git add src/lib/social-card.ts tests/social-card.test.mjs
git commit -m "feat: render deterministic social cards"
```

Expected: all social-card tests pass, normal rendering makes zero fetch calls, unsupported emoji fails with slug/code point but not title, and Astro reports zero diagnostics.

---

### Task 5: Generate one static PNG route for every article

**Files:**

- Create: `src/pages/social/posts/[asset].png.ts`
- Modify: `tests/build-output.test.mjs`

- [ ] **Step 1: Add binary helpers and a failing clean-build image inventory test**

Add `sharp` and `SITE` imports to `tests/build-output.test.mjs`:

```js
import sharp from 'sharp';

import { SITE } from '../src/config/site.ts';
import { normalizeTag } from '../src/lib/posts.ts';
```

Add:

```js
async function readBinaryOutput(relativePath) {
  assert.ok(distRoot, 'clean build should initialize its output directory');
  return readFile(new URL(relativePath, distRoot));
}
```

Add this test before any HTML metadata tests:

```js
test('clean build emits exactly one valid social PNG per article', async () => {
  const index = assertPublicSearchIndexContract(
    await readOutput('search-index.json'),
  );
  const files = (
    await readdir(new URL('social/posts/', distRoot))
  ).toSorted();

  assert.equal(files.length, index.entries.length);
  assert.equal(new Set(files).size, files.length);

  for (const file of files) {
    assert.match(
      file,
      /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{16}\.png$/u,
    );
    const bytes = await readBinaryOutput(`social/posts/${file}`);
    const metadata = await sharp(bytes, { failOn: 'error' }).metadata();

    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 630);
    assert.equal(metadata.hasAlpha, false);
    assert.equal(metadata.channels, 3);
    assert.equal(metadata.isPalette, true);
    assert.ok(bytes.byteLength <= 350 * 1024);
    await sharp(bytes, { failOn: 'error' }).raw().toBuffer();
  }
});
```

- [ ] **Step 2: Prove the endpoint test is red**

```bash
node --experimental-strip-types --test tests/build-output.test.mjs
```

Expected: the clean build completes without `dist/social/posts/`, so the new inventory test fails.

- [ ] **Step 3: Implement the static endpoint from the shared prepared model**

Create `src/pages/social/posts/[asset].png.ts`:

```ts
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';

import {
  getSocialCardInput,
  prepareSocialCard,
  renderSocialCard,
  type SocialCardModel,
} from '../../../lib/social-card';

interface RouteProps {
  model: SocialCardModel;
}

const PATH_PREFIX = '/social/posts/';
const PATH_SUFFIX = '.png';
const SAFE_ASSET =
  /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{16}$/u;

function assetFromPath(path: string): string {
  if (!path.startsWith(PATH_PREFIX) || !path.endsWith(PATH_SUFFIX)) {
    throw new Error('Unexpected social card path shape.');
  }

  const asset = path.slice(
    PATH_PREFIX.length,
    -PATH_SUFFIX.length,
  );
  if (!SAFE_ASSET.test(asset)) {
    throw new Error('Unexpected social card asset shape.');
  }

  return asset;
}

export const getStaticPaths = (async () => {
  const posts = await getCollection('posts');
  const routes = await Promise.all(posts.map(async (post) => {
    const { metadata, model } = await prepareSocialCard(
      getSocialCardInput(post),
    );

    return {
      params: { asset: assetFromPath(metadata.path) },
      props: { model },
    };
  }));
  const assets = routes.map(({ params }) => params.asset);

  if (new Set(assets).size !== assets.length) {
    throw new Error('Duplicate social card assets were generated.');
  }

  return routes;
}) satisfies GetStaticPaths;

export const GET: APIRoute<RouteProps> = async ({ props }) => {
  const png = await renderSocialCard(props.model);

  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png' },
  });
};
```

`params.asset` deliberately excludes `.png`; the extension comes from `[asset].png.ts`. Props contain only strings and a number, never `Date`, `Buffer`, font bytes or the Satori tree. Do not claim a custom `Cache-Control` survives GitHub Pages.

- [ ] **Step 4: Prove endpoint generation is green and commit**

```bash
node --experimental-strip-types --test \
  tests/social-card.test.mjs \
  tests/build-output.test.mjs
npm run check
git diff --check
git add \
  'src/pages/social/posts/[asset].png.ts' \
  tests/build-output.test.mjs
git commit -m "feat: generate article social card routes"
```

Expected: the clean build contains exactly one non-orphaned valid PNG for every search-index article and Astro reports zero diagnostics.

---

### Task 6: Publish conditional Open Graph and Twitter image metadata

**Files:**

- Modify: `tests/ui-source.test.mjs`
- Modify: `src/layouts/BaseLayout.astro`

- [ ] **Step 1: Replace the old no-image source test with the conditional contract**

Replace `BaseLayout emits site metadata without inventing a social preview image` in `tests/ui-source.test.mjs` with:

```js
test('BaseLayout separates document titles from conditional social metadata', async () => {
  const source = await readSource('src/layouts/BaseLayout.astro');

  assert.match(source, /socialImage\?:\s*SocialImageMetadata;/);
  assert.match(source, /articleMetadata\?:\s*ArticleOpenGraphMetadata;/);
  assert.match(source, /<title>\{documentTitle\}<\/title>/);
  assert.match(source, /property=["']og:title["']\s+content=\{title\}/);
  assert.match(source, /name=["']twitter:title["']\s+content=\{title\}/);
  assert.match(
    source,
    /socialImage\s*===\s*undefined\s*\?\s*['"]summary['"]\s*:\s*['"]summary_large_image['"]/,
  );

  for (const property of [
    'og:image',
    'og:image:secure_url',
    'og:image:type',
    'og:image:width',
    'og:image:height',
    'og:image:alt',
    'article:published_time',
    'article:modified_time',
    'article:section',
    'article:tag',
  ]) {
    assert.match(source, new RegExp(`property=["']${property}["']`));
  }

  for (const name of ['twitter:image', 'twitter:image:alt']) {
    assert.match(source, new RegExp(`name=["']${name}["']`));
  }

  assert.match(source, /socialImage\s*!==\s*undefined/);
  assert.match(source, /articleMetadata\s*!==\s*undefined/);
  assert.doesNotMatch(
    source,
    /twitter:site|twitter:creator|article:author/,
  );
});
```

- [ ] **Step 2: Prove the source contract is red**

```bash
node --experimental-strip-types --test \
  --test-name-pattern="BaseLayout separates" \
  tests/ui-source.test.mjs
```

Expected: failure because the layout has no social-image/article props and still writes `documentTitle` to social titles.

- [ ] **Step 3: Add typed conditional props and absolute image URL**

In `src/layouts/BaseLayout.astro`, import:

```ts
import type {
  ArticleOpenGraphMetadata,
  SocialImageMetadata,
} from '../lib/social-card';
```

Extend `Props`, destructuring and derived values:

```ts
interface Props {
  title: string;
  description?: string;
  canonicalPath?: string;
  ogType?: 'website' | 'article';
  socialImage?: SocialImageMetadata;
  articleMetadata?: ArticleOpenGraphMetadata;
  jsonLd?: unknown;
}

const {
  title,
  description = SITE.description,
  canonicalPath = Astro.url.pathname,
  ogType = 'website',
  socialImage,
  articleMetadata,
  jsonLd,
} = Astro.props;

const documentTitle = title === SITE.name ? title : `${title} | ${SITE.name}`;
const canonicalUrl = new URL(canonicalPath, SITE.canonicalOrigin).href;
const socialImageUrl = socialImage === undefined
  ? undefined
  : new URL(socialImage.path, SITE.canonicalOrigin).href;
const serializedJsonLd = jsonLd === undefined
  ? undefined
  : serializeJsonLd(jsonLd);
```

- [ ] **Step 4: Replace the head's social block with the exact conditional fields**

Keep the existing locale, type, site name, description and URL fields. Change titles to the raw `title`, then add:

```astro
<meta property="og:title" content={title} />
<meta property="og:description" content={description} />
<meta property="og:url" content={canonicalUrl} />

{socialImage !== undefined && socialImageUrl !== undefined && (
  <>
    <meta property="og:image" content={socialImageUrl} />
    <meta property="og:image:secure_url" content={socialImageUrl} />
    <meta property="og:image:type" content={socialImage.mimeType} />
    <meta property="og:image:width" content={socialImage.width} />
    <meta property="og:image:height" content={socialImage.height} />
    <meta property="og:image:alt" content={socialImage.alt} />
  </>
)}

<meta
  name="twitter:card"
  content={socialImage === undefined ? 'summary' : 'summary_large_image'}
/>
<meta name="twitter:title" content={title} />
<meta name="twitter:description" content={description} />

{socialImage !== undefined && socialImageUrl !== undefined && (
  <>
    <meta name="twitter:image" content={socialImageUrl} />
    <meta name="twitter:image:alt" content={socialImage.alt} />
  </>
)}

{articleMetadata !== undefined && (
  <>
    <meta
      property="article:published_time"
      content={articleMetadata.publishedTime}
    />
    {articleMetadata.modifiedTime !== undefined && (
      <meta
        property="article:modified_time"
        content={articleMetadata.modifiedTime}
      />
    )}
    <meta property="article:section" content={articleMetadata.section} />
    {articleMetadata.tags.map((tag) => (
      <meta property="article:tag" content={tag} />
    ))}
  </>
)}
```

Do not add empty tags, a default image, handles or `article:author`.

- [ ] **Step 5: Run the focused source test without committing yet**

```bash
node --experimental-strip-types --test \
  --test-name-pattern="BaseLayout separates" \
  tests/ui-source.test.mjs
npm run check
```

Expected: the source test and Astro check pass. Keep these files uncommitted until article wiring and output tests complete so no commit advertises unused image props.

---

### Task 7: Wire articles, truthful Article metadata and BlogPosting output

**Files:**

- Modify: `tests/ui-source.test.mjs`
- Modify: `tests/build-output.test.mjs`
- Modify: `src/layouts/PostLayout.astro`
- Modify: `src/pages/posts/[...id].astro`
- Modify: `src/layouts/BaseLayout.astro` from Task 6

- [ ] **Step 1: Add source tests for article-only wiring and structured data**

Replace the existing `article layouts opt into safe BlogPosting metadata only when supplied` test with:

```js
test('PostLayout publishes truthful article and BlogPosting metadata', async () => {
  const source = await readSource('src/layouts/PostLayout.astro');

  assert.match(source, /socialImage:\s*SocialImageMetadata;/);
  assert.match(source, /ArticleOpenGraphMetadata/);
  assert.match(source, /publishedTime:\s*pubDate\.toISOString\(\)/);
  assert.match(source, /modifiedTime:\s*updatedDate\.toISOString\(\)/);
  assert.doesNotMatch(source, /updatedDate\s*\?\?\s*pubDate/);
  assert.match(source, /socialImage=\{socialImage\}/);
  assert.match(source, /articleMetadata=\{articleMetadata\}/);

  for (const field of [
    '@id',
    'url',
    'image',
    'keywords',
    'publisher',
    'inLanguage',
    'isAccessibleForFree',
    'timeRequired',
  ]) {
    assert.match(source, new RegExp(field));
  }

  assert.match(source, /['"]@type['"]:\s*['"]ImageObject['"]/);
  assert.match(source, /['"]@type['"]:\s*['"]Person['"]/);
  assert.match(source, /['"]@type['"]:\s*['"]WebPage['"]/);
});

test('only article routes opt into generated social metadata', async () => {
  const [routeSource, postSource, ...ordinarySources] = await Promise.all([
    readSource('src/pages/posts/[...id].astro'),
    readSource('src/layouts/PostLayout.astro'),
    ...[
      'src/pages/index.astro',
      'src/pages/404.astro',
      'src/pages/about.astro',
      'src/pages/posts/index.astro',
      'src/pages/categories/index.astro',
      'src/pages/categories/[category].astro',
      'src/pages/columns/index.astro',
      'src/pages/columns/[column].astro',
      'src/pages/tags/index.astro',
      'src/pages/tags/[tag].astro',
    ].map(readSource),
  ]);

  assert.match(routeSource, /getSocialCardInput/);
  assert.match(routeSource, /getSocialImageMetadata/);
  assert.match(
    routeSource,
    /getSocialImageMetadata\(\s*getSocialCardInput\(post\),?\s*\)/s,
  );
  assert.match(routeSource, /socialImage=\{socialImage\}/);
  assert.match(postSource, /articleMetadata=\{articleMetadata\}/);

  for (const source of ordinarySources) {
    assert.doesNotMatch(source, /(?:socialImage|articleMetadata)=/);
  }
});
```

- [ ] **Step 2: Add a truthful update-date fixture to the clean build**

Add constants beside the existing fixtures in `tests/build-output.test.mjs`:

```js
const updatedDateFixtureSlug = 'build-output-updated-date';
const updatedDatePublishedTime = '2026-01-03T08:15:00.000Z';
const updatedDateModifiedTime = '2026-02-04T09:30:00.000Z';
const updatedDateFixture = `---
title: 构建输出更新时间文章
description: 验证真实更新时间进入 Article 元数据与 BlogPosting。
pubDate: ${updatedDatePublishedTime}
updatedDate: ${updatedDateModifiedTime}
category: 测试
tags:
  - 元数据
featured: false
slug: ${updatedDateFixtureSlug}
---

这篇夹具只验证真实更新时间，不属于任何专栏。
`;
```

Add one `writeFile` call to the existing temporary fixture `Promise.all`:

```js
writeFile(
  join(
    temporaryProjectRoot,
    'src/content/posts/manual/build-output-updated-date.md',
  ),
  updatedDateFixture,
  { encoding: 'utf8', flag: 'wx' },
),
```

Do not add this fixture to the real content tree.

- [ ] **Step 3: Add robust head parsers instead of order-dependent regexes**

Add these helpers after `readOutput`:

```js
const namedHtmlEntities = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
};

function decodeHtmlEntities(value) {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu,
    (source, decimal, hexadecimal, named) => {
      if (decimal !== undefined) {
        return String.fromCodePoint(Number.parseInt(decimal, 10));
      }
      if (hexadecimal !== undefined) {
        return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      }
      return namedHtmlEntities[named?.toLowerCase()] ?? source;
    },
  );
}

function readHead(html) {
  const match = /<head\b[^>]*>([\s\S]*?)<\/head>/iu.exec(html);
  assert.ok(match, 'page should include a head element');
  return match[1];
}

function readTagAttributes(html, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, 'giu');

  return [...readHead(html).matchAll(pattern)].map(([tag]) => {
    const attributes = {};
    for (const match of tag.matchAll(
      /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu,
    )) {
      attributes[match[1].toLowerCase()] = decodeHtmlEntities(
        match[2] ?? match[3] ?? match[4] ?? '',
      );
    }
    return attributes;
  });
}

function readMetaContents(html, selectorName, selectorValue) {
  return readTagAttributes(html, 'meta')
    .filter((attributes) => attributes[selectorName] === selectorValue)
    .map((attributes) => {
      assert.ok(
        Object.hasOwn(attributes, 'content'),
        `${selectorValue} metadata should include content`,
      );
      return attributes.content;
    });
}

function readOnlyMetaContent(html, selectorName, selectorValue) {
  const values = readMetaContents(html, selectorName, selectorValue);
  assert.equal(
    values.length,
    1,
    `${selectorValue} metadata should occur exactly once`,
  );
  return values[0];
}

function readCanonicalHref(html) {
  const links = readTagAttributes(html, 'link').filter((attributes) =>
    attributes.rel?.split(/\s+/u).includes('canonical'),
  );
  assert.equal(links.length, 1, 'page should include one canonical link');
  return links[0].href;
}

function readDocumentTitle(html) {
  const matches = [
    ...readHead(html).matchAll(/<title>([\s\S]*?)<\/title>/giu),
  ];
  assert.equal(matches.length, 1, 'page should include one title');
  return decodeHtmlEntities(matches[0][1]);
}
```

- [ ] **Step 4: Add failing ordinary-page, article and update-truth tests**

Add an ordinary page fallback test:

```js
test('ordinary pages keep summary metadata without article or image fields', async () => {
  const html = await readOutput('about/index.html');

  assert.equal(readDocumentTitle(html), `关于 | ${SITE.name}`);
  assert.equal(readOnlyMetaContent(html, 'property', 'og:title'), '关于');
  assert.equal(readOnlyMetaContent(html, 'name', 'twitter:title'), '关于');
  assert.equal(readOnlyMetaContent(html, 'name', 'twitter:card'), 'summary');

  for (const property of [
    'og:image',
    'og:image:secure_url',
    'og:image:type',
    'og:image:width',
    'og:image:height',
    'og:image:alt',
    'article:published_time',
    'article:modified_time',
    'article:section',
    'article:tag',
    'article:author',
  ]) {
    assert.deepEqual(readMetaContents(html, 'property', property), []);
  }

  for (const name of [
    'twitter:image',
    'twitter:image:alt',
    'twitter:site',
    'twitter:creator',
  ]) {
    assert.deepEqual(readMetaContents(html, 'name', name), []);
  }
});
```

Add one exhaustive loop over all search entries:

```js
test('every article publishes one complete social image and BlogPosting contract', async () => {
  const index = assertPublicSearchIndexContract(
    await readOutput('search-index.json'),
  );
  const expectedImageFiles = [];

  for (const entry of index.entries) {
    const html = await readOutput(getArticleOutputPath(entry.href));
    const jsonLd = readJsonLd(html);
    const canonicalUrl = readCanonicalHref(html);
    const ogImage = readOnlyMetaContent(html, 'property', 'og:image');
    const imageUrl = new URL(ogImage);
    const slugMatch =
      /^\/posts\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/u.exec(entry.href);

    assert.ok(slugMatch, `${entry.href} should expose a safe slug`);
    assert.equal(readDocumentTitle(html), `${entry.title} | ${SITE.name}`);
    assert.equal(
      readOnlyMetaContent(html, 'property', 'og:title'),
      entry.title,
    );
    assert.equal(
      readOnlyMetaContent(html, 'name', 'twitter:title'),
      entry.title,
    );
    assert.equal(
      readOnlyMetaContent(html, 'name', 'twitter:card'),
      'summary_large_image',
    );
    assert.equal(
      readOnlyMetaContent(html, 'property', 'og:type'),
      'article',
    );

    assert.equal(imageUrl.protocol, 'https:');
    assert.equal(imageUrl.origin, SITE.canonicalOrigin);
    assert.equal(imageUrl.search, '');
    assert.equal(imageUrl.hash, '');
    assert.match(
      imageUrl.pathname,
      new RegExp(
        `^/social/posts/${slugMatch[1]}-[0-9a-f]{16}\\.png$`,
      ),
    );

    const expectedAlt =
      `“${entry.title}”文章分享卡片，来自 ${SITE.mark}`;
    assert.equal(
      readOnlyMetaContent(html, 'property', 'og:image:secure_url'),
      ogImage,
    );
    assert.equal(
      readOnlyMetaContent(html, 'property', 'og:image:type'),
      'image/png',
    );
    assert.equal(
      readOnlyMetaContent(html, 'property', 'og:image:width'),
      '1200',
    );
    assert.equal(
      readOnlyMetaContent(html, 'property', 'og:image:height'),
      '630',
    );
    assert.equal(
      readOnlyMetaContent(html, 'property', 'og:image:alt'),
      expectedAlt,
    );
    assert.equal(
      readOnlyMetaContent(html, 'name', 'twitter:image'),
      ogImage,
    );
    assert.equal(
      readOnlyMetaContent(html, 'name', 'twitter:image:alt'),
      expectedAlt,
    );

    assert.equal(
      readOnlyMetaContent(html, 'property', 'article:published_time'),
      jsonLd.datePublished,
    );
    assert.equal(
      readOnlyMetaContent(html, 'property', 'article:section'),
      entry.category,
    );
    assert.deepEqual(
      readMetaContents(html, 'property', 'article:tag'),
      entry.tags,
    );

    const modifiedTimes = readMetaContents(
      html,
      'property',
      'article:modified_time',
    );
    assert.ok(modifiedTimes.length <= 1);
    assert.equal(
      Object.hasOwn(jsonLd, 'dateModified'),
      modifiedTimes.length === 1,
    );
    if (modifiedTimes.length === 1) {
      assert.equal(jsonLd.dateModified, modifiedTimes[0]);
    }

    assert.equal(
      readOnlyMetaContent(html, 'property', 'og:url'),
      canonicalUrl,
    );
    assert.equal(jsonLd['@id'], `${canonicalUrl}#article`);
    assert.equal(jsonLd.url, canonicalUrl);
    assert.deepEqual(jsonLd.mainEntityOfPage, {
      '@type': 'WebPage',
      '@id': canonicalUrl,
    });
    assert.deepEqual(jsonLd.image, {
      '@type': 'ImageObject',
      url: ogImage,
      width: 1200,
      height: 630,
    });
    assert.equal(jsonLd.headline, entry.title);
    assert.equal(jsonLd.description, entry.description);
    assert.equal(jsonLd.articleSection, entry.category);
    assert.deepEqual(
      jsonLd.keywords,
      entry.tags.length === 0 ? undefined : entry.tags,
    );
    assert.deepEqual(jsonLd.author, {
      '@type': 'Person',
      name: SITE.author,
    });
    assert.deepEqual(jsonLd.publisher, {
      '@type': 'Person',
      name: SITE.author,
    });
    assert.equal(jsonLd.inLanguage, 'zh-CN');
    assert.equal(jsonLd.isAccessibleForFree, true);
    assert.equal(jsonLd.timeRequired, `PT${entry.readingMinutes}M`);

    assert.deepEqual(
      readMetaContents(html, 'property', 'article:author'),
      [],
    );
    for (const name of ['twitter:site', 'twitter:creator']) {
      assert.deepEqual(readMetaContents(html, 'name', name), []);
    }

    const relativeImagePath = imageUrl.pathname.slice(1);
    const imageBytes = await readBinaryOutput(relativeImagePath);
    const imageMetadata = await sharp(imageBytes, {
      failOn: 'error',
    }).metadata();
    assert.equal(imageMetadata.format, 'png');
    assert.equal(imageMetadata.width, 1200);
    assert.equal(imageMetadata.height, 630);
    assert.equal(imageMetadata.hasAlpha, false);
    assert.ok(imageBytes.byteLength <= 350 * 1024);

    expectedImageFiles.push(imageUrl.pathname.split('/').at(-1));
  }

  assert.equal(
    new Set(expectedImageFiles).size,
    index.entries.length,
  );
  const actualImageFiles = (
    await readdir(new URL('social/posts/', distRoot))
  ).toSorted();
  assert.deepEqual(actualImageFiles, expectedImageFiles.toSorted());
});
```

Add the independent truthfulness test:

```js
test('modification metadata exists only when content supplies updatedDate', async () => {
  const updatedHtml = await readOutput(
    `posts/${updatedDateFixtureSlug}/index.html`,
  );
  const updatedJsonLd = readJsonLd(updatedHtml);

  assert.equal(updatedJsonLd.datePublished, updatedDatePublishedTime);
  assert.equal(updatedJsonLd.dateModified, updatedDateModifiedTime);
  assert.deepEqual(
    readMetaContents(
      updatedHtml,
      'property',
      'article:modified_time',
    ),
    [updatedDateModifiedTime],
  );

  const unmodifiedHtml = await readOutput(
    `posts/${loneBodyH1FixtureSlug}/index.html`,
  );
  const unmodifiedJsonLd = readJsonLd(unmodifiedHtml);
  assert.equal(Object.hasOwn(unmodifiedJsonLd, 'dateModified'), false);
  assert.deepEqual(
    readMetaContents(
      unmodifiedHtml,
      'property',
      'article:modified_time',
    ),
    [],
  );
});
```

- [ ] **Step 5: Prove the article metadata tests are red**

```bash
node --experimental-strip-types --test tests/ui-source.test.mjs
node --experimental-strip-types --test tests/build-output.test.mjs
```

Expected: source tests fail because articles are not wired; output tests fail because `og:title` still contains the site suffix, images are absent from heads, and unmodified articles currently receive a false `dateModified`.

- [ ] **Step 6: Construct truthful Article and BlogPosting data in PostLayout**

Import the social types in `src/layouts/PostLayout.astro`:

```ts
import type {
  ArticleOpenGraphMetadata,
  SocialImageMetadata,
} from '../lib/social-card';
```

Add required `socialImage: SocialImageMetadata` to `Props` and destructure it. Replace the existing canonical/JSON-LD block with:

```ts
const canonicalUrl = new URL(canonicalPath, SITE.canonicalOrigin).href;
const socialImageUrl = new URL(
  socialImage.path,
  SITE.canonicalOrigin,
).href;
const articleMetadata: ArticleOpenGraphMetadata = {
  publishedTime: pubDate.toISOString(),
  ...(updatedDate === undefined
    ? {}
    : { modifiedTime: updatedDate.toISOString() }),
  section: category,
  tags,
};
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BlogPosting',
  '@id': `${canonicalUrl}#article`,
  url: canonicalUrl,
  headline: title,
  description,
  image: {
    '@type': 'ImageObject',
    url: socialImageUrl,
    width: socialImage.width,
    height: socialImage.height,
  },
  articleSection: category,
  ...(tags.length === 0 ? {} : { keywords: [...tags] }),
  datePublished: articleMetadata.publishedTime,
  ...(articleMetadata.modifiedTime === undefined
    ? {}
    : { dateModified: articleMetadata.modifiedTime }),
  author: {
    '@type': 'Person',
    name: SITE.author,
  },
  publisher: {
    '@type': 'Person',
    name: SITE.author,
  },
  mainEntityOfPage: {
    '@type': 'WebPage',
    '@id': canonicalUrl,
  },
  inLanguage: 'zh-CN',
  isAccessibleForFree: true,
  ...(readingMinutes === undefined
    ? {}
    : { timeRequired: `PT${readingMinutes}M` }),
  ...(column === undefined
    ? {}
    : {
        isPartOf: {
          '@type': 'CollectionPage',
          name: column,
          url: new URL(
            getColumnHref(column),
            SITE.canonicalOrigin,
          ).href,
        },
      }),
};
```

Pass both props to `BaseLayout`:

```astro
socialImage={socialImage}
articleMetadata={articleMetadata}
```

Keep `ogType="article"` and safe `jsonLd={jsonLd}`. Remove the old `(updatedDate ?? pubDate)` fallback completely.

- [ ] **Step 7: Wire the article route through the single shared helper**

In `src/pages/posts/[...id].astro`, add:

```ts
import {
  getSocialCardInput,
  getSocialImageMetadata,
} from '../../lib/social-card';
```

After `canonicalPath`:

```ts
const socialImage = await getSocialImageMetadata(
  getSocialCardInput(post),
);
```

Pass `socialImage={socialImage}` to `PostLayout`. The route must not reconstruct the hash, path, alt or site mark.

- [ ] **Step 8: Run focused and full verification, then commit the metadata slice**

```bash
node --experimental-strip-types --test \
  tests/ui-source.test.mjs \
  tests/build-output.test.mjs \
  tests/posts.test.mjs
npm run check
npm run verify
git diff --check
git add \
  src/layouts/BaseLayout.astro \
  src/layouts/PostLayout.astro \
  'src/pages/posts/[...id].astro' \
  tests/ui-source.test.mjs \
  tests/build-output.test.mjs
git commit -m "feat: publish social image metadata"
```

Expected: all tests pass; ordinary pages omit image/article fields; every article has one image URL matching a real PNG; and `dateModified` exists only for the explicit fixture.

---

### Task 8: Document operations, inspect every card and obtain code review

**Files:**

- Modify: `tests/workflows.test.mjs`
- Modify: `docs/FEISHU_SETUP.md`
- Inspect: `dist/social/posts/*.png`

- [ ] **Step 1: Add a failing maintenance-documentation contract**

In the existing setup-documentation test in `tests/workflows.test.mjs`, add:

```js
for (const phrase of [
  '社交分享图',
  '/social/posts/',
  '1200 × 630',
  '350 KiB',
  '只存在于 `dist/`',
  '不会进入 `.feishu-manifest.json`',
]) {
  assert.match(setup, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
```

Run:

```bash
node --experimental-strip-types --test tests/workflows.test.mjs
```

Expected: failure because the setup guide does not yet describe article social images.

- [ ] **Step 2: Add the exact operational section without changing Feishu instructions**

Insert this complete subsection after the existing cover/output explanation and before troubleshooting:

```md
### 文章社交分享图

每篇已发布文章都会在静态构建时生成一张 `1200 × 630` PNG 社交分享图，公开路径为 `/social/posts/<slug>-<hash>.png`。分享图使用项目锁定的本地字体和统一编辑部版式，不读取或缩放飞书封面，也不会在构建期间下载远程字体、图片或 emoji。

这些图片只存在于 `dist/`：不会提交到 Git，不会写入 `public/media/feishu`，也不会进入 `.feishu-manifest.json`。现有普通部署和飞书同步 workflow 都会上传完整 `dist/`，因此多维表格、飞书自动化和同步记录不需要新增字段或步骤。

缺字、字体完整性、排版、编码、尺寸或单图超过 `350 KiB` 都会让 `npm run verify` 失败并阻止新版部署；线上上一版仍然可用。排查时先在本地运行 `npm run verify`，再检查文章 `<head>` 中的绝对图片 URL，并直接请求对应的 `/social/posts/<slug>-<hash>.png`，确认返回 `image/png` 和 `1200 × 630`。
```

- [ ] **Step 3: Run the full local quality gate and record image inventory**

```bash
npm run verify
node --input-type=module -e "import { readdir, stat } from 'node:fs/promises'; const dir = 'dist/social/posts'; const files = (await readdir(dir)).filter((name) => name.endsWith('.png')); const sizes = await Promise.all(files.map(async (name) => (await stat(dir + '/' + name)).size)); console.log({ count: files.length, totalBytes: sizes.reduce((sum, size) => sum + size, 0), maxBytes: Math.max(0, ...sizes) });"
git diff --check
git status --short
```

Expected: every test passes; Astro has zero diagnostics; formal content generates one card per article; `maxBytes <= 358400`; only intended source/tests/docs are tracked changes; no `dist` images are staged.

- [ ] **Step 4: Generate explicit visual fixtures and inspect every card**

Formal content currently does not cover every layout state, so generate review-only images outside the repository:

```bash
node --experimental-strip-types --input-type=module <<'NODE'
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const {
  prepareSocialCard,
  renderSocialCard,
} = await import(pathToFileURL(resolve('src/lib/social-card.ts')));
const outputDirectory = '/tmp/xmo-social-card-review';
const base = {
  pubDate: new Date('2026-07-14T00:00:00.000Z'),
  category: '技术',
  column: '博客搭建手记',
  siteMark: 'XMO / NOTES',
};
const cases = [
  ['01-short', { ...base, slug: 'review-short', title: '重新开始写作' }],
  ['02-long-chinese', {
    ...base,
    slug: 'review-long-chinese',
    title: '这是一篇用于验证三行截断与真实字体度量的很长中文文章标题并且仍然不能越过安全边界',
  }],
  ['03-mixed', {
    ...base,
    slug: 'review-mixed',
    title: 'Astro 7 × Feishu：Static Publishing 2026 实践记录',
  }],
  ['04-no-column', {
    ...base,
    slug: 'review-no-column',
    title: '没有专栏的文章',
    column: undefined,
  }],
  ['05-long-taxonomy', {
    ...base,
    slug: 'review-long-taxonomy',
    title: '分类与专栏边界测试',
    category: '超长分类名称'.repeat(30),
    column: '超长专栏名称'.repeat(30),
  }],
];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const [name, input] of cases) {
  const { model } = await prepareSocialCard(input);
  const path = `${outputDirectory}/${name}.png`;
  await writeFile(path, await renderSocialCard(model));
  console.log(path);
}
NODE
```

List `dist/social/posts/*.png` and `/tmp/xmo-social-card-review/*.png`, then use the local image viewer on every file, not only one sample. Confirm:

- fixed paper/panel/ink/terracotta/moss palette;
- left/right `71% / 29%` balance and at least `80px` safe space on every side of the left column;
- `XMO / NOTES`, title, metadata row, year, hollow stacked `XMO` and `LONG-TERM NOTES` all appear;
- short and long titles have no clipping or fourth line;
- the explicit no-column fixture does not leave a stray divider;
- the long-taxonomy fixture remains one line with clear ellipsis and an unobstructed date;
- no replacement glyph, blank text, transparency or article-cover imagery appears.

If a visual correction is needed, change `SOCIAL_CARD_RECIPE`, increment its `version`, add/adjust the relevant test, rebuild and re-inspect all cards.

- [ ] **Step 5: Request an independent code review and resolve findings**

Invoke the `requesting-code-review` skill against the complete feature branch. Review specifically for:

- hash/path drift between article route and endpoint;
- remote fetches or system-font fallback;
- unsafe title/string interpolation;
- title/date truthfulness and false `dateModified`;
- incomplete conditional metadata on ordinary pages;
- build inventory or orphan-image gaps;
- accidental Feishu, manifest, workflow or generated-PNG changes.

Fix every correctness, safety or acceptance finding, rerun focused tests and `npm run verify`, and re-inspect any changed cards.

- [ ] **Step 6: Commit any visual or review corrections before documentation**

Run:

```bash
git status --short
git diff --check
```

If Step 4 or Step 5 changed implementation/tests, stage only the affected files from this explicit allowlist and create the correction commit:

```bash
git add \
  package.json \
  package-lock.json \
  src/lib/social-card.ts \
  'src/pages/social/posts/[asset].png.ts' \
  src/layouts/BaseLayout.astro \
  src/layouts/PostLayout.astro \
  'src/pages/posts/[...id].astro' \
  tests/social-card.test.mjs \
  tests/toolchain.test.mjs \
  tests/ui-source.test.mjs \
  tests/build-output.test.mjs
git commit -m "fix: address social card review findings"
npm run verify
```

If there are no implementation/test changes, do not create an empty commit. In both cases, `git status --short` may now show only `docs/FEISHU_SETUP.md` and `tests/workflows.test.mjs`.

- [ ] **Step 7: Commit documentation after the review gate**

```bash
git add docs/FEISHU_SETUP.md tests/workflows.test.mjs
git commit -m "docs: document article sharing metadata"
```

Expected: the final feature branch is clean and contains no generated PNG or unrelated path.

---

### Task 9: Merge, deploy and verify the live GitHub Pages result

**Files:**

- Verify: `https://xmo2004.github.io/posts/published-from-feishu/`
- Verify: the article's emitted absolute `/social/posts/*.png` URL

- [ ] **Step 1: Integrate any scheduled Feishu update, then re-run the branch gate**

The scheduled sync can advance `origin/main` while the feature is being built. In the feature worktree, run:

```bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD
```

Expected: exit `0`. If it exits `1`, integrate the remote content commit without rewriting history, then re-run the complete gate:

```bash
git merge --no-edit origin/main
npm run verify
```

Whether a merge was needed or not, finish with:

```bash
npm run verify
git diff --check origin/main...HEAD
git status --short
git log --oneline --decorate origin/main..HEAD
git diff --name-status origin/main...HEAD
```

Expected: clean worktree; all checks pass; only files from the responsibility map changed; `dist`, `.playwright-cli`, Feishu generated paths, manifest and workflow files are absent. If the remote merge introduced generated Feishu changes, those appear only as the unchanged `origin/main` side of the comparison.

- [ ] **Step 2: Fast-forward the reviewed branch into main and remove the worktree**

In `/Users/xmo/Documents/Blog`:

```bash
git switch main
git merge --ff-only codex/article-social-cards
git worktree remove .worktrees/article-social-cards
git branch -d codex/article-social-cards
git status --short --branch
```

Expected: `main` contains the reviewed commits; the isolated worktree/branch are removed; `.playwright-cli/` remains untouched.

- [ ] **Step 3: Recheck the remote, push main and watch the exact deployment**

Immediately before pushing, close the remaining sync race:

```bash
git fetch origin
git merge-base --is-ancestor origin/main main
```

Expected: exit `0`. If it exits `1`, run the following in the main worktree and repeat the full verification before pushing:

```bash
git merge --no-edit origin/main
npm run verify
```

Push and capture the immutable deployment SHA:

```bash
DEPLOY_SHA=$(git rev-parse HEAD)
git push origin main
```

Locate only the push-triggered `Deploy site` run for that exact SHA, polling for at most 60 seconds:

```bash
DEPLOY_RUN_ID=''
for attempt in $(seq 1 30); do
  DEPLOY_RUN_ID=$(gh run list \
    --workflow deploy.yml \
    --branch main \
    --limit 30 \
    --json databaseId,headSha,event \
    --jq ".[] | select(.headSha == \"$DEPLOY_SHA\" and .event == \"push\") | .databaseId" \
    | head -n 1)
  if [ -n "$DEPLOY_RUN_ID" ]; then
    break
  fi
  sleep 2
done
test -n "$DEPLOY_RUN_ID"
gh run watch "$DEPLOY_RUN_ID" --exit-status
gh run view "$DEPLOY_RUN_ID" \
  --json headSha,conclusion,url \
  --jq '{headSha, conclusion, url}'
```

Expected: `headSha` equals `$DEPLOY_SHA`, conclusion is `success`, and both Verify/build and GitHub Pages deployment jobs succeeded. Do not accept an older green run.

- [ ] **Step 4: Verify the live article head and exact image bytes**

Run this complete acceptance script from the main worktree. It cache-busts only the HTML request and fetches the emitted image URL unchanged:

```bash
node --experimental-strip-types --input-type=module <<'NODE'
import assert from 'node:assert/strict';

import sharp from 'sharp';

import { SITE } from './src/config/site.ts';

const articleUrl = new URL(
  '/posts/published-from-feishu/',
  SITE.canonicalOrigin,
);
articleUrl.searchParams.set('acceptance', Date.now().toString());
const articleResponse = await fetch(articleUrl, {
  headers: { 'cache-control': 'no-cache' },
});
assert.equal(articleResponse.status, 200);
const html = await articleResponse.text();
const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/iu.exec(html);
assert.ok(headMatch);
const head = headMatch[1];
const namedEntities = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
};
const decode = (value) => value.replace(
  /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu,
  (source, decimal, hexadecimal, named) => {
    if (decimal !== undefined) {
      return String.fromCodePoint(Number.parseInt(decimal, 10));
    }
    if (hexadecimal !== undefined) {
      return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
    }
    return namedEntities[named?.toLowerCase()] ?? source;
  },
);
const attributes = (tag) => {
  const result = {};
  for (const match of tag.matchAll(
    /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu,
  )) {
    result[match[1].toLowerCase()] = decode(
      match[2] ?? match[3] ?? match[4] ?? '',
    );
  }
  return result;
};
const tags = (name) => [
  ...head.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'giu')),
].map(([tag]) => attributes(tag));
const meta = (selector, value) => tags('meta')
  .filter((item) => item[selector] === value)
  .map((item) => item.content);
const oneMeta = (selector, value) => {
  const values = meta(selector, value);
  assert.equal(values.length, 1, `${value} must occur once`);
  return values[0];
};
const titleMatch = /<title>([\s\S]*?)<\/title>/iu.exec(head);
assert.ok(titleMatch);
const documentTitle = decode(titleMatch[1]);
const canonicalLinks = tags('link').filter((link) =>
  link.rel?.split(/\s+/u).includes('canonical'),
);
assert.equal(canonicalLinks.length, 1);
const canonicalUrl = canonicalLinks[0].href;
const jsonLdMatch = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/iu.exec(
  head,
);
assert.ok(jsonLdMatch);
const jsonLd = JSON.parse(jsonLdMatch[1]);
const ogImage = oneMeta('property', 'og:image');
const imageUrl = new URL(ogImage);
const expectedAlt =
  `“${jsonLd.headline}”文章分享卡片，来自 ${SITE.mark}`;

assert.ok(documentTitle.endsWith(` | ${SITE.name}`));
assert.notEqual(documentTitle, jsonLd.headline);
assert.equal(oneMeta('property', 'og:title'), jsonLd.headline);
assert.equal(oneMeta('name', 'twitter:title'), jsonLd.headline);
assert.equal(oneMeta('property', 'og:type'), 'article');
assert.equal(oneMeta('name', 'twitter:card'), 'summary_large_image');
assert.equal(oneMeta('property', 'og:url'), canonicalUrl);
assert.equal(jsonLd['@id'], `${canonicalUrl}#article`);
assert.equal(jsonLd.url, canonicalUrl);
assert.equal(jsonLd.mainEntityOfPage['@id'], canonicalUrl);
assert.equal(imageUrl.protocol, 'https:');
assert.equal(imageUrl.origin, SITE.canonicalOrigin);
assert.match(
  imageUrl.pathname,
  /^\/social\/posts\/published-from-feishu-[a-f0-9]{16}\.png$/u,
);
assert.equal(oneMeta('property', 'og:image:secure_url'), ogImage);
assert.equal(oneMeta('name', 'twitter:image'), ogImage);
assert.equal(jsonLd.image.url, ogImage);
assert.equal(oneMeta('property', 'og:image:type'), 'image/png');
assert.equal(oneMeta('property', 'og:image:width'), '1200');
assert.equal(oneMeta('property', 'og:image:height'), '630');
assert.equal(oneMeta('property', 'og:image:alt'), expectedAlt);
assert.equal(oneMeta('name', 'twitter:image:alt'), expectedAlt);
assert.equal(
  oneMeta('property', 'article:published_time'),
  jsonLd.datePublished,
);
assert.equal(
  oneMeta('property', 'article:section'),
  jsonLd.articleSection,
);
assert.deepEqual(
  meta('property', 'article:tag'),
  jsonLd.keywords ?? [],
);
assert.deepEqual(meta('property', 'article:modified_time'), []);
assert.equal(Object.hasOwn(jsonLd, 'dateModified'), false);
assert.deepEqual(meta('property', 'article:author'), []);
assert.deepEqual(meta('name', 'twitter:site'), []);
assert.deepEqual(meta('name', 'twitter:creator'), []);
assert.equal(jsonLd.author['@type'], 'Person');
assert.equal(jsonLd.publisher['@type'], 'Person');
assert.equal(jsonLd.inLanguage, 'zh-CN');
assert.equal(jsonLd.isAccessibleForFree, true);
assert.doesNotMatch(
  JSON.stringify(jsonLd),
  /"(?:logo|sameAs)"|"@type":"Organization"/u,
);

const imageResponse = await fetch(imageUrl);
assert.equal(imageResponse.status, 200);
assert.equal(
  imageResponse.headers.get('content-type')?.split(';')[0],
  'image/png',
);
const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
const imageMetadata = await sharp(imageBytes, {
  failOn: 'error',
}).metadata();
assert.equal(imageMetadata.format, 'png');
assert.equal(imageMetadata.width, 1200);
assert.equal(imageMetadata.height, 630);
assert.equal(imageMetadata.hasAlpha, false);
assert.equal(imageMetadata.isPalette, true);
assert.ok(imageBytes.byteLength <= 350 * 1024);
await sharp(imageBytes, { failOn: 'error' }).raw().toBuffer();

console.log({
  article: canonicalUrl,
  image: ogImage,
  imageBytes: imageBytes.byteLength,
  publishedTime: jsonLd.datePublished,
  tags: jsonLd.keywords ?? [],
});
NODE
```

Expected: the script exits `0` and prints the canonical article URL, exact hashed image URL, PNG byte count, publication time and tags.

- [ ] **Step 5: Trigger and verify one real Feishu synchronization build**

Record the live main SHA and dispatch time, then trigger the existing workflow from `main`:

```bash
git fetch origin
SYNC_HEAD=$(git rev-parse origin/main)
SYNC_STARTED=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
gh workflow run sync-feishu.yml --ref main
SYNC_RUN_ID=''
for attempt in $(seq 1 30); do
  SYNC_RUN_ID=$(gh run list \
    --workflow sync-feishu.yml \
    --event workflow_dispatch \
    --branch main \
    --limit 30 \
    --json databaseId,headSha,createdAt \
    --jq ".[] | select(.headSha == \"$SYNC_HEAD\" and .createdAt >= \"$SYNC_STARTED\") | .databaseId" \
    | head -n 1)
  if [ -n "$SYNC_RUN_ID" ]; then
    break
  fi
  sleep 2
done
test -n "$SYNC_RUN_ID"
gh run watch "$SYNC_RUN_ID" --exit-status
gh run view "$SYNC_RUN_ID" \
  --json headSha,conclusion,jobs,url \
  --jq '{headSha, conclusion, jobs: [.jobs[] | {name, conclusion}], url}'

git fetch origin
POST_SYNC_SHA=$(git rev-parse origin/main)
git log -1 --format='%H %s' origin/main
if [ "$POST_SYNC_SHA" != "$SYNC_HEAD" ]; then
  test "$(git log -1 --format='%s' origin/main)" = \
    'content: sync Feishu posts'
  git pull --ff-only origin main
fi
```

Expected: exact `headSha=$SYNC_HEAD`, overall success, and `Verify synchronized site` succeeds. If content is unchanged, the deploy job is skipped by design but the new card build has still been verified. If content changed, the workflow creates a `content: sync Feishu posts` commit, its own `Deploy synchronized site` job succeeds, the subject assertion passes and the new commit is pulled locally.

- [ ] **Step 6: Reconcile the possible sync commit and repeat live acceptance**

```bash
git fetch origin
git pull --ff-only origin main
```

The pull is a safe no-op when Step 5 already reconciled the remote state. Whether content changed or not, rerun the complete live acceptance script from Step 4. This confirms the final Pages state after the Feishu workflow, not only the earlier ordinary deployment.

- [ ] **Step 7: Perform browser acceptance and final repository audit**

Open the live article in the in-app browser. Confirm the visible article layout did not change, navigation and theme control still work, and the console has no errors. Directly open the exact social PNG printed by Step 4 once to confirm GitHub Pages serves it.

Then run:

```bash
git fetch origin
git rev-list --left-right --count origin/main...main
git status --short --branch
```

Expected: `0 0`; only the preserved unrelated `.playwright-cli/` path is untracked. Report the final deployed SHA, ordinary deploy run, Feishu sync run, live article URL, image URL, PNG byte size and final verification totals.

---

## Rollback boundary

If live acceptance fails, create a normal revert of the feature commits and push it; never force-push or reset shared history. The next clean Pages build stops emitting `/social/posts/*.png`, article metadata returns to the earlier text-only form, and Feishu content/media/manifest data remains unchanged. External platforms may temporarily retain cached old image URLs, but the live blog and subsequent deployments are restored independently.
