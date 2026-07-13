# Article Title Wrapping Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the long Feishu publishing article title on one line at 1117px and 1440px without changing the existing mobile wrapping or widening the article header.

**Architecture:** Preserve the existing `.post-header` width, fluid type ratio and mobile override. Add one source-level regression assertion for the desktop title clamp, then lower only the desktop maximum from `4rem` to `3.5rem`; deploy the static site and confirm real layout metrics at three viewport widths.

**Tech Stack:** Astro 7, CSS, Node.js test runner, GitHub Pages, in-app browser.

---

## File responsibility map

- Modify `tests/ui-source.test.mjs` — lock the desktop article-title font clamp to the approved `3.5rem` maximum while retaining the existing `max-width: none` invariant.
- Modify `src/styles/global.css` — lower only the desktop `.post-header h1` maximum; leave the mobile media-query override unchanged.
- Do not modify content, layout components, generated Feishu files, publishing workflows or the unrelated `.playwright-cli/` directory.

### Task 1: Add the regression gate and make the minimal CSS correction

**Files:**

- Modify: `tests/ui-source.test.mjs`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Write the failing source test**

Replace the current article-title assertion in `tests/ui-source.test.mjs` with:

```js
assert.match(
  styles,
  /\.post-header h1\s*\{(?=[^}]*max-width:\s*none;)(?=[^}]*font-size:\s*clamp\(2\.2rem,\s*4\.4vw,\s*3\.5rem\);)[^}]*\}/s,
);
```

- [ ] **Step 2: Run the focused test and prove it fails for the old maximum**

Run:

```bash
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  node --experimental-strip-types --test \
  --test-name-pattern="global layout keeps dense editorial scanning" \
  tests/ui-source.test.mjs
```

Expected: the named test fails because `src/styles/global.css` still contains `clamp(2.2rem, 4.4vw, 4rem)`.

- [ ] **Step 3: Implement the approved desktop clamp**

Change only the desktop title rule in `src/styles/global.css`:

```css
.post-header h1 {
  max-width: none;
  margin-block-end: var(--space-3);
  font-size: clamp(2.2rem, 4.4vw, 3.5rem);
  line-height: 1.08;
}
```

Keep the existing mobile rule unchanged:

```css
.post-header h1 {
  font-size: clamp(2rem, 10vw, 3rem);
}
```

- [ ] **Step 4: Run the focused test and full verification**

Run:

```bash
env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  node --experimental-strip-types --test \
  --test-name-pattern="global layout keeps dense editorial scanning" \
  tests/ui-source.test.mjs

env PATH="/Users/xmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  npm run verify
```

Expected: the focused test passes; all project tests pass; Astro reports zero errors, warnings and hints; the production build completes.

- [ ] **Step 5: Commit the tested correction**

Run:

```bash
git add tests/ui-source.test.mjs src/styles/global.css
git commit -m "fix: balance article title wrapping"
```

Expected: the commit contains only the test and CSS change.

### Task 2: Deploy and verify the real page at three widths

**Files:**

- Verify: `https://xmo2004.github.io/posts/published-from-feishu/`

- [ ] **Step 1: Push `main` and wait for the Pages deployment**

Run:

```bash
git push origin main
gh run list --workflow deploy.yml --limit 1
gh run watch --exit-status
```

Expected: the deployment for the pushed commit succeeds.

- [ ] **Step 2: Measure the live title at 1117px and 1440px**

At each width, inspect the title's `Range#getClientRects()` line boxes and the document overflow metrics.

Expected at both widths:

```text
titleLineCount = 1
document.scrollWidth <= document.clientWidth
```

- [ ] **Step 3: Measure the live title at 320px**

Expected:

```text
titleLineCount <= 3
document.scrollWidth <= document.clientWidth
```

The title may wrap naturally; no line may be clipped.

- [ ] **Step 4: Finish visual and runtime acceptance**

Confirm the article header remains compact, the body/TOC alignment is unchanged, the browser console has zero errors, and the title is not obscured by the sticky header. Reset the browser viewport and leave the public home page open.
