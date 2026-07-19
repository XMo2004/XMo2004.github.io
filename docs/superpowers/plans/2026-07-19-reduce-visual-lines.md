# 全站柔和纸面减线视觉优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变博客结构、内容与交互逻辑的前提下，用柔和纸面色差和留白替代重复装饰线，同时保留所有功能性、可访问性与飞书内容语义边界。

**Architecture:** 继续使用现有 Astro 组件与 class，不改变 DOM、路由或数据流。全部生产改动集中在 `src/styles/global.css`：先增加明暗主题纸面 token，再按“全站骨架 → 索引项目 → 文章与搜索 → 响应式”逐层替换边线。`tests/design-contrast.test.mjs` 负责新 token 的精确值和 WCAG AA，`tests/ui-source.test.mjs` 通过现有 CSS 级联解析器锁定桌面与移动端的最终样式，并明确保护搜索、表格、引用、焦点与飞书语义边界。

**Tech Stack:** Astro 7、原生 CSS、自带 Node.js test runner、Astro check/build、Playwright 浏览器验收

---

## 实施约束

- 以设计规格 `docs/superpowers/specs/2026-07-19-reduce-visual-lines-design.md` 为唯一视觉依据。
- 不修改页面或组件 DOM；若现有选择器足够，就只改 CSS。
- 不修改 `src/styles/feishu-content.css`，除非浏览器验收证明新增纸面 token 造成实际对比度问题；Callout 与 Source Synced 的语义边界必须保留。
- 不调整 `--line`，避免连带削弱输入框、表格、引用与内容语义。
- 不增加依赖，不引入通用卡片组件，也不把删除的线批量替换成阴影。
- 每项任务严格执行 RED → GREEN → 重跑相关测试 → 提交；不得把多个任务合并成一个大提交。
- 本地浏览器验收文章只用于任务 6，必须在 `finally` 风格的收尾步骤删除，绝不提交。

### 运行时前置检查

仓库 `.nvmrc` 要求 Node 24，且 Astro 7 要求 Node `>=22.12.0`。当前系统默认 `/usr/local/bin/node` 是 Node 20，因此本计划所有 `node`、`npm` 与 `npx` 命令都必须显式把 Homebrew 的 Node 24 放在 PATH 首位。

- [ ] **在开始 Task 1 前确认 Node 24**

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" node --version
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm --version
```

Expected: Node 输出 `v24.1.0`，npm 输出 `11.4.1`；若该绝对路径失效，先找到满足 `.nvmrc` 的 Node 24 安装，不得用 Node 20 运行 Astro 门禁。

## Task 1：新增柔和纸面层级 token 与对比度契约

**Files:**

- Modify: `tests/design-contrast.test.mjs`
- Modify: `src/styles/global.css`

- [ ] **Step 1：先为两个主题写失败的 token 与对比度测试**

在 `tests/design-contrast.test.mjs` 的语义强调色测试之后加入：

```js
test('soft paper hierarchy uses approved colors and meets WCAG AA', async () => {
  const source = await readFile(
    new URL('../src/styles/global.css', import.meta.url),
    'utf8',
  );
  const themes = themeTokens(source);
  const expected = {
    light: {
      'paper-soft': '#f8f4ec',
      'paper-interactive': '#eee8dd',
    },
    dark: {
      'paper-soft': '#1c201c',
      'paper-interactive': '#252a25',
    },
  };

  for (const [themeName, tokens] of Object.entries(themes)) {
    for (const [tokenName, expectedColor] of Object.entries(expected[themeName])) {
      assert.equal(
        tokens[tokenName],
        expectedColor,
        `${themeName} --${tokenName} must use the approved color`,
      );

      for (const foregroundName of [
        'ink',
        'muted',
        'accent-text',
        'accent-hover',
      ]) {
        assertContrast(
          tokens,
          themeName,
          foregroundName,
          tokenName,
          'soft paper hierarchy',
        );
      }
    }
  }

  assert.match(
    source,
    /:root\s*\{[^}]*--shadow-header:\s*0 0\.35rem 1rem rgb\(29 33 29 \/ 4%\);/s,
  );
  assert.match(
    source,
    /:root\[data-theme=['"]dark['"]\]\s*\{[^}]*--shadow-header:\s*0 0\.35rem 1rem rgb\(0 0 0 \/ 10%\);/s,
  );
});
```

- [ ] **Step 2：运行测试并确认 RED**

Run:

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" node --test tests/design-contrast.test.mjs
```

Expected: FAIL，错误包含 `light --paper-soft must use the approved color`，证明测试确实因新 token 尚未定义而失败。

- [ ] **Step 3：在明暗主题定义精确 token**

在 `src/styles/global.css` 的 `:root` 中，紧跟现有纸面 token 增加：

```css
--paper-soft: #f8f4ec;
--paper-interactive: #eee8dd;
--shadow-header: 0 0.35rem 1rem rgb(29 33 29 / 4%);
```

在 `:root[data-theme='dark']` 对应位置增加：

```css
--paper-soft: #1c201c;
--paper-interactive: #252a25;
--shadow-header: 0 0.35rem 1rem rgb(0 0 0 / 10%);
```

不得更改 `--paper`、`--paper-raised`、`--line` 或现有强调色。

- [ ] **Step 4：运行测试并确认 GREEN**

Run:

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" node --test tests/design-contrast.test.mjs
```

Expected: PASS；浅色与深色主题的四种前景色在两个新纸面上均达到 4.5:1。

- [ ] **Step 5：提交 token 契约**

```sh
git add tests/design-contrast.test.mjs src/styles/global.css
git commit -m "style: add soft paper hierarchy tokens"
```

## Task 2：将全站骨架与首页一级区块改为柔和纸面

**Files:**

- Modify: `tests/ui-source.test.mjs`
- Modify: `src/styles/global.css`

- [ ] **Step 1：为最终 CSS 级联增加可复用断言**

在 `effectiveCssDeclarations()` 后增加：

```js
function cssDeclarationsAt(source, target, viewportWidth = 1440) {
  return effectiveCssDeclarations(parseCssCascade(source), target, {
    viewportWidth,
    reducedMotion: false,
  });
}

function assertNoVisibleBorder(declarations, label) {
  const edgeProperties = new Set([
    'border',
    'border-top',
    'border-right',
    'border-bottom',
    'border-left',
    'border-block',
    'border-block-start',
    'border-block-end',
    'border-inline',
    'border-inline-start',
    'border-inline-end',
  ]);

  assert.ok(
    Object.keys(declarations).length > 0,
    `${label} must match at least one CSS declaration`,
  );

  for (const [property, value] of Object.entries(declarations)) {
    if (!edgeProperties.has(property)) continue;
    assert.match(
      value,
      /^(?:0(?:\s|$)|none\b)/i,
      `${label} ${property} must not draw a visible border; received ${value}`,
    );
  }
}
```

该 helper 检查级联后的最终声明，因此后续媒体查询若重新引入边线也会被发现。

- [ ] **Step 2：先写全站骨架和首页的失败测试**

在首页样式测试附近增加：

```js
test('global shell and home sections use soft borderless surfaces', async () => {
  const styles = await readSource('src/styles/global.css');

  for (const selector of [
    '.site-header',
    '.site-footer',
    '.page-header',
    '.home-hero',
    '.home-taxonomy',
    '.home-section',
    '.section-heading',
    '.home-taxonomy__list',
    '.home-taxonomy__list a',
  ]) {
    assertNoVisibleBorder(cssDeclarationsAt(styles, selector), selector);
  }

  assert.equal(
    cssDeclarationsAt(styles, '.site-header')['box-shadow'],
    'var(--shadow-header)',
  );

  for (const selector of [
    '.page-header',
    '.home-hero',
    '.home-taxonomy',
    '.home-section',
  ]) {
    const declarations = cssDeclarationsAt(styles, selector);
    assert.equal(
      declarations.background,
      'var(--paper-soft)',
      `${selector} must use the primary soft paper`,
    );
    assert.ok(
      declarations['box-shadow'] === undefined || declarations['box-shadow'] === 'none',
      `${selector} must not gain a persistent shadow`,
    );
  }

  assert.equal(
    cssDeclarationsAt(styles, '.home-taxonomy__list a:hover').background,
    'var(--paper-interactive)',
  );
  assert.match(
    styles,
    /\.primary-nav a\[aria-current=['"]page['"]\]\s*\{(?=[^}]*text-decoration:\s*underline;)(?=[^}]*text-decoration-thickness:\s*0\.1em;)[^}]*\}/s,
    'the current navigation underline must remain visible',
  );
});
```

同时更新现有 `global layout keeps dense editorial scanning without shrinking reading text`：

- 将 `.home-section` 的 `padding-block-start: 3rem` 断言改成 `padding: var(--space-6)`。
- 保留首屏最小高度、首页两栏、标题间距、阅读字号与触控尺寸断言。
- 此步不要提前修改 `.post-row` 旧边线断言，它归 Task 3。

- [ ] **Step 3：运行测试并确认 RED**

Run:

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" node --test --test-name-pattern="global shell|global layout" tests/ui-source.test.mjs
```

Expected: FAIL，至少报告 `.site-header border-bottom`、`.page-header background` 或 `.home-hero background` 不符合新契约。

- [ ] **Step 4：实现全站骨架与首页一级纸面**

在 `src/styles/global.css` 做以下精确调整：

```css
.site-header {
  border-bottom: 0;
  box-shadow: var(--shadow-header);
}

.site-footer {
  margin-block-start: var(--space-8);
  border-top: 0;
}

.page-header {
  padding: var(--space-6);
  border-bottom: 0;
  border-radius: var(--radius-md);
  background: var(--paper-soft);
}

.home-hero {
  padding: var(--space-8);
  border-bottom: 0;
  border-radius: var(--radius-md);
  background: var(--paper-soft);
}

.home-taxonomy {
  margin-block-start: var(--space-4);
  padding: var(--space-5);
  border-bottom: 0;
  border-radius: var(--radius-md);
  background: var(--paper-soft);
}

.home-section {
  margin-block-start: var(--space-4);
  padding: var(--space-6);
  border-radius: var(--radius-md);
  background: var(--paper-soft);
}

.section-heading {
  padding-block-end: 0;
  border-bottom: 0;
}

.home-taxonomy__list {
  gap: var(--space-1);
  border-top: 0;
}

.home-taxonomy__list a {
  padding-inline: var(--space-2);
  border-bottom: 0;
  border-radius: var(--radius-sm);
}

.home-taxonomy__list a:hover {
  background: var(--paper-interactive);
}
```

保留 `.site-header` 已有的 `position`、半透明背景与 `backdrop-filter`；保留当前导航文字下划线。把 `.page-header` 的旧 `padding-block-end`、`.home-hero` 的旧 `padding-block`、`.home-taxonomy` 的旧 `padding-block` 和 `.home-section` 的旧 `padding-block-start` 直接替换为上述 `padding`，不要在同一规则留下竞争性 longhand，也不要在文件末尾叠加补丁规则。

- [ ] **Step 5：运行相关测试并确认 GREEN**

Run:

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" node --test --test-name-pattern="global shell|global layout|homepage and archive" tests/ui-source.test.mjs
```

Expected: PASS。

- [ ] **Step 6：提交骨架与首页改动**

```sh
git add tests/ui-source.test.mjs src/styles/global.css
git commit -m "style: soften global shell and homepage sections"
```

## Task 3：将卡片、文章行、目录、标签、关于页与代码改为无框结构

**Files:**

- Modify: `tests/ui-source.test.mjs`
- Modify: `src/styles/global.css`

- [ ] **Step 1：先把旧边线测试改成新无框契约**

在现有 `global layout keeps dense editorial scanning without shrinking reading text` 中，把 `.post-row` 的 `border-bottom` lookahead 替换为 `border: 0`、`border-radius: var(--radius-sm)` 与原有 grid 契约：

```js
assert.match(
  styles,
  /\.post-row\s*\{(?=[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);)(?=[^}]*border:\s*0;)(?=[^}]*border-radius:\s*var\(--radius-sm\);)[^}]*\}/s,
);
```

新增无框索引测试：

```js
test('cards, indexes, directories, and code use borderless hierarchy', async () => {
  const styles = await readSource('src/styles/global.css');
  const borderlessSelectors = [
    '.post-card',
    '.post-card__cover',
    '.post-row-list',
    '.post-row',
    '.empty-state',
    '.taxonomy-pill',
    '.taxonomy-directory__link',
    '.tag-directory__link',
    '.about-page__grid section',
    '.about-page__principle',
    'code',
    'pre',
  ];

  for (const selector of borderlessSelectors) {
    assertNoVisibleBorder(cssDeclarationsAt(styles, selector), selector);
  }

  assert.equal(cssDeclarationsAt(styles, '.post-card').background, 'var(--surface)');
  assert.equal(cssDeclarationsAt(styles, '.post-card')['box-shadow'], 'var(--shadow-soft)');
  assert.equal(cssDeclarationsAt(styles, '.empty-state').background, 'var(--paper-soft)');
  assert.equal(cssDeclarationsAt(styles, '.taxonomy-pill').background, 'var(--paper-interactive)');

  for (const selector of [
    '.taxonomy-directory__link',
    '.tag-directory__link',
    '.about-page__principle',
  ]) {
    assert.equal(cssDeclarationsAt(styles, selector).background, 'var(--paper-soft)');
  }

  for (const selector of [
    '.post-row:hover',
    '.post-row:focus-within',
    '.taxonomy-directory__link:hover',
    '.tag-directory__link:hover',
  ]) {
    assert.equal(
      cssDeclarationsAt(styles, selector).background,
      'var(--paper-interactive)',
      `${selector} must expose a visible interaction state`,
    );
  }

  assert.equal(
    cssDeclarationsAt(styles, '.about-page__principle')['box-shadow'],
    'none',
  );

  assert.match(
    styles,
    /\.post-card:has\(\.post-card__title:focus-visible\)\s*\{[^}]*box-shadow:\s*0 0 0 0\.1875rem[^;}]*var\(--focus-ring\)/s,
    'post-card focus feedback must survive border removal',
  );
});
```

- [ ] **Step 2：运行测试并确认 RED**

Run:

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" node --test --test-name-pattern="cards, indexes|global layout" tests/ui-source.test.mjs
```

Expected: FAIL，旧 `.post-row`、目录链接、胶囊、代码和关于页仍有边线。

- [ ] **Step 3：实现卡片与列表无框层级**

在 `src/styles/global.css` 原规则处修改：

```css
.card,
.post-card {
  border: 0;
}

.post-card__cover {
  border-inline-end: 0;
}

.taxonomy-pill {
  border: 0;
  background: var(--paper-interactive);
}

.post-row-list {
  gap: var(--space-1);
  border-top: 0;
}

.post-row {
  padding: var(--space-4) var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.post-row:hover,
.post-row:focus-within {
  background: var(--paper-interactive);
}

.post-row:hover {
  transform: translate3d(0.125rem, 0, 0);
}

.empty-state {
  border: 0;
  background: var(--paper-soft);
}
```

并删除卡片 hover 的 `border-color` 过渡/赋值、`.post-row:hover` 的砖红左线和 `.post-row:focus-within` 的焦点左线。`.post-card:has(.post-card__title:focus-visible)` 只保留清晰的焦点 `box-shadow`，不再依赖 `border-color`。

- [ ] **Step 4：实现目录、关于页和代码的无框层级**

将两个目录链接改为：

```css
.taxonomy-directory__link,
.tag-directory__link {
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--paper-soft);
}

.taxonomy-directory__link:hover,
.tag-directory__link:hover {
  background: var(--paper-interactive);
  color: var(--accent-hover);
}
```

将关于页与代码调整为：

```css
.about-page__grid section {
  border-top: 0;
}

.about-page__principle {
  border: 0;
  background: var(--paper-soft);
  box-shadow: none;
}

code,
pre {
  border: 0;
}
```

保留 `code`/`pre` 原有背景、圆角、字体和溢出规则。分类实色胶囊 `.post-header__category` 继续用 `--accent-text` 背景，不重新增加边线。

- [ ] **Step 5：运行相关测试并确认 GREEN**

Run:

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" node --test --test-name-pattern="cards, indexes|global layout|tag page touch targets" tests/ui-source.test.mjs
```

Expected: PASS；44px 热区与 36px 胶囊可见高度仍满足原契约。

- [ ] **Step 6：提交索引与目录改动**

```sh
git add tests/ui-source.test.mjs src/styles/global.css
git commit -m "style: replace bordered indexes with soft surfaces"
```

## Task 4：柔化文章阅读页与搜索内部边界，并保护语义线

**Files:**

- Modify: `tests/ui-source.test.mjs`
- Modify: `src/styles/global.css`
- Verify only: `src/styles/feishu-content.css`

- [ ] **Step 1：更新文章发现与搜索的旧测试期望**

修改现有 `search responsive states expose focus, selection, and archive recovery`，将当前结果背景从 `var(--paper)` 改为 `var(--paper-interactive)`，继续要求 `outline: 1px solid var(--accent-text)`。

修改现有 `PostLayout discovery styles stay dense, accessible, and responsive`：

- `.post-series-navigation` 改为要求 `border-top: 0`。
- `.post-series-navigation__link` 背景改为 `var(--paper-soft)`，并要求 `border: 0`。
- `.related-post-list` 改为要求 `border-top: 0`。
- 保留网格、最小触控高度、focus outline、响应式单列和 reduced-motion 断言。

- [ ] **Step 2：新增“删除装饰线、保留语义线”的失败测试**

```js
test('article and search surfaces remove decoration without losing semantic boundaries', async () => {
  const [styles, feishuStyles] = await Promise.all([
    readSource('src/styles/global.css'),
    readSource('src/styles/feishu-content.css'),
  ]);

  for (const selector of [
    '.post-header',
    '.post-toc',
    '.post-toc-compact',
    '.post-pagination',
    '.post-pagination a',
    '.post-series-navigation',
    '.post-series-navigation__link',
    '.related-post-list',
    '.related-post',
    '.search-dialog__header',
    '.search-dialog__result',
  ]) {
    assertNoVisibleBorder(cssDeclarationsAt(styles, selector), selector);
  }

  for (const selector of ['.post-header', '.post-toc', '.post-toc-compact']) {
    assert.equal(cssDeclarationsAt(styles, selector).background, 'var(--paper-soft)');
  }

  for (const selector of ['.post-pagination a', '.post-series-navigation__link']) {
    assert.equal(cssDeclarationsAt(styles, selector).background, 'var(--paper-soft)');
  }

  assert.equal(
    cssDeclarationsAt(styles, '.search-dialog__result a:hover').background,
    'var(--paper-interactive)',
  );
  assert.equal(
    cssDeclarationsAt(styles, ".search-dialog__result a[aria-current='true']").background,
    'var(--paper-interactive)',
  );

  assert.match(styles, /\.search-dialog\s*\{[^}]*border:[^;}]*var\(--line\);/s);
  assert.match(styles, /\.search-dialog__input\s*\{[^}]*border:[^;}]*var\(--line\);/s);
  assert.match(styles, /blockquote\s*\{[^}]*border-inline-start:[^;}]*var\(--moss\);/s);
  assert.match(styles, /th,\s*td\s*\{[^}]*border-bottom:[^;}]*var\(--line\);/s);
  assert.match(styles, /hr\s*\{[^}]*border-top:[^;}]*var\(--line\);/s);
  assert.match(
    feishuStyles,
    /\.prose \.feishu-callout,\s*\.prose \.feishu-source-synced\s*\{[^}]*border:\s*1px solid transparent;/s,
  );
  assert.match(
    feishuStyles,
    /\.prose \.feishu-source-synced\s*\{[^}]*border-color:\s*var\(--line\);/s,
  );
});
```

如果现有表格选择器顺序不是 `th, td`，应让正则匹配当前真实选择器，而不是改变生产选择器来迎合测试。

- [ ] **Step 3：运行测试并确认 RED**

Run:

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" node --test --test-name-pattern="article and search|PostLayout discovery styles|search responsive states" tests/ui-source.test.mjs
```

Expected: FAIL，文章头部、目录、尾部导航及搜索结果仍使用旧边线或旧背景。

- [ ] **Step 4：实现搜索内部减线**

在 `src/styles/global.css` 原规则处调整：

```css
.search-dialog__header {
  border-bottom: 0;
}

.search-dialog__result {
  border-top: 0;
}

.search-dialog__result a:hover,
.search-dialog__result a[aria-current='true'] {
  background: var(--paper-interactive);
}
```

搜索弹窗外框、输入框边界、`:focus-visible` 和当前结果 outline 原样保留。

- [ ] **Step 5：实现文章头部、目录与尾部发现区纸面**

```css
.post-header {
  padding: var(--space-6);
  border-bottom: 0;
  border-radius: var(--radius-md);
  background: var(--paper-soft);
}

.post-toc {
  padding: var(--space-4);
  border-top: 0;
  border-radius: var(--radius-md);
  background: var(--paper-soft);
}

.post-toc-compact {
  padding-inline: var(--space-4);
  border-block: 0;
  border-radius: var(--radius-md);
  background: var(--paper-soft);
}

.post-pagination,
.post-series-navigation,
.related-post-list {
  border-top: 0;
}

.post-pagination a,
.post-series-navigation__link {
  border: 0;
  background: var(--paper-soft);
}

.post-pagination a:hover,
.post-series-navigation__link:hover {
  background: var(--paper-interactive);
}

.related-post-list__items {
  display: grid;
  gap: var(--space-1);
}

.related-post {
  padding: var(--space-4) var(--space-3);
  border-bottom: 0;
  border-radius: var(--radius-sm);
}

.related-post:hover,
.related-post:focus-within {
  background: var(--paper-interactive);
}
```

相应 transition 删除 `border-color`，只保留 background/color/transform。不要修改正文 `.prose` 容器背景，不要给普通文章尾部区块增加阴影。

- [ ] **Step 6：运行相关测试并确认 GREEN**

Run:

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" node --test --test-name-pattern="article and search|PostLayout discovery styles|search responsive" tests/ui-source.test.mjs
PATH="/opt/homebrew/opt/node@24/bin:$PATH" node --test tests/design-contrast.test.mjs
```

Expected: PASS；飞书语义边界断言也必须通过，且 `src/styles/feishu-content.css` 仍无改动。

- [ ] **Step 7：提交文章与搜索改动**

```sh
git add tests/ui-source.test.mjs src/styles/global.css
git commit -m "style: soften article discovery and search surfaces"
```

## Task 5：锁定移动端的无框层级与紧凑内边距

**Files:**

- Modify: `tests/ui-source.test.mjs`
- Modify: `src/styles/global.css`

- [ ] **Step 1：写移动端最终级联的失败测试**

```js
test('soft borderless hierarchy survives narrow-screen overrides', async () => {
  const styles = await readSource('src/styles/global.css');

  for (const selector of [
    '.page-header',
    '.home-hero',
    '.home-taxonomy',
    '.home-section',
    '.post-card__cover',
    '.post-header',
    '.post-toc-compact',
    '.post-pagination',
    '.post-series-navigation',
    '.related-post-list',
  ]) {
    assertNoVisibleBorder(cssDeclarationsAt(styles, selector, 320), `${selector} at 320px`);
  }

  assertNoVisibleBorder(
    cssDeclarationsAt(
      styles,
      '.post-grid:not(.post-grid--featured) .post-card__cover',
      800,
    ),
    'standard post-card cover at 800px',
  );

  for (const selector of [
    '.page-header',
    '.home-hero',
    '.home-taxonomy',
    '.home-section',
    '.post-header',
    '.post-toc-compact',
  ]) {
    assert.equal(
      cssDeclarationsAt(styles, selector, 320).background,
      'var(--paper-soft)',
      `${selector} must keep its soft surface at 320px`,
    );
  }

  for (const selector of [
    '.page-header',
    '.home-hero',
    '.home-taxonomy',
    '.home-section',
    '.post-header',
  ]) {
    const declarations = cssDeclarationsAt(styles, selector, 320);
    assert.equal(
      declarations.padding,
      'var(--space-4)',
      `${selector} must use compact mobile padding`,
    );
    for (const property of [
      'padding-block',
      'padding-block-start',
      'padding-block-end',
    ]) {
      assert.equal(
        declarations[property],
        undefined,
        `${selector} must not keep a competing ${property}`,
      );
    }
  }
});
```

- [ ] **Step 2：运行测试并确认 RED**

Run:

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" node --test --test-name-pattern="soft borderless hierarchy survives" tests/ui-source.test.mjs
```

Expected: FAIL；现有 `64rem`/`48rem` 规则会重新引入封面边线，且新一级纸面尚未统一为移动端紧凑 padding。

- [ ] **Step 3：修正响应式覆盖，不重建桌面规则**

在现有媒体查询中直接替换相关声明：

```css
@media (max-width: 64rem) {
  .post-grid:not(.post-grid--featured) .post-card__cover {
    border-inline-end: 0;
    border-bottom: 0;
  }
}

@media (max-width: 48rem) {
  .page-header,
  .home-hero,
  .home-taxonomy,
  .home-section,
  .post-header {
    padding: var(--space-4);
  }

  .post-card__cover {
    border-bottom: 0;
  }
}
```

删除移动端 `.home-hero` 的旧 `padding-block`、`.home-section` 的旧 `padding-block-start` 和 `.post-header` 的旧 `padding-block-start`，避免它们覆盖统一的完整纸面内边距。保留所有网格转单列、导航横向滚动、TOC 折叠、触控尺寸和图片隐藏逻辑。

- [ ] **Step 4：运行样式测试并确认 GREEN**

Run:

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" node --test tests/ui-source.test.mjs
PATH="/opt/homebrew/opt/node@24/bin:$PATH" node --test tests/design-contrast.test.mjs
```

Expected: 两个测试文件全部 PASS，无旧边线测试残留。

- [ ] **Step 5：提交响应式改动**

```sh
git add tests/ui-source.test.mjs src/styles/global.css
git commit -m "style: preserve soft hierarchy on small screens"
```

## Task 6：完整自动化与四组合浏览器验收

**Files:**

- Temporary create/delete only: `src/content/posts/manual/reduce-visual-lines-qa.md`
- Verify: `src/styles/global.css`
- Verify: `src/styles/feishu-content.css`
- Verify: `tests/design-contrast.test.mjs`
- Verify: `tests/ui-source.test.mjs`

- [ ] **Step 1：运行完整门禁**

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run verify
```

Expected:

- Node 测试全部通过（基线为 569 项；以本分支新增测试后的实际总数为准）。
- Astro check 为 `0 errors / 0 warnings / 0 hints`。
- 生产构建成功。

若失败，只修复本计划范围内的 CSS/测试契约；不要更新快照或删除无关测试来制造绿色结果。

- [ ] **Step 2：生成本地飞书富内容验收文章**

先从既有夹具把页面内容打印到终端，避免手工构造与真实转换器不一致：

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" node --input-type=module - <<'NODE'
import { readFile } from 'node:fs/promises';
import { blocksToMarkdown } from './scripts/feishu/blocks.mjs';

const fixture = JSON.parse(
  await readFile('./tests/fixtures/feishu-rich-content.json', 'utf8'),
);
const converted = blocksToMarkdown(structuredClone(fixture.items));
const body = converted.mediaReferences.reduce(
  (value, { placeholder }) => value.replaceAll(placeholder, '/favicon.svg'),
  converted.markdown,
);
const frontmatter = `---
title: 减线视觉浏览器验收
description: 仅用于本地视觉验收
pubDate: 2026-07-19
category: 工程
tags:
  - 飞书
featured: false
slug: reduce-visual-lines-qa
---

`;

process.stdout.write(`${frontmatter}${body}`);
NODE
```

把终端输出作为完整文件内容，通过 `apply_patch` 新建 `src/content/posts/manual/reduce-visual-lines-qa.md`。创建前先运行 `test ! -e src/content/posts/manual/reduce-visual-lines-qa.md`；若文件已存在，先确认归属，不得覆盖。不要使用重定向、`cat`、Python 或 Node 写文件。

- [ ] **Step 3：启动本地站点并进行页面矩阵验收**

```sh
if lsof -nP -iTCP:4328 -sTCP:LISTEN; then
  exit 1
fi
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run dev -- --host 127.0.0.1 --port 4328
```

Expected: 端口预检无监听进程，Astro 明确输出 `http://127.0.0.1:4328/`。若端口被占用，先停止本任务自己的旧服务，或选定一个新的空闲端口并在全部浏览器步骤中使用实际输出 URL；不要假设 Astro 会严格拒绝端口漂移。

使用 `browser:control-in-app-browser` 按以下路线逐页检查：

- `/`
- `/posts/`
- `/categories/`
- `/columns/`
- `/tags/`
- `/about/`
- `/posts/reduce-visual-lines-qa/`

每个代表性页面至少覆盖以下四种组合：

1. 1440 × 900，浅色。
2. 1440 × 900，深色。
3. 320 × 760，浅色。
4. 320 × 760，深色。

逐项核对：

- `document.documentElement.scrollWidth === document.documentElement.clientWidth`，无页面级横向溢出。
- 首页、通用页头、文章头与 TOC 的计算背景分别解析到主题中的 `--paper-soft`。
- 被移除的装饰边界计算结果为 `0px`/`none`；没有媒体查询重新引入边线。
- 只有吸顶页头、精选卡片与搜索弹窗保留常驻阴影；普通一级纸面和列表项无阴影。
- 鼠标悬停、键盘 Tab 焦点、当前导航下划线、搜索当前结果均清晰可辨。
- 搜索弹窗外框、输入框边界与当前结果 outline 存在。
- 表格行、blockquote 左线、`hr`、飞书 Callout 和 Source Synced 仍有语义边界。
- 行内公式、标题公式、块公式、TOC 锚点和移动端目录均未退化。
- 浏览器控制台无新增 error 或 warning。

如发现视觉缺陷，先补一个会失败的源码契约测试，再做最小 CSS 修正，重跑 Task 5 和完整门禁。

- [ ] **Step 4：无条件清理临时文章并停止服务**

停止开发服务器后，用补丁删除：

```text
src/content/posts/manual/reduce-visual-lines-qa.md
```

确认：

```sh
test ! -e src/content/posts/manual/reduce-visual-lines-qa.md
git status --short
git diff --check
```

Expected: 临时文章不存在；工作树只包含本计划允许的已提交文件，不出现 `.playwright-cli`、用户文章或其他受保护路径改动。

- [ ] **Step 5：清理后再跑最终验证**

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run verify
git status --short --branch
git log --oneline --decorate -8
```

Expected: 完整门禁再次通过，工作树干净，提交历史包含本计划的五个实现提交。

- [ ] **Step 6：只读复核变更范围**

```sh
git diff --stat 62347c2..HEAD
git diff --name-only 62347c2..HEAD
git diff --check 62347c2..HEAD
```

Expected: 实现范围仅包含：

- `docs/superpowers/plans/2026-07-19-reduce-visual-lines.md`
- `src/styles/global.css`
- `tests/design-contrast.test.mjs`
- `tests/ui-source.test.mjs`

`src/styles/feishu-content.css` 应保持未改；若浏览器验收证明必须做最小对比度适配，则需在交付说明中明确原因和具体语义边界保护结果。

## 最终完成标准

- [ ] 设计规格中的全站骨架、首页、文章索引、目录、关于页、文章阅读页、搜索、响应式和语义保护全部有对应测试或浏览器验收。
- [ ] 明暗主题新 token 的精确值与 WCAG AA 由自动化测试锁定。
- [ ] 所有装饰性边线在桌面和 320px 最终级联中消失。
- [ ] 当前导航、焦点环、搜索必要边界、表格、引用、`hr`、Callout 与 Source Synced 边界仍存在。
- [ ] 不改 DOM、路由、内容、搜索逻辑、飞书转换逻辑或依赖。
- [ ] `npm run verify` 最终通过，浏览器四组合无溢出、无控制台问题。
- [ ] 临时 QA 内容已删除，工作树干净，变更范围可审计。
