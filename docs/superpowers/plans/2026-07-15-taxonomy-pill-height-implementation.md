# Compact Taxonomy Pills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce every category, column, and tag pill to a shared 36px visual height while preserving an approximately 44px vertical hit target and leaving unrelated controls unchanged.

**Architecture:** Add reusable taxonomy-pill height tokens and one global `.taxonomy-pill` base class in `src/styles/global.css`. Apply that class from the two existing taxonomy renderers, while keeping category, column, and tag selectors responsible only for their visual variants. Protect the contract with source tests, then verify the built Astro site in desktop and mobile browser viewports.

**Tech Stack:** Astro 7, semantic HTML, global CSS custom properties and pseudo-elements, Node test runner, Astro check/build, in-app browser QA.

---

### Task 1: Add a failing shared-pill contract test

**Files:**
- Modify: `tests/ui-source.test.mjs`
- Test: `tests/ui-source.test.mjs`

- [ ] **Step 1: Replace the old 44px tag assertions with the new shared contract**

In `global styles define the editorial tokens and accessibility safeguards`, replace the two assertions that require `.tag-list a` and `.tag-list--compact a` to use `2.75rem` with:

```js
  assert.match(source, /--taxonomy-pill-height:\s*2\.25rem/i);
  assert.match(source, /--taxonomy-pill-hit-height:\s*2\.75rem/i);
  assert.match(
    source,
    /\.taxonomy-pill\s*\{(?=[^}]*min-height:\s*var\(--taxonomy-pill-height\);)(?=[^}]*position:\s*relative;)(?=[^}]*border-radius:\s*999px;)[^}]*\}/s,
  );
  assert.match(
    source,
    /\.taxonomy-pill::before\s*\{(?=[^}]*position:\s*absolute;)(?=[^}]*inset-block:\s*calc\()[^}]*content:\s*['"]{2};[^}]*\}/s,
  );
  assert.doesNotMatch(
    source,
    /\.(?:tag-list(?:--compact)? a|post-header__category|post-header__column)\s*\{[^}]*min-height:\s*2\.75rem;/s,
  );
```

- [ ] **Step 2: Add a renderer contract test after the global-style test**

Add:

```js
test('taxonomy renderers reuse the compact shared pill class', async () => {
  const [tagList, postLayout] = await Promise.all([
    readSource('src/components/TagList.astro'),
    readSource('src/layouts/PostLayout.astro'),
  ]);

  assert.match(
    tagList,
    /<a\s+(?=[^>]*class=["'][^"']*\btaxonomy-pill\b[^"']*["'])(?=[^>]*class=["'][^"']*\btaxonomy-pill--tag\b[^"']*["'])[^>]*>/,
  );
  assert.match(
    postLayout,
    /<a\s+(?=[^>]*class=["'][^"']*\btaxonomy-pill\b[^"']*["'])(?=[^>]*class=["'][^"']*\bpost-header__category\b[^"']*["'])[^>]*>/,
  );
  assert.match(
    postLayout,
    /<a\s+(?=[^>]*class=["'][^"']*\btaxonomy-pill\b[^"']*["'])(?=[^>]*class=["'][^"']*\bpost-header__column\b[^"']*["'])[^>]*>/,
  );
});
```

- [ ] **Step 3: Run the focused test and verify the contract fails**

Run:

```sh
npm test -- --test-name-pattern='editorial tokens|taxonomy renderers'
```

Expected: FAIL because the height tokens and `.taxonomy-pill` classes do not exist yet, and the old selectors still declare `2.75rem`.

### Task 2: Implement the shared 36px taxonomy pill

**Files:**
- Modify: `src/styles/global.css`
- Modify: `src/components/TagList.astro`
- Modify: `src/layouts/PostLayout.astro`
- Test: `tests/ui-source.test.mjs`

- [ ] **Step 1: Add the pill tokens to `:root`**

Place these after the radius tokens in `src/styles/global.css`:

```css
  --taxonomy-pill-height: 2.25rem;
  --taxonomy-pill-hit-height: 2.75rem;
```

- [ ] **Step 2: Add the shared base class before `.tag-list`**

Insert:

```css
.taxonomy-pill {
  position: relative;
  min-height: var(--taxonomy-pill-height);
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 999px;
  text-decoration: none;
}

.taxonomy-pill::before {
  position: absolute;
  inset-block: calc(
    (var(--taxonomy-pill-hit-height) - var(--taxonomy-pill-height)) / -2
  );
  inset-inline: 0;
  content: '';
}
```

The vertical expansion is 4px above and below: 36px visible height plus 8px transparent hit area equals 44px. The existing 8px row gap prevents adjacent wrapped pills from overlapping.

- [ ] **Step 3: Apply the class in `TagList.astro`**

Change the tag anchor to:

```astro
<a class="taxonomy-pill taxonomy-pill--tag" href={`/tags/${normalizeTag(tag)}/`}>
  {tag}
</a>
```

- [ ] **Step 4: Apply the class to article category and column links**

Change the two anchors in `src/layouts/PostLayout.astro` to:

```astro
<a
  class="taxonomy-pill post-header__category"
  href={getCategoryHref(category)}
>
  {category}
</a>
```

and:

```astro
<a
  class="taxonomy-pill post-header__column"
  href={getColumnHref(column)}
>
```

- [ ] **Step 5: Remove duplicated geometry from variant selectors**

Reduce `.tag-list a` to variant declarations only:

```css
.tag-list a {
  padding-inline: var(--space-3);
  color: var(--muted);
  font-size: 0.875rem;
  font-weight: 600;
}
```

Reduce the compact rule to:

```css
.tag-list--compact a {
  padding-inline: var(--space-2);
  font-size: 0.8rem;
}
```

Reduce the article-pill shared variant rule to:

```css
.post-header__category,
.post-header__column {
  padding-inline: var(--space-3);
  font-size: 0.8rem;
  font-weight: 650;
}
```

Do not alter category fill, column color, hover states, typography, or spacing.

- [ ] **Step 6: Run the focused test and verify it passes**

Run:

```sh
npm test -- --test-name-pattern='editorial tokens|taxonomy renderers'
```

Expected: both matching tests PASS and the process exits 0.

- [ ] **Step 7: Commit the tested implementation**

```sh
git add tests/ui-source.test.mjs src/styles/global.css src/components/TagList.astro src/layouts/PostLayout.astro
git commit -m "style: compact taxonomy pills"
```

### Task 3: Verify the complete site and the visual result

**Files:**
- Verify: `src/styles/global.css`
- Verify: `src/components/TagList.astro`
- Verify: `src/layouts/PostLayout.astro`

- [ ] **Step 1: Run the full project verification**

Run:

```sh
npm run verify
```

Expected: all Node tests pass, Astro reports 0 errors, and the production build exits 0.

- [ ] **Step 2: Start the local Astro preview**

Run:

```sh
npm run dev -- --host 127.0.0.1
```

Expected: Astro reports a local URL, normally `http://127.0.0.1:4321/`.

- [ ] **Step 3: Verify the selected article at desktop width**

Open `/posts/internship-day-one/` at approximately 853px wide and confirm:

- “成长”, the column pill, and all tag pills have a computed visible height of 36px.
- Text remains vertically centered and no label is clipped.
- The row wraps without overlap when the viewport is narrowed.
- Category fill, column outline, tag outline, hover, and focus styles remain intact.
- The browser console has no new errors or warnings.

- [ ] **Step 4: Verify a tag page and mobile layout**

Open a rendered tag page and the same article at 390px wide. Confirm that all `TagList` pills remain 36px tall, long labels wrap at pill boundaries rather than inside a pill, the extended hit areas do not overlap, and horizontal page overflow is absent.

- [ ] **Step 5: Review the final diff and worktree state**

Run:

```sh
git diff HEAD^ --check
git status --short
```

Expected: no whitespace errors. Only pre-existing unrelated untracked files may remain; `.playwright-cli/` and `src/content/posts/manual/internship-day-one.md` must not be staged or modified by this task.
