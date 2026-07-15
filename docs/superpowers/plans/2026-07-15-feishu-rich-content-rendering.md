# Feishu Rich Content Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 准确识别飞书源同步块、高亮块、公式、加粗、下划线、文字颜色、文字背景色、行内代码和链接，并在博客静态文章中以主题自适应、可搜索、可访问且不破坏旧文章的方式渲染；引用同步块继续明确拒绝。

**Architecture:** 保留 `blocksToMarkdown(items)` 作为同步链路的唯一公共入口，把原始树校验、不可变语义规范化、确定性 Markdown/受控 HTML 序列化拆成三层。KaTeX 在同步阶段服务端预渲染；页面侧用一个双状态扫描器统一处理公式搜索文本、受控标题和代码边界；文章布局只加载静态 CSS，不增加客户端运行时。

**Tech Stack:** Node.js 24、ES modules、KaTeX 0.17.0、Astro 7、TypeScript、CSS custom properties、Node test runner、Astro static build、in-app browser QA。

---

## 实施约束与文件地图

执行本计划前必须调用 `using-git-worktrees` skill；不要在当前 ahead 7 / behind 1 的 `main` 上写功能代码。以“最后修改本计划文件的提交”为实现基线，确保功能分支同时包含确认设计和本计划；在 `.worktrees/feishu-rich-content-rendering` 创建 `codex/feishu-rich-content-rendering`。

整个实现都使用以下 Node 24 环境：

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node --version
npm --version
```

预期：Node 输出 `v24.1.0`，npm 输出 `11.4.1`。所有 RED、GREEN 和最终验证都在同一环境运行；不要使用当前默认 Node 20，也不要把 bundled Node 24 与 `/usr/local` 的 npm 10.8.1 混用。

保护以下用户内容和生成目录，不得修改或暂存：

```text
.playwright-cli/
.superpowers/
src/content/posts/manual/internship-day-one.md
src/content/posts/feishu/
public/media/feishu/
.feishu-manifest.json
```

实现文件边界：

| 文件 | 操作 | 最终职责 |
| --- | --- | --- |
| `package.json`、`package-lock.json` | Modify | 精确锁定生产依赖 `katex@0.17.0` |
| `scripts/feishu/blocks.mjs` | Modify | 原始 Block 图、表格和媒体结构校验；公共入口与聚合错误 |
| `scripts/feishu/semantics.mjs` | Create | 富文本、颜色、公式、Callout、SourceSynced 的不可变语义层 |
| `scripts/feishu/markdown.mjs` | Create | 旧 Markdown 与全文受控 HTML 序列化、KaTeX、媒体引用 |
| `scripts/feishu/generate-callout-emojis.mjs` | Create | 从固定飞书官方快照生成本地 Emoji ID 映射 |
| `scripts/feishu/callout-emojis.mjs` | Create, generated | 940 个官方 Callout Emoji ID 到本地 Unicode 的静态映射 |
| `scripts/feishu/sync.mjs` | Verify/minimal Modify | 保持暂存后原子替换；公开错误和 warning 继续脱敏 |
| `src/lib/feishu-markup.ts` | Create | Markdown/受控 HTML 双状态扫描器 |
| `src/lib/feishu-headings.ts` | Create | 受控标题提取公共入口 |
| `src/lib/search.ts` | Modify | 公式源码只索引一次、移除容器 UI、保留代码隐私规则 |
| `src/pages/posts/[...id].astro` | Modify | 受控标题存在时替代 Astro headings |
| `src/layouts/PostLayout.astro` | Modify | 导入 KaTeX 与飞书内容 CSS；复用共享标题类型 |
| `src/styles/feishu-content.css` | Create | 双主题色板、公式、Callout、SourceSynced 和受控文档样式 |
| `tests/fixtures/feishu-legacy-document.json` | Create | 不含本轮格式的旧行为兼容夹具 |
| `tests/fixtures/feishu-rich-content.json` | Create, generated | 覆盖完整颜色枚举、公式与容器的脱敏夹具 |
| `tests/fixtures/feishu-reference-synced.json` | Create | 引用同步块的独立脱敏拒绝夹具 |
| `tests/helpers/feishu-rich-fixture.mjs` | Create | 以确定性代码生成并校验 rich fixture |
| `tests/feishu-semantics.test.mjs` | Create | 语义层枚举、组合与不可变性 |
| `tests/feishu-markdown.test.mjs` | Create | KaTeX、安全预算、两种序列化模式 |
| `tests/feishu-markup.test.mjs` | Create | 双状态扫描器与伪标记边界 |
| `tests/feishu-headings.test.mjs` | Create | 标题协议及失败模式 |
| 现有相关 `tests/*.test.mjs` | Modify | 依赖、转换、同步、搜索、样式和真实构建回归 |

需求追踪：

| 设计要求 | 落地任务 |
| --- | --- |
| 旧文章逐字节兼容 | 2、7 |
| 完整 Emoji 官方枚举与默认 gift | 3、5 |
| 7/15/15/7 颜色枚举与非法值 | 4、5、11 |
| 公式判定、KaTeX 安全和四类预算 | 4、6、7 |
| Callout、SourceSynced、拒绝 ReferenceSynced | 5、7、8 |
| 默认 Markdown / 全文受控 HTML | 7 |
| 搜索、代码边界、标题目录 | 9、10、12 |
| 同步事务、脱敏、幂等 | 8 |
| 双主题、对比度、窄屏溢出 | 11、13 |
| 真实 Astro 输出与浏览器验收 | 12、13 |

### Task 1: 建立隔离 worktree 并锁定 KaTeX 依赖

**Files:**
- Modify: `tests/toolchain.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 创建并进入功能 worktree**

先调用 `using-git-worktrees` skill，检查 `.worktrees` 忽略规则和现有 worktree，再执行：

```sh
PLAN_BASE=$(git log -1 --format=%H -- \
  docs/superpowers/plans/2026-07-15-feishu-rich-content-rendering.md)
test -n "$PLAN_BASE"
git worktree add .worktrees/feishu-rich-content-rendering \
  -b codex/feishu-rich-content-rendering \
  "$PLAN_BASE"
cd .worktrees/feishu-rich-content-rendering
git status --short --branch
```

预期：`PLAN_BASE` 指向已提交的计划文档，当前分支为 `codex/feishu-rich-content-rendering`，工作区为空；主工作区中的两个未跟踪用户路径不会出现在本 worktree。

- [ ] **Step 2: 先写精确依赖契约测试**

在 `tests/toolchain.test.mjs` 新增：

```js
test('KaTeX is an exact production dependency in package and lock files', async () => {
  const [packageJson, packageLock] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../package-lock.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);

  assert.equal(packageJson.dependencies.katex, '0.17.0');
  assert.equal(packageJson.devDependencies?.katex, undefined);
  assert.equal(packageLock.packages[''].dependencies.katex, '0.17.0');
  assert.equal(packageLock.packages['node_modules/katex'].version, '0.17.0');
});
```

- [ ] **Step 3: 运行测试并观察 RED**

```sh
node --experimental-strip-types --test tests/toolchain.test.mjs
```

预期：新增测试 FAIL，实际值为 `undefined`；现有 toolchain 测试保持通过。

- [ ] **Step 4: 让 npm 生成 package 与 lock 变更**

```sh
npm install --save-exact katex@0.17.0
```

不要手工编辑 `package-lock.json`。完成后 `package.json` 的生产依赖包含：

```json
"katex": "0.17.0"
```

- [ ] **Step 5: 运行 GREEN 并提交**

```sh
node --experimental-strip-types --test tests/toolchain.test.mjs
git diff --check
git add package.json package-lock.json tests/toolchain.test.mjs
git diff --cached --name-only
git commit -m "build: add pinned KaTeX dependency"
```

预期：测试 0 fail；暂存清单只有上述三个文件。

### Task 2: 建立纯旧格式 golden，先锁住兼容边界

**Files:**
- Create: `tests/fixtures/feishu-legacy-document.json`
- Modify: `tests/feishu-conversion.test.mjs`

- [ ] **Step 1: 创建无新格式的 legacy fixture**

使用 `apply_patch` 复制 `tests/fixtures/feishu-document.json` 到 `tests/fixtures/feishu-legacy-document.json`，只删除 `formatted-paragraph.text.elements` 中下面这个元素：

```json
{
  "text_run": {
    "content": " 下划线",
    "text_element_style": { "underline": true }
  }
}
```

其余 Block、ID、媒体 token、表格和顺序逐字保持不变。这保证 fixture 仍覆盖标题、强调、链接、嵌套列表、待办、引用、代码 fence、图片和表格，但没有下划线、颜色、公式或新容器。

- [ ] **Step 2: 添加完整四字段 golden 断言**

在 `tests/feishu-conversion.test.mjs` 顶部读取新 fixture，并新增：

```js
const legacyFixture = JSON.parse(
  await readFile(
    new URL('./fixtures/feishu-legacy-document.json', import.meta.url),
    'utf8',
  ),
);

test('legacy fixture preserves the complete conversion result byte for byte', () => {
  const expected = {
    markdown: [
      '## 二级标题',
      '',
      'Markdown \\*特殊\\* 内容：**粗体** *斜体* ~~删除~~ ``a`b`` [链接](https://example.com/docs_%281%29)',
      '',
      '- 父级列表',
      '  - 嵌套列表',
      '',
      '1. 有序项目',
      '',
      '> 引用内容',
      '',
      '- [x] 已经完成',
      '',
      '- [ ] 尚未完成',
      '',
      '````javascript',
      'const fence = "```";',
      'console.log(fence);',
      '````',
      '',
      '---',
      '',
      '![图片](\uE000feishu-media:img_v2_example\uE001)',
      '',
      '| 列 A | 列 B |',
      '| --- | --- |',
      '| 值 \\| A | **值 B** |',
      '',
    ].join('\n'),
    mediaTokens: ['img_v2_example'],
    mediaReferences: [
      {
        token: 'img_v2_example',
        placeholder: '\uE000feishu-media:img_v2_example\uE001',
      },
    ],
    warnings: [],
  };
  const input = structuredClone(legacyFixture.items);

  assert.deepEqual(blocksToMarkdown(input), expected);
  assert.deepEqual(input, legacyFixture.items);
});
```

- [ ] **Step 3: 运行兼容测试并记录 GREEN 基线**

```sh
node --experimental-strip-types --test \
  --test-name-pattern='legacy fixture' \
  tests/feishu-conversion.test.mjs
```

预期：测试 PASS。它是后续模块拆分的不可回退基线，不需要人为制造失败。

- [ ] **Step 4: 提交 golden**

```sh
git add tests/fixtures/feishu-legacy-document.json tests/feishu-conversion.test.mjs
git diff --cached --check
git commit -m "test: lock legacy Feishu conversion output"
```

### Task 3: 固定官方 Callout Emoji 清单

**Files:**
- Create: `scripts/feishu/generate-callout-emojis.mjs`
- Create: `scripts/feishu/callout-emojis.mjs`
- Modify: `tests/feishu-conversion.test.mjs`

- [ ] **Step 1: 先写本地枚举契约测试**

在 `tests/feishu-conversion.test.mjs` 新增 import 和测试：

```js
import {
  CALLOUT_EMOJI_BY_ID,
  CALLOUT_EMOJI_SNAPSHOT,
} from '../scripts/feishu/callout-emojis.mjs';

test('vendors the complete pinned Feishu callout emoji catalog', () => {
  assert.deepEqual(CALLOUT_EMOJI_SNAPSHOT, {
    source:
      'https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/emoji.md',
    sha256: '37928153b9dc57b5e9ac940facb5a9627038bd130a3a0fc17edf59f5741458b7',
    count: 940,
  });
  assert.equal(Object.keys(CALLOUT_EMOJI_BY_ID).length, 940);
  assert.equal(CALLOUT_EMOJI_BY_ID.gift, '🎁');
  assert.equal(CALLOUT_EMOJI_BY_ID.grinning, '😀');
  assert.equal(CALLOUT_EMOJI_BY_ID.beach_with_umbrella, '🏖');
  assert.equal(CALLOUT_EMOJI_BY_ID.unknown, undefined);
  assert.equal(Object.hasOwn(CALLOUT_EMOJI_BY_ID, 'toString'), false);
  assert.equal(Object.hasOwn(CALLOUT_EMOJI_BY_ID, '__proto__'), false);
});
```

- [ ] **Step 2: 运行测试并观察 RED**

```sh
node --experimental-strip-types --test \
  --test-name-pattern='callout emoji catalog' \
  tests/feishu-conversion.test.mjs
```

预期：FAIL，原因是 `scripts/feishu/callout-emojis.mjs` 不存在。

- [ ] **Step 3: 添加可复现的官方快照生成器**

创建 `scripts/feishu/generate-callout-emojis.mjs`：

```js
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const source =
  'https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/emoji.md';
const sha256 = '37928153b9dc57b5e9ac940facb5a9627038bd130a3a0fc17edf59f5741458b7';
const count = 940;
const output = new URL('./callout-emojis.mjs', import.meta.url);

const response = await fetch(source);
if (!response.ok) {
  throw new Error(`Emoji snapshot request failed with HTTP ${response.status}.`);
}
const body = await response.text();
const actualHash = createHash('sha256').update(body).digest('hex');
if (actualHash !== sha256) {
  throw new Error(`Emoji snapshot hash changed: ${actualHash}.`);
}

const rows = [...body.matchAll(/^\|\s*(\S(?:.*?\S)?)\s*\|\s*([^|\s]+)\s*\|\s*$/gm)]
  .map(([, emoji, id]) => [id, emoji])
  .filter(
    ([id, emoji]) =>
      !id.includes('Emoji') &&
      !id.startsWith('-') &&
      !emoji.includes('Emoji') &&
      !emoji.startsWith('-'),
  );
const ids = new Set(rows.map(([id]) => id));
if (rows.length !== count || ids.size !== count || !ids.has('gift')) {
  throw new Error(
    `Emoji snapshot shape changed: ${rows.length} rows, ${ids.size} unique IDs.`,
  );
}

const generated = [
  '// Generated by scripts/feishu/generate-callout-emojis.mjs.',
  `export const CALLOUT_EMOJI_SNAPSHOT = Object.freeze(${JSON.stringify({ source, sha256, count }, null, 2)});`,
  `export const CALLOUT_EMOJI_BY_ID = Object.freeze(${JSON.stringify(Object.fromEntries(rows), null, 2)});`,
  '',
].join('\n');
await writeFile(output, generated, 'utf8');
```

- [ ] **Step 4: 生成静态映射并验证 GREEN**

```sh
node scripts/feishu/generate-callout-emojis.mjs
node --experimental-strip-types --test \
  --test-name-pattern='callout emoji catalog' \
  tests/feishu-conversion.test.mjs
```

预期：生成文件只导出固定快照元数据和 940 项冻结对象；测试 0 fail。运行时转换和生产构建都不访问网络。

如果官方响应的 SHA-256 不再匹配，停止本任务并审阅枚举差异；不能直接改 hash、计数或删除未知行来让生成器通过。确认官方新增/删除后，应先更新设计依据和枚举测试，再重新生成快照。

- [ ] **Step 5: 提交生成器与快照**

```sh
git add \
  scripts/feishu/generate-callout-emojis.mjs \
  scripts/feishu/callout-emojis.mjs \
  tests/feishu-conversion.test.mjs
git diff --cached --check
git commit -m "build: vendor Feishu callout emoji catalog"
```

### Task 4: 建立富文本语义层

**Files:**
- Create: `scripts/feishu/semantics.mjs`
- Create: `tests/feishu-semantics.test.mjs`
- Modify: `scripts/feishu/blocks.mjs`

- [ ] **Step 1: 先写颜色和样式语义测试**

创建 `tests/feishu-semantics.test.mjs`，使用下面的入口与期望映射：

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CALLOUT_BACKGROUND_BY_ENUM,
  CALLOUT_BORDER_BY_ENUM,
  FONT_BACKGROUND_BY_ENUM,
  FONT_COLOR_BY_ENUM,
  normalizeFeishuDocument,
} from '../scripts/feishu/semantics.mjs';

const fontColors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
const fontBackgrounds = [
  'light-red', 'light-orange', 'light-yellow', 'light-green', 'light-blue',
  'light-purple', 'medium-gray', 'red', 'orange', 'yellow', 'green', 'blue',
  'purple', 'gray', 'light-gray',
];
const calloutBackgrounds = [
  'light-red', 'light-orange', 'light-yellow', 'light-green', 'light-blue',
  'light-purple', 'medium-gray', 'medium-red', 'medium-orange', 'medium-yellow',
  'medium-green', 'medium-blue', 'medium-purple', 'gray', 'light-gray',
];

function paragraphDocument(style = {}) {
  const root = {
    block_id: 'page',
    block_type: 1,
    children: ['paragraph'],
    page: { elements: [] },
  };
  const paragraph = {
    block_id: 'paragraph',
    block_type: 2,
    parent_id: 'page',
    text: {
      elements: [
        { text_run: { content: '示例', text_element_style: style } },
      ],
    },
  };
  return { blocks: new Map([['page', root], ['paragraph', paragraph]]), root };
}

test('maps every Feishu color enum to the required semantic token', () => {
  assert.deepEqual(Object.values(FONT_COLOR_BY_ENUM), fontColors);
  assert.deepEqual(Object.values(CALLOUT_BORDER_BY_ENUM), fontColors);
  assert.deepEqual(Object.values(FONT_BACKGROUND_BY_ENUM), fontBackgrounds);
  assert.deepEqual(Object.values(CALLOUT_BACKGROUND_BY_ENUM), calloutBackgrounds);
  assert.notEqual(FONT_BACKGROUND_BY_ENUM[8], CALLOUT_BACKGROUND_BY_ENUM[8]);
  assert.notEqual(FONT_BACKGROUND_BY_ENUM[13], CALLOUT_BACKGROUND_BY_ENUM[13]);
});
```

同文件增加表驱动测试，构造一个 Page 和一个 Paragraph，逐一覆盖：

```js
for (const invalid of [null, 0, -1, 1.5, '1', 8]) {
  test(`rejects invalid text color enum ${JSON.stringify(invalid)}`, () => {
    const { issues } = normalizeFeishuDocument(
      paragraphDocument({ text_color: invalid }),
    );
    assert.equal(issues[0].code, 'invalid_color_enum');
  });
}

for (const invalid of [null, 0, -1, 1.5, '1', 16]) {
  test(`rejects invalid text background enum ${JSON.stringify(invalid)}`, () => {
    const { issues } = normalizeFeishuDocument(
      paragraphDocument({ background_color: invalid }),
    );
    assert.equal(issues[0].code, 'invalid_color_enum');
  });
}

test('accepts comment metadata but rejects unknown visual style keys', () => {
  assert.equal(
    normalizeFeishuDocument(
      paragraphDocument({ comment_ids: ['comment_example'] }),
    ).issues.length,
    0,
  );
  assert.equal(
    normalizeFeishuDocument(
      paragraphDocument({ text_shadow: 'red' }),
    ).issues[0].code,
    'unsupported_text_style',
  );
  assert.equal(
    normalizeFeishuDocument(
      paragraphDocument({ comment_ids: 'comment_example' }),
    ).issues[0].code,
    'invalid_text_style',
  );
});

test('aggregates unsafe links and style issues without throwing early', () => {
  const input = paragraphDocument();
  input.blocks.get('paragraph').text.elements = [
    { text_run: {
      content: '一',
      text_element_style: { link: { url: 'javascript:alert(1)' } },
    } },
    { text_run: {
      content: '二',
      text_element_style: { link: { url: 'https://user:pass@example.com/' } },
    } },
    { text_run: {
      content: '三',
      text_element_style: { text_shadow: 'red' },
    } },
  ];
  const result = normalizeFeishuDocument(input);
  assert.deepEqual(
    result.issues.map(({ code }) => code),
    ['unsafe_link', 'unsafe_link', 'unsupported_text_style'],
  );
});
```

`paragraphDocument(style)` 返回 `{ blocks, root }`，其中 `blocks` 是含 Page 与 Paragraph 的 `Map`；测试还要断言规范化前后的原始对象 `deepEqual`，语义文档及所有嵌套节点都被 `Object.isFrozen()` 判为真。

- [ ] **Step 2: 运行测试并观察 RED**

```sh
node --experimental-strip-types --test tests/feishu-semantics.test.mjs
```

预期：FAIL，原因是语义模块不存在。

- [ ] **Step 3: 创建固定枚举和不可变语义 API**

在 `scripts/feishu/semantics.mjs` 定义：

```js
export const FONT_COLOR_BY_ENUM = Object.freeze({
  1: 'red', 2: 'orange', 3: 'yellow', 4: 'green',
  5: 'blue', 6: 'purple', 7: 'gray',
});
export const CALLOUT_BORDER_BY_ENUM = Object.freeze({ ...FONT_COLOR_BY_ENUM });
export const FONT_BACKGROUND_BY_ENUM = Object.freeze({
  1: 'light-red', 2: 'light-orange', 3: 'light-yellow',
  4: 'light-green', 5: 'light-blue', 6: 'light-purple',
  7: 'medium-gray', 8: 'red', 9: 'orange', 10: 'yellow',
  11: 'green', 12: 'blue', 13: 'purple', 14: 'gray', 15: 'light-gray',
});
export const CALLOUT_BACKGROUND_BY_ENUM = Object.freeze({
  1: 'light-red', 2: 'light-orange', 3: 'light-yellow',
  4: 'light-green', 5: 'light-blue', 6: 'light-purple',
  7: 'medium-gray', 8: 'medium-red', 9: 'medium-orange',
  10: 'medium-yellow', 11: 'medium-green', 12: 'medium-blue',
  13: 'medium-purple', 14: 'gray', 15: 'light-gray',
});

function issue(code, message, blockId) {
  return { code, message, ...(blockId ? { blockId } : {}) };
}

export function normalizeFeishuDocument({ blocks, root }) {
  const issues = [];
  const warnings = [];
  const children = (root?.children ?? [])
    .map((blockId) => normalizeBlock(blocks.get(blockId), blocks, issues, warnings))
    .filter((node) => node !== null);
  if (issues.length > 0) return { document: null, issues };
  return {
    document: deepFreeze({
      kind: 'document',
      mode: requiresControlledDocument(children)
        ? 'controlled-document'
        : 'markdown',
      children,
      warnings,
    }),
    issues: [],
  };
}
```

语义节点固定使用以下形状；不要把原始 `block_id` 写入任何输出字段，只有内部 `blockId` 诊断字段保留：

```js
{
  kind: 'text',
  blockId,
  value,
  style: {
    bold, italic, strikethrough, underline, inlineCode,
    textColor, backgroundColor, href,
  },
}

{
  kind: 'equation',
  blockId,
  source,
  display: 'inline',
  style,
}
```

其余语义 Block 形状固定为：

```js
{ kind: 'paragraph', blockId, inlines }
{ kind: 'heading', blockId, depth, inlines }
{
  kind: 'listItem',
  blockId,
  listKind: 'bullet' | 'ordered' | 'todo',
  checked: true | false | undefined,
  inlines,
  children,
}
{ kind: 'quote', blockId, inlines }
{ kind: 'code', blockId, value, language }
{ kind: 'divider', blockId }
{ kind: 'image', blockId, token }
{
  kind: 'table',
  blockId,
  rows, // rows -> cells -> rich-text lines; multiple lines serialize with <br>
}
{ kind: 'callout', blockId, background, border, textColor, emoji, children }
{ kind: 'sourceSynced', blockId, title, align, children }
```

`checked` 只允许 todo 使用；bullet/ordered 固定为 `undefined`。表格仍受现有“cell 只含简单 text Block”结构门禁约束，但其中的 text Block 可以含本轮支持的 text run 与 equation。

允许的 `text_element_style` key 只有：

```js
const STYLE_KEYS = new Set([
  'bold', 'italic', 'strikethrough', 'underline', 'inline_code',
  'text_color', 'background_color', 'link', 'comment_ids',
]);
```

布尔字段存在时必须是 boolean；颜色必须是合法整数枚举。把当前 `TEXT_PROPERTY_BY_TYPE`、`CODE_LANGUAGES`、`PLAIN_TEXT_CODE_FALLBACKS` 和 `normalizeLinkUrl()` 从 `blocks.mjs` 机械迁入 `semantics.mjs` 并导出；Task 4 的过渡期由旧 renderer import，Task 7 完成后链接函数只由富文本规范化调用。规范化每个 text leaf 时用局部 `try/catch normalizeLinkUrl()`；失败只追加一个脱敏 `unsafe_link` issue 并继续遍历，绝不能让普通 Error 中断其余 leaf。代码语义节点保存 `{ kind: 'code', blockId, value, language }`，plain-text fallback 在文档 warnings 中保留当前 `{ blockId, type: 'code_language_fallback', language }`。`comment_ids` 存在时必须是 string 数组，但不进入语义输出；其他 key 产生 `unsupported_text_style`。递归冻结实现为：

```js
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
```

- [ ] **Step 4: 把富文本字段识别迁入语义层**

在 `scripts/feishu/blocks.mjs` 中保留图结构、表格、媒体 token 和 Block data 形状校验；从 `semantics.mjs` import `TEXT_PROPERTY_BY_TYPE`、`CODE_LANGUAGES`、`PLAIN_TEXT_CODE_FALLBACKS` 与 `normalizeLinkUrl`，避免两份枚举漂移，并让 Task 4 后尚未迁走的旧 renderer 继续可运行。Tasks 4–6 的过渡期，`validateRichElements()` 对既有 `text_run` 继续保留旧的 link `try/catch` 聚合校验，避免公共旧 renderer 抛普通 Error；同时允许语义层测试使用 equation。直到 Task 7 同一提交把公共入口接到 `normalizeFeishuDocument()` 后，才从 blocks validator 删除这份过渡 link 校验，并由语义层唯一负责样式、内容和链接。Task 7 后原始元素对象恰好含 `text_run` 或 `equation` 的形状仍由 blocks 层验证。`equation` 的 API 形状必须是：

```js
{
  equation: {
    content: 'E = mc^2',
    text_element_style: {},
  },
}
```

`text_run.content` 和 `equation.content` 中出现媒体私用区前后缀都产生 `reserved_media_placeholder`。空或纯空白公式产生 `invalid_equation`；公式样式中的 `inline_code: true` 产生 `invalid_text_style`。

- [ ] **Step 5: 完成公式显示模式判定测试与实现**

增加测试，断言只有普通段落忽略空白 text run 后恰好一个公式时为 block；以下当前已实现上下文全部为 inline：段落混排、多个公式、标题、列表、待办、引用、表格。SourceSynced 标题的同一断言放到 Task 5，在 SourceSynced 语义实现后运行。

实现时给 `normalizeBlock` / `normalizeRichElements` 传递 `{ forceInlineEquation: true }` 上下文；SourceSynced title 和 table cell text 明确传 true，普通子孙 Block 默认 false。只在规范化 `block_type: 2` 前计算：

```js
const nonWhitespaceElements = elements.filter(
  (element) =>
    element.equation !== undefined ||
    !/^\s*$/.test(element.text_run?.content ?? ''),
);
const blockEquation =
  block.block_type === 2 &&
  !context.forceInlineEquation &&
  nonWhitespaceElements.length === 1 &&
  nonWhitespaceElements[0].equation !== undefined;
```

当 `blockEquation` 为真时，不把公式两侧纯空白 text run 放入语义节点。表格测试必须构造真实 `31 → 32 → 2` parent chain，不能只直接调用一个 type 2 helper；即使 cell text 只有一个 equation，结果也必须为 `display: 'inline'`。

- [ ] **Step 6: 运行 GREEN 并提交**

```sh
node --experimental-strip-types --test \
  tests/feishu-semantics.test.mjs \
  tests/feishu-conversion.test.mjs
git add scripts/feishu/semantics.mjs scripts/feishu/blocks.mjs \
  tests/feishu-semantics.test.mjs
git diff --cached --check
git commit -m "feat: normalize Feishu rich text semantics"
```

预期：新语义测试通过，legacy golden 仍逐字节通过。

### Task 5: 规范化 Callout、SourceSynced，并明确拒绝 ReferenceSynced

**Files:**
- Modify: `scripts/feishu/blocks.mjs`
- Modify: `scripts/feishu/semantics.mjs`
- Modify: `tests/feishu-semantics.test.mjs`
- Create: `tests/helpers/feishu-rich-fixture.mjs`
- Create: `tests/fixtures/feishu-rich-content.json`
- Create: `tests/fixtures/feishu-reference-synced.json`

- [ ] **Step 1: 先写三类 Block 的失败与成功测试**

在 `tests/feishu-semantics.test.mjs` 增加断言：

```js
test('normalizes an empty callout with the official gift default', () => {
  const result = normalizeFeishuDocument(calloutDocument({}));
  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.document.children[0], {
    kind: 'callout',
    blockId: 'callout',
    background: null,
    border: null,
    textColor: null,
    emoji: '🎁',
    children: [],
  });
  assert.equal(result.document.mode, 'controlled-document');
});

test('normalizes source synced title alignment and descendants', () => {
  const result = normalizeFeishuDocument(sourceSyncedDocument({ align: 3 }));
  assert.equal(result.issues.length, 0);
  assert.equal(result.document.children[0].kind, 'sourceSynced');
  assert.equal(result.document.children[0].align, 'right');
  assert.equal(result.document.children[0].children[0].kind, 'paragraph');
  assert.equal(result.document.children[0].title[1].kind, 'equation');
  assert.equal(result.document.children[0].title[1].display, 'inline');
});
```

`sourceSyncedDocument()` 的 `source_synced.elements` 固定为 `[text('同步标题 '), equation('s = t')]`，children 至少含一个 paragraph，因此上述索引和 inline 断言确定可复现。

再表驱动覆盖：Callout 背景 1–15、边框 1–7、文字 1–7；缺失 emoji、`gift`、另一个已知 ID；空字符串、非字符串和未知 ID；SourceSynced 的 align 缺失/1/2/3 与 `0`、`4`、`1.5`、`'1'`；缺失/非对象 `callout`、`source_synced`；`source_synced.elements` 缺失以及显式 `null`、`{}`、`'x'`。elements 只有严格 `undefined` 表示空标题，其余非数组值都产生 `invalid_source_synced`。对 `background_color` 使用 `[null, 0, -1, 1.5, '1', 16]`，对 `border_color` 和 `text_color` 使用 `[null, 0, -1, 1.5, '1', 8]`，每个非法值都必须得到 `invalid_color_enum`；只有字段值严格为 `undefined` 才表示缺省。其余对应错误码必须分别为 `invalid_callout`、`unsupported_callout_emoji`、`invalid_source_synced`、`invalid_source_synced_align`。

另构造 `callout: null` 且 child 含空 equation 的文档，断言 issues 同时包含 `invalid_callout` 与 `invalid_equation`；对 `source_synced: null` 做同样断言。再构造 `source_synced.elements` 含一个畸形 title leaf、children 含空 equation 的文档，断言 title 与 child 的两个 issue 都被聚合，锁住“容器/标题无效也递归收集子孙问题”的行为。

创建独立 `tests/fixtures/feishu-reference-synced.json`：

```json
{
  "items": [
    {
      "block_id": "page",
      "block_type": 1,
      "children": ["reference"],
      "page": { "elements": [] }
    },
    {
      "block_id": "reference",
      "block_type": 50,
      "parent_id": "page",
      "reference_synced": {
        "source_document_id": "document_private",
        "source_block_id": "block_private"
      }
    }
  ]
}
```

在 `tests/feishu-conversion.test.mjs` 读取该 fixture 并增加类型 50 测试：

```js
test('rejects reference synced blocks with a dedicated issue', () => {
  const items = structuredClone(referenceSyncedFixture.items);

  assert.throws(() => blocksToMarkdown(items), (error) => {
    assert.ok(error instanceof FeishuConversionError);
    assert.equal(
      error.issues.find(({ code }) => code === 'unsupported_reference_synced')?.code,
      'unsupported_reference_synced',
    );
    assert.deepEqual(
      error.issues.map(({ code }) => code),
      ['unsupported_reference_synced'],
    );
    assert.doesNotMatch(error.message, /document_private|block_private/);
    return true;
  });
});
```

- [ ] **Step 2: 运行聚焦测试并观察 RED**

```sh
node --experimental-strip-types --test \
  --test-name-pattern='callout|source synced|reference synced' \
  tests/feishu-semantics.test.mjs tests/feishu-conversion.test.mjs
```

预期：类型 19/49 仍不被规范化，类型 50 仍返回通用 unsupported。

- [ ] **Step 3: 扩展 Block 支持集合与专用错误**

在 `scripts/feishu/blocks.mjs` 使用：

```js
const SUPPORTED_BLOCK_TYPES = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 14, 15, 17, 19, 22, 27, 31, 32, 49,
]);
const CONTAINER_BLOCK_TYPES = new Set([1, 12, 13, 17, 19, 31, 32, 49]);
```

在通用 `unsupported_block_type` 分支之前识别 `block_type === 50`，加入专用 issue 后立即 `continue`：

```js
if (block.block_type === 50) {
  issues.push(issue(
    'unsupported_reference_synced',
    `Block "${block.block_id}" is a reference synced block; only source synced blocks are supported.`,
    block.block_id,
  ));
  continue;
}
```

消息不得拼接 `source_document_id` 或 `source_block_id`。

- [ ] **Step 4: 实现容器语义**

在 `scripts/feishu/semantics.mjs` 中：

```js
const SOURCE_ALIGN_BY_ENUM = Object.freeze({ 1: 'left', 2: 'center', 3: 'right' });

function normalizeCallout(block, blocks, issues, warnings) {
  const data = block.callout;
  const children = normalizeChildren(block, blocks, issues, warnings);
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    issues.push(issue('invalid_callout', 'Callout data must be an object.', block.block_id));
    return null;
  }
  const emojiId = data.emoji_id === undefined ? 'gift' : data.emoji_id;
  const emoji =
    typeof emojiId === 'string' &&
    emojiId.length > 0 &&
    Object.hasOwn(CALLOUT_EMOJI_BY_ID, emojiId)
      ? CALLOUT_EMOJI_BY_ID[emojiId]
      : undefined;
  if (emoji === undefined) {
    issues.push(issue(
      'unsupported_callout_emoji',
      `Callout "${block.block_id}" has an unsupported emoji ID.`,
      block.block_id,
    ));
  }
  return {
    kind: 'callout',
    blockId: block.block_id,
    background: optionalEnum(data.background_color, CALLOUT_BACKGROUND_BY_ENUM, issues, block),
    border: optionalEnum(data.border_color, CALLOUT_BORDER_BY_ENUM, issues, block),
    textColor: optionalEnum(data.text_color, FONT_COLOR_BY_ENUM, issues, block),
    emoji: emoji ?? '',
    children,
  };
}
```

`normalizeSourceSynced()` 同样先规范化 children，再验证 `source_synced` 对象，这样容器字段无效时仍能收集子孙可发现的问题；title elements 只在 `data.elements === undefined` 时使用 `[]`，显式 `null`/对象/字符串等非数组值追加脱敏 `invalid_source_synced` 并把 title 暂置 `[]`，不能用 `?? []` 吞掉错误。合法数组按 `forceInlineEquation` 上下文规范化并继续聚合每个 title leaf issue。缺失 align 视为 `left`，children 递归结果写入节点。节点固定为：

```js
{
  kind: 'sourceSynced',
  blockId: block.block_id,
  title,
  align: 'left' | 'center' | 'right',
  children,
}
```

`requiresControlledDocument()` 递归遍历所有 descendants，在任一 Callout、SourceSynced，或任一 Heading inlines 含 underline、颜色、背景或 equation 时返回 true；普通段落只有受控行内样式时仍保持 `markdown` 模式。

- [ ] **Step 5: 添加确定性 rich fixture builder**

创建 `tests/helpers/feishu-rich-fixture.mjs`。使用下面的完整 builder；循环只展开固定官方枚举，不读取环境或私有数据：

```js
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function text(content, text_element_style = {}) {
  return { text_run: { content, text_element_style } };
}

function equation(content, text_element_style = {}) {
  return { equation: { content, text_element_style } };
}

function richTextBlock(block_id, parent_id, elements, extra = {}) {
  return {
    block_id,
    block_type: 2,
    parent_id,
    text: { elements },
    ...extra,
  };
}

export function buildRichFixture() {
  const blocks = [];
  const pageChildren = [];
  const addTopLevel = (block) => {
    pageChildren.push(block.block_id);
    blocks.push(block);
  };

  addTopLevel({
    block_id: 'rich-heading-formula',
    block_type: 4,
    parent_id: 'rich-page',
    heading2: {
      elements: [text('公式标题 '), equation('h + i')],
    },
  });
  addTopLevel({
    block_id: 'rich-heading-plain',
    block_type: 5,
    parent_id: 'rich-page',
    heading3: { elements: [text('普通标题')] },
  });
  addTopLevel({
    block_id: 'rich-heading-duplicate',
    block_type: 5,
    parent_id: 'rich-page',
    heading3: { elements: [text('普通标题')] },
  });
  addTopLevel(richTextBlock(
    'rich-text-colors',
    'rich-page',
    Array.from({ length: 7 }, (_, index) => [
      text(`文字色 ${index + 1}`, { text_color: index + 1 }),
      text(index === 6 ? '' : ' '),
    ]).flat(),
  ));
  addTopLevel(richTextBlock(
    'rich-text-backgrounds',
    'rich-page',
    Array.from({ length: 15 }, (_, index) => [
      text(`背景色 ${index + 1}`, { background_color: index + 1 }),
      text(index === 14 ? '' : ' '),
    ]).flat(),
  ));
  addTopLevel(richTextBlock('rich-background-only-link', 'rich-page', [
    text('仅背景链接', {
      background_color: 9,
      link: { url: 'https://example.com/background-only' },
    }),
  ]));
  addTopLevel(richTextBlock('rich-combined-style', 'rich-page', [
    text('<组合样式>', {
      bold: true,
      italic: true,
      strikethrough: true,
      underline: true,
      inline_code: true,
      text_color: 1,
      background_color: 5,
      link: { url: 'https://example.com/docs' },
    }),
  ]));
  addTopLevel(richTextBlock('rich-html-inline-code-protocol', 'rich-page', [
    text(
      [
        '<span data-feishu-equation-source="@@">HTML 行内伪公式</span>',
        '<h2 id="feishu-heading-99" data-feishu-heading-text="@@">HTML 行内伪标题</h2>',
        '<span data-feishu-search-ui>HTML 行内伪界面</span>',
        'https://private.example/html-code',
      ].join(' '),
      { inline_code: true, underline: true },
    ),
  ]));
  addTopLevel(richTextBlock('rich-inline-formula', 'rich-page', [
    text('混排 '),
    equation('x + y', {
      bold: true,
      underline: true,
      text_color: 5,
      background_color: 2,
      link: { url: 'https://example.com/formula' },
    }),
    text(' 完成'),
  ]));
  addTopLevel(richTextBlock('rich-block-formula', 'rich-page', [
    text('  '),
    equation('a | b\n% 注释\n+ c'),
    text('\n'),
  ]));
  addTopLevel(richTextBlock('rich-long-inline-formula', 'rich-page', [
    text('长行内公式 '),
    equation(Array.from(
      { length: 32 },
      (_, index) => `x_{${index + 1}}`,
    ).join(' + ')),
    text(' 结束'),
  ]));
  addTopLevel(richTextBlock('rich-long-block-formula', 'rich-page', [
    equation(Array.from(
      { length: 32 },
      (_, index) => `y_{${index + 1}}`,
    ).join(' + ')),
  ]));
  addTopLevel({
    block_id: 'rich-controlled-code-protocol',
    block_type: 14,
    parent_id: 'rich-page',
    code: {
      style: { language: 24 },
      elements: [text([
        '` 未配对反引号',
        '~~~',
        '<span data-feishu-equation-source="eA">伪公式</span>',
        '<h2 id="feishu-heading-9" data-feishu-heading-text="@@">伪标题</h2>',
        '<span data-feishu-search-ui>伪界面</span>',
      ].join('\n'))],
    },
  });
  addTopLevel({
    block_id: 'rich-ordered',
    block_type: 13,
    parent_id: 'rich-page',
    ordered: { elements: [text('受控有序列表')] },
  });
  addTopLevel({
    block_id: 'rich-todo',
    block_type: 17,
    parent_id: 'rich-page',
    todo: {
      style: { done: true },
      elements: [text('受控待办事项')],
    },
  });
  addTopLevel({
    block_id: 'rich-todo-open',
    block_type: 17,
    parent_id: 'rich-page',
    todo: {
      style: { done: false },
      elements: [text('未完成待办事项')],
    },
  });
  addTopLevel({
    block_id: 'rich-divider',
    block_type: 22,
    parent_id: 'rich-page',
    divider: {},
  });

  for (let value = 1; value <= 15; value += 1) {
    const calloutId = `rich-callout-${value}`;
    const paragraphId = `${calloutId}-paragraph`;
    const children = [paragraphId];
    if (value === 1) {
      children.push(
        'rich-callout-1-heading',
        'rich-callout-1-quote',
        'rich-callout-1-list',
      );
    }
    addTopLevel({
      block_id: calloutId,
      block_type: 19,
      parent_id: 'rich-page',
      children,
      callout: {
        background_color: value,
        border_color: ((value - 1) % 7) + 1,
        text_color: ((value - 1) % 7) + 1,
        ...(value === 1
          ? {}
          : { emoji_id: value === 2 ? 'grinning' : 'gift' }),
      },
    });
    blocks.push(richTextBlock(
      paragraphId,
      calloutId,
      [text(
        `高亮块 ${value}`,
        value === 1 ? { text_color: 5 } : {},
      )],
    ));
  }
  blocks.push({
    block_id: 'rich-callout-1-heading',
    block_type: 4,
    parent_id: 'rich-callout-1',
    heading2: { elements: [text('高亮块内标题')] },
  });
  blocks.push({
    block_id: 'rich-callout-1-quote',
    block_type: 15,
    parent_id: 'rich-callout-1',
    quote: { elements: [text('高亮块内引用', {
      background_color: 13,
      link: { url: 'https://example.com/callout-quote' },
    })] },
  });
  blocks.push({
    block_id: 'rich-callout-1-list',
    block_type: 12,
    parent_id: 'rich-callout-1',
    children: ['rich-callout-1-list-child'],
    bullet: { elements: [text('高亮块内列表')] },
  });
  blocks.push({
    block_id: 'rich-callout-1-list-child',
    block_type: 12,
    parent_id: 'rich-callout-1-list',
    bullet: { elements: [text('嵌套列表项')] },
  });

  addTopLevel({
    block_id: 'rich-source',
    block_type: 49,
    parent_id: 'rich-page',
    children: [
      'rich-source-heading',
      'rich-source-paragraph',
      'rich-source-list',
      'rich-source-quote',
      'rich-source-table',
      'rich-source-image',
    ],
    source_synced: {
      align: 2,
      elements: [text('同步标题 '), equation('s = t')],
    },
  });
  blocks.push({
    block_id: 'rich-source-heading',
    block_type: 4,
    parent_id: 'rich-source',
    heading2: { elements: [text('同步块内标题')] },
  });
  blocks.push(richTextBlock(
    'rich-source-paragraph',
    'rich-source',
    [text('同步正文与安全链接', {
      bold: true,
      italic: true,
      strikethrough: true,
      underline: true,
      inline_code: true,
      text_color: 5,
      background_color: 2,
      link: { url: 'https://example.com/source' },
    })],
  ));
  blocks.push({
    block_id: 'rich-source-list',
    block_type: 12,
    parent_id: 'rich-source',
    children: ['rich-source-list-callout'],
    bullet: { elements: [text('列表包含高亮块')] },
  });
  blocks.push({
    block_id: 'rich-source-list-callout',
    block_type: 19,
    parent_id: 'rich-source-list',
    children: ['rich-source-list-callout-text'],
    callout: {
      background_color: 8,
      border_color: 1,
      text_color: 1,
      emoji_id: 'gift',
    },
  });
  blocks.push(richTextBlock(
    'rich-source-list-callout-text',
    'rich-source-list-callout',
    [text('列表内高亮块')],
  ));
  blocks.push({
    block_id: 'rich-source-quote',
    block_type: 15,
    parent_id: 'rich-source',
    quote: { elements: [text('同步引用背景链接', {
      background_color: 13,
      link: { url: 'https://example.com/source-quote' },
    })] },
  });
  blocks.push({
    block_id: 'rich-source-table',
    block_type: 31,
    parent_id: 'rich-source',
    children: [
      'rich-cell-a', 'rich-cell-b', 'rich-cell-c', 'rich-cell-d',
    ],
    table: {
      cells: ['rich-cell-a', 'rich-cell-b', 'rich-cell-c', 'rich-cell-d'],
      property: { row_size: 2, column_size: 2 },
    },
  });
  const cellElements = [
    [text('列 A')],
    [text('列 B')],
    [equation('p | q')],
    [text('值 B', {
      bold: true,
      underline: true,
      link: { url: 'https://example.com/table' },
    })],
  ];
  for (const [index, suffix] of ['a', 'b', 'c', 'd'].entries()) {
    blocks.push({
      block_id: `rich-cell-${suffix}`,
      block_type: 32,
      parent_id: 'rich-source-table',
      children: [`rich-cell-${suffix}-text`],
      table_cell: {},
    });
    blocks.push(richTextBlock(
      `rich-cell-${suffix}-text`,
      `rich-cell-${suffix}`,
      cellElements[index],
    ));
  }
  blocks.push({
    block_id: 'rich-source-image',
    block_type: 27,
    parent_id: 'rich-source',
    image: { token: 'img_rich_example' },
  });

  return {
    items: [
      {
        block_id: 'rich-page',
        block_type: 1,
        children: pageChildren,
        page: { elements: [text('富内容夹具')] },
      },
      ...blocks,
    ],
  };
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await writeFile(
    new URL('../fixtures/feishu-rich-content.json', import.meta.url),
    `${JSON.stringify(buildRichFixture(), null, 2)}\n`,
    'utf8',
  );
}
```

运行：

```sh
node tests/helpers/feishu-rich-fixture.mjs
```

测试读取 JSON 后必须 `deepEqual(buildRichFixture())`，并从 fixture 收集字段，明确断言文字色为 `1..7`、文字背景为 `1..15`、Callout 背景为 `1..15`、Callout 边框为 `1..7`，防止生成器或 JSON 漂移。fixture 已同时包含三处正文标题、容器与列表双向嵌套、引用、表格、图片、公式样式链接和缺省/两个已知 emoji。

- [ ] **Step 6: 运行 GREEN 并提交**

```sh
node --experimental-strip-types --test \
  tests/feishu-semantics.test.mjs \
  tests/feishu-conversion.test.mjs
git add \
  scripts/feishu/blocks.mjs \
  scripts/feishu/semantics.mjs \
  tests/feishu-semantics.test.mjs \
  tests/feishu-conversion.test.mjs \
  tests/helpers/feishu-rich-fixture.mjs \
  tests/fixtures/feishu-rich-content.json \
  tests/fixtures/feishu-reference-synced.json
git diff --cached --check
git commit -m "feat: normalize Feishu rich content blocks"
```

### Task 6: 服务端预渲染公式并实施全部预算

**Files:**
- Create: `scripts/feishu/markdown.mjs`
- Create: `tests/feishu-markdown.test.mjs`

- [ ] **Step 1: 先写 KaTeX 选项和 wrapper 测试**

创建 `tests/feishu-markdown.test.mjs`，注入 spy：

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { renderFeishuDocument } from '../scripts/feishu/markdown.mjs';

test('renders equations with fixed KaTeX safety options and source metadata', () => {
  const calls = [];
  const document = equationDocument('Ｅ = mc^2', 'inline');
  const result = renderFeishuDocument(document, {
    katexRender(source, options) {
      calls.push({ source, options });
      return '<span\nclass="katex|double\r\nvalue" data-single=\'single|\r\nvalue\'>visual| `literal` *em* _under_ [link](x) \\slash\r\nmath</span>';
    },
  });

  assert.deepEqual(calls, [{
    source: 'E = mc^2',
    options: {
      displayMode: false,
      output: 'htmlAndMathml',
      throwOnError: true,
      trust: false,
      strict: 'error',
      maxSize: 20,
      maxExpand: 1000,
    },
  }]);
  assert.match(result.conversion.markdown, /class="feishu-equation feishu-equation--inline"/);
  assert.match(
    result.conversion.markdown,
    new RegExp(`data-feishu-equation-source="${Buffer.from('E = mc^2').toString('base64url')}"`),
  );
  assert.match(
    result.conversion.markdown,
    /visual&#124; &#96;literal&#96; &#42;em&#42; &#95;under&#95; &#91;link&#93;&#40;x&#41; &#92;slash&#13;&#10;math/,
  );
  assert.match(
    result.conversion.markdown,
    /<span class="katex&#124;double&#13;&#10;value" data-single='single&#124;&#13;&#10;value'>/,
  );
  assert.equal(result.issues.length, 0);
});
```

把该测试表驱动执行 `['inline', false, 'feishu-equation--inline']` 与 `['block', true, 'feishu-equation--block']` 两行：两者都检查完整固定 options，且分别否定另一种 wrapper class。spy 返回值继续使用上面的复杂 HTML；因此自动测试必须直接证明语义 `display: 'block'` 会传 `displayMode: true`，不能只由浏览器 overflow 间接推断。

再用真实 KaTeX 表驱动断言 `\\includegraphics`、`\\htmlClass`、`\\htmlStyle`、`\\htmlId`、`\\htmlData`、`\\href` 全部产生 `invalid_equation`；普通数学颜色命令可通过但不能产生作者指定属性名。

另外 import `markdownToHtml` from `satteri`，把真实 `\\text{https://visible.example/path}`、`\\text{HTTPS://VISIBLE.EXAMPLE/PATH}` 公式和一个 spy 同时含大小写 URL 的可见 text node、MathML annotation URL 的公式 wrapper 送入仓库实际 Markdown renderer，并读取 `markdownToHtml(markdown).html`。断言输出没有任何 `<a\b`，仍含固定空注释 autolink break，去标签/注释后的可见文字及 annotation 源码逐字不变。该回归必须覆盖默认 Markdown 模式；全文受控 HTML block 天然不二次解析，不能代替此测试。

- [ ] **Step 2: 先写四类预算边界测试**

使用注入的 `katexRender` 分别覆盖：

```js
const FORMULA_LIMITS = {
  count: 200,
  sourceBytes: 8 * 1024,
  renderedBytes: 512 * 1024,
  totalRenderedBytes: 4 * 1024 * 1024,
};
```

每类测试同时检查等于上限成功、上限加一失败；失败码为 `formula_budget_exceeded`。公式数量或任一源码字节预检失败时，spy 的调用次数必须为 0，证明 KaTeX 尚未执行；单个/总渲染结果预算在 KaTeX 返回后计算。单次调用中放入两个语法无效但通过前置预算的公式，断言 KaTeX 被调用两次且两个 `invalid_equation` 都被收集；公开 issue message 不包含公式源码或 KaTeX 原始 HTML。

- [ ] **Step 3: 运行测试并观察 RED**

```sh
node --experimental-strip-types --test tests/feishu-markdown.test.mjs
```

预期：FAIL，原因是 renderer 模块不存在。

- [ ] **Step 4: 创建同步 renderer 入口与预渲染阶段**

在 `scripts/feishu/markdown.mjs`：

```js
import katex from 'katex';

export const FORMULA_LIMITS = Object.freeze({
  count: 200,
  sourceBytes: 8 * 1024,
  renderedBytes: 512 * 1024,
  totalRenderedBytes: 4 * 1024 * 1024,
});

function issue(code, message, blockId) {
  return { code, message, ...(blockId ? { blockId } : {}) };
}

export function renderFeishuDocument(
  document,
  { katexRender = katex.renderToString } = {},
) {
  const issues = [];
  const renderedEquations = preRenderEquations(document, katexRender, issues);
  if (issues.length > 0) return { conversion: null, issues };
  return {
    conversion: serializeDocument(document, renderedEquations),
    issues: [],
  };
}
```

`preRenderEquations()` 分两阶段：先遍历整棵语义树并 NFKC 规范化源码，统一检查 count 和每个 `Buffer.byteLength(source, 'utf8')`；只要这阶段有 issue 就直接返回，KaTeX 调用次数为 0。前置预算全通过后，逐个调用 KaTeX，继续收集所有 parse error、单个 output bytes 与累计 output bytes；输出预算按 KaTeX 返回的原始 `renderedHtml` UTF-8 字节计算。只有所有公式都成功后才调用最终序列化。固定选项使用 Step 1 的完整对象；`displayMode` 只由语义节点 `display === 'block'` 决定。Task 6 的测试文档只含 paragraph/equation；此任务同时实现 document + paragraph + inline/equation 的完整 serializer 路径和四字段返回，遇到其他 `node.kind` 明确抛出内部 task-order error。Task 7 在公共入口接线前替换为全部 Block serializer，因此部分 serializer 不会进入同步生产链路。

- [ ] **Step 5: 实现上下文安全的 KaTeX HTML 编码**

添加 `encodeKatexForMarkdown(html)` 状态机。它逐字符区分标签内、双引号属性、单引号属性和文本节点，并把合法 named / decimal / hexadecimal HTML entity 当作不可拆分 token：

- 文本节点中，除合法 entity 外的全部 ASCII punctuation（U+0021–U+002F、U+003A–U+0040、U+005B–U+0060、U+007B–U+007E）按十进制实体输出，CR/LF 分别输出 `&#13;` / `&#10;`。这覆盖 KaTeX 可见 span 和 MathML `annotation` 中的反斜杠、反引号、`*`、`_`、链接标点、`|`，禁止后续 Markdown 二次解释。
- 单/双引号属性值中的 `|`、CR、LF 分别输出 `&#124;`、`&#13;`、`&#10;`；其他属性字符保持原样。
- 标签结构中的 CR/LF 规范为一个空格；不使用跨标签正则，也不重新解析 TeX。

文本节点先把合法 entity 解码为 Unicode scalar，再统一送入 `encodeMarkdownEmbeddedText()`，保证 URL 即使原先混用 named/decimal/hex entity 也能识别。该 helper 用 ASCII case-insensitive 检测计算 GFM autolink break offset：在 `http:` / `https:` / `mailto:` 的冒号、`www.` 的点、email-like 地址的 `@` 之前插入固定空注释 `<!---->`，随后再编码当前字符；混合/全大写 `HTTPS:`、`WWW.` 走同一路径。空注释不改变 DOM `textContent`，但禁止 Sätteri 在 KaTeX 可见 span 或 MathML annotation 中插入 `<a>`。attribute 与结构状态不得插入该注释。

Step 1 的 spy 必须精确证明文本节点的 Markdown 标点/autolink break、单双引号属性值和标签结构换行走了三条不同路径；另把结果送入真实 Sätteri，断言不含意外 `<em>`、`<code>` 或 `<a>`。

公式 wrapper 固定为：

```js
function equationHtml(node, renderedHtml) {
  const source = Buffer.from(node.source.normalize('NFKC'), 'utf8')
    .toString('base64url');
  const display = node.display === 'block' ? 'block' : 'inline';
  return `<span class="feishu-equation feishu-equation--${display}" data-feishu-equation-source="${source}">${encodeKatexForMarkdown(renderedHtml)}</span>`;
}
```

- [ ] **Step 6: 运行 GREEN 并提交**

```sh
node --experimental-strip-types --test tests/feishu-markdown.test.mjs
git add scripts/feishu/markdown.mjs tests/feishu-markdown.test.mjs
git diff --cached --check
git commit -m "feat: render Feishu equations with KaTeX"
```

### Task 7: 完成默认 Markdown 与全文受控 HTML 序列化

**Files:**
- Modify: `scripts/feishu/markdown.mjs`
- Modify: `scripts/feishu/blocks.mjs`
- Modify: `tests/feishu-markdown.test.mjs`
- Modify: `tests/feishu-conversion.test.mjs`

- [ ] **Step 1: 先写受控行内栈测试**

在 `tests/feishu-markdown.test.mjs` 构造同一个 text node 同时包含 inlineCode、bold、italic、strikethrough、underline、textColor、backgroundColor 与 href，期望精确输出：

```html
<a class="feishu-link" href="https://example.com/docs"><span class="feishu-text-color--red feishu-text-background--light-blue"><u class="feishu-underline"><del><em><strong><code>&lt;x&gt;</code></strong></em></del></u></span></a>
```

再断言：

- 纯 bold/italic/strikethrough/inlineCode/link 在默认模式仍输出现有 Markdown。
- 任一 underline、颜色、背景或 equation 令该 inline 的完整样式栈输出 HTML，内部没有 `**`、`~~`、反引号或 Markdown link。
- 纯空白 text run 保持原样，不产生空标签。
- 作者文本中的 `<>&"`、链接属性和代码内容按各自上下文转义。
- 受控 text leaf 的字面 ``*x* _y_ `z` [链接](target) \\ |`` 在普通段落中把所有 ASCII Markdown 标点写成 HTML entity；再由仓库实际 Markdown renderer 渲染，断言可见文本逐字不变，且没有额外生成 `<em>`、`<code>`、`<a>`。
- import `markdownToHtml` from `satteri`，表驱动使用可见文字 `https://visible.example/path`、`HTTPS://VISIBLE.EXAMPLE/PATH`、`www.example.com`、`WWW.EXAMPLE.COM`、`user@example.com`、`mailto:user@example.com`，检查 `markdownToHtml(markdown).html`。无 Feishu link 样式时最终没有 `<a>`；带显式安全 href `https://target.example/` 时最终恰好一个最外层 `<a class="feishu-link" href="https://target.example/">`，不能被 GFM autolink 变成嵌套 anchor。去标签和 `<!---->` 后的 DOM 可见文字逐字不变；KaTeX annotation 复用同一个 case-insensitive helper。
- 同一受控 text leaf 位于默认 Markdown 的 GFM table cell 时，CR/LF 也写成实体，仍只有原定行列数；含 `|` 的作者 href 在 table context 中不会拆列。

- [ ] **Step 2: 先写受控文档完整结构测试**

对 `feishu-rich-content.json` 断言：

```js
assert.equal(result.markdown.match(/<div class="feishu-document">/g)?.length, 1);
assert.match(result.markdown, /^<div class="feishu-document">/);
assert.match(result.markdown, /<aside class="feishu-callout /);
assert.match(result.markdown, /<section class="feishu-source-synced">/);
assert.match(result.markdown, /data-feishu-search-ui>↻ 同步内容<\/span>/);
assert.match(result.markdown, /<h2 id="feishu-heading-1" data-feishu-heading-text="[A-Za-z0-9_-]+">/);
assert.match(result.markdown, /<ul>.*<li>.*<aside class="feishu-callout /s);
assert.match(result.markdown, /<aside class="feishu-callout .*<blockquote>/s);
assert.match(result.markdown, /class="feishu-task-list__marker" aria-hidden="true">☑<\/span><span class="visually-hidden">已完成：<\/span>[\s\S]*受控待办事项/);
assert.match(result.markdown, /class="feishu-task-list__marker" aria-hidden="true">☐<\/span><span class="visually-hidden">未完成：<\/span>[\s\S]*未完成待办事项/);
assert.doesNotMatch(result.markdown, /\n[-*] |\n> |```|\uE000feishu-media:[^)"<]+\uE001(?!")/);

for (const [prefix, tokens] of [
  ['feishu-text-color--', Object.values(FONT_COLOR_BY_ENUM)],
  ['feishu-text-background--', Object.values(FONT_BACKGROUND_BY_ENUM)],
  ['feishu-callout--background-', Object.values(CALLOUT_BACKGROUND_BY_ENUM)],
  ['feishu-callout--border-', Object.values(CALLOUT_BORDER_BY_ENUM)],
  ['feishu-callout--text-', Object.values(FONT_COLOR_BY_ENUM)],
]) {
  for (const token of tokens) {
    assert.match(result.markdown, new RegExp(`${prefix}${token}(?:["\\s])`));
  }
}
```

上述测试文件显式从 `semantics.mjs` import 四张枚举 Map；它验证 serializer 确实发出每一个规范化 token class，不能只依赖 Task 11 的 CSS selector 数量。

另构造不含 Callout/SourceSynced、标题只有旧样式但段落有下划线/公式的文档，断言没有 `.feishu-document`，基础块仍为 Markdown，受控 inline 作为单行 HTML 输出。

再用最小、已规范化语义树表驱动锁住 renderer 边界：SourceSynced 分别传 `align: 'left' | 'center' | 'right'`，只产生对应的 `--align-left|center|right`，空 title 省略 title div；Callout 传 `{ emoji: '🎁', background: null, border: null, textColor: null }`，产生带 `aria-hidden="true"` 的默认 emoji，且不产生任何 `--background-*`、`--border-*`、`--text-*` class。原始缺失字段、align 枚举 `1`–`3` 与默认 gift 的规范化只由 Task 5 的语义/公共入口测试负责，renderer 不得重新解释飞书原始枚举。

- [ ] **Step 3: 运行测试并观察 RED**

```sh
node --experimental-strip-types --test \
  --test-name-pattern='controlled inline|controlled document|rich-content fixture' \
  tests/feishu-markdown.test.mjs tests/feishu-conversion.test.mjs
```

预期：公式以外的节点尚无 serializer，结构断言失败。

- [ ] **Step 4: 实现固定行内序列化顺序**

在 `scripts/feishu/markdown.mjs` 让 `escapeControlledMarkdownText(value)` 复用 Task 6 的 `encodeMarkdownEmbeddedText(value)`：它先按原始可见文本以 ASCII case-insensitive 方式计算 `http/https/mailto` scheme、`www.` 与 email 的 GFM autolink break offset，在对应冒号/点/`@` 前插入固定空注释 `<!---->`，再完成 HTML text 转义、把全部 ASCII punctuation 写成十进制 entity，并把 CR/LF 写成 `&#13;` / `&#10;`。这不是视觉转义，而是阻止默认 Markdown 路径对 `<u>...</u>`、颜色 span 和公式内部文字再次应用 emphasis、code、link、table/autolink 语法。生成的空注释、wrapper 标签与固定 class 不经过实体编码；作者原文中的 HTML/comment 仍只作为文字转义。

再让受控 inline 从内到外严格执行：

```js
let value = node.kind === 'equation'
  ? equationHtml(node, renderedEquations.get(node))
  : escapeControlledMarkdownText(node.value);
if (style.inlineCode) value = `<code>${value}</code>`;
if (style.bold) value = `<strong>${value}</strong>`;
if (style.italic) value = `<em>${value}</em>`;
if (style.strikethrough) value = `<del>${value}</del>`;
if (style.underline) value = `<u class="feishu-underline">${value}</u>`;
const colorClasses = [
  style.textColor && `feishu-text-color--${style.textColor}`,
  style.backgroundColor && `feishu-text-background--${style.backgroundColor}`,
].filter(Boolean).join(' ');
if (colorClasses) value = `<span class="${colorClasses}">${value}</span>`;
if (style.href) value = `<a class="feishu-link" href="${escapeControlledHref(style.href, context)}">${value}</a>`;
```

所有进入受控 HTML 的显式 Feishu link 固定带 `class="feishu-link"`，供 Task 11 覆盖全局 accent link 色并继承当前可访问前景；纯默认 Markdown link 不加 class，保持旧行为。`escapeControlledHref()` 先执行标准 attribute 转义；仅在 `context.markdownTableCell === true` 时再把 `|`、CR、LF 实体化。默认 Markdown table serializer 必须把该 context 传给 cell 内全部 inline leaf；全文受控 HTML table 不需要这个额外 table 规则。公式节点的 `inlineCode` 已在语义层拒绝；公式叶节点仍可接受其余强调、颜色和链接。

- [ ] **Step 5: 实现两种文档 serializer**

默认模式复用迁移后的现有 Markdown helper，保持所有 legacy golden 行为。全文模式固定映射：

| 语义节点 | 受控 HTML |
| --- | --- |
| paragraph | `<p>` |
| heading | `<h1>`–`<h6>`，连续 `feishu-heading-N` |
| bullet / ordered | 相邻同类项分组为 `<ul>` / `<ol>`，嵌套 children 位于 `<li>` 内 |
| todo | `<ul class="feishu-task-list">`；`☑` / `☐` 使用 `.feishu-task-list__marker[aria-hidden="true"]`，随后复用全局 `.visually-hidden` 输出“已完成：”/“未完成：” |
| quote | `<blockquote>` |
| code | `<pre><code class="language-<mapped>">`，内容只做 HTML text 转义 |
| divider | `<hr>` |
| image | `<img src="<media placeholder>" alt="图片">` |
| table | 第一行为 `<thead>`，其余为 `<tbody>`，cell 使用 `<th>` / `<td>` |
| callout | `<aside>` + emoji + content |
| sourceSynced | `<section>` + UI label + optional title + content |

Callout 固定结构：

```html
<aside class="feishu-callout feishu-callout--background-light-red feishu-callout--border-red feishu-callout--text-blue">
  <span class="feishu-callout__emoji" aria-hidden="true">🎁</span>
  <div class="feishu-callout__content"></div>
</aside>
```

缺失颜色时对应 class 不出现；子级显式文字颜色 class 自然覆盖继承。

SourceSynced 固定结构：

```html
<section class="feishu-source-synced">
  <span class="feishu-source-synced__label" data-feishu-search-ui>↻ 同步内容</span>
  <div class="feishu-source-synced__title feishu-source-synced__title--align-right"></div>
  <div class="feishu-source-synced__content"></div>
</section>
```

标题或 children 为空时省略对应空 div；二者都空时仍保留 section 与 label。

受控标题的 `data-feishu-heading-text` 使用可见文字、inline code 内容和每个公式一次 NFKC 源码，移除样式与 href 后折叠空白，再以 UTF-8 Base64URL 无 padding 编码。所有标题按文档序连续编号，不使用 block ID。

- [ ] **Step 6: 统一媒体和返回契约**

把 `mediaPlaceholder()`、媒体首次出现去重和 `{ token, placeholder }` 登记迁入 renderer；Markdown image 和 HTML image 必须调用同一个登记函数。`serializeDocument()` 最终只返回：

```js
{
  markdown,
  mediaTokens,
  mediaReferences,
  warnings: [...document.warnings],
}
```

非空输出恰好一个尾随换行；空正文为 `''`。相同输入两次输出 `deepEqual`。

- [ ] **Step 7: 接回公共入口并聚合错误**

`blocksToMarkdown(items)` 保持同步签名：

```js
export function blocksToMarkdown(items) {
  const { blocks, root } = validateBlocks(items);
  const normalized = normalizeFeishuDocument({ blocks, root });
  if (normalized.issues.length > 0) {
    throw new FeishuConversionError(normalized.issues);
  }
  const rendered = renderFeishuDocument(normalized.document);
  if (rendered.issues.length > 0) {
    throw new FeishuConversionError(rendered.issues);
  }
  return rendered.conversion;
}
```

更新现有 `feishu-document.json` 测试：要求 `<u class="feishu-underline"> 下划线</u>`，并把原来的 underline warning 期望改成 `[]`。legacy fixture 继续承担逐字节兼容证明。

把现有 dangerous-link 公共入口回归升级为同一文档包含两个 unsafe link 和一个 unknown style，断言抛出值 `instanceof FeishuConversionError`，且 `error.issues.map(({ code }) => code)` 精确等于 `['unsafe_link', 'unsafe_link', 'unsupported_text_style']`；公开 message 不含 credentials、完整 URL 或正文。这个测试与 Task 4 的语义层聚合测试共同证明 Task 7 删除过渡 blocks 校验后没有退回 fail-fast 普通 Error。

- [ ] **Step 8: 运行 GREEN 并提交**

```sh
node --experimental-strip-types --test \
  tests/feishu-markdown.test.mjs \
  tests/feishu-semantics.test.mjs \
  tests/feishu-conversion.test.mjs
git add scripts/feishu/blocks.mjs scripts/feishu/markdown.mjs \
  tests/feishu-markdown.test.mjs tests/feishu-conversion.test.mjs
git diff --cached --check
git commit -m "feat: serialize Feishu rich content"
```

预期：旧转换测试全部通过，新 fixture 输出单一受控 wrapper，返回字段严格不变。

### Task 8: 保护同步事务、公开错误与幂等性

**Files:**
- Modify: `tests/feishu-sync.test.mjs`
- Verify/minimal Modify: `scripts/feishu/sync.mjs`

- [ ] **Step 1: 扩展测试 client 以注入 Block fixture**

保留现有 `calls`、封面参数和四个 client 方法，只给 `stableClient()` 增加可选 `blocks`；默认值仍由现有 `body` 生成，并在 `listDocumentBlocks` 返回克隆：

```js
function stableClient({
  records = [publishedRecord()],
  body = '来自飞书的正文',
  blocks = documentBlocks(body),
  coverBytes = COVER_IMAGE_BYTES,
  coverContentType = 'image/png',
  coverFileToken = 'cover_token',
} = {}) {
  const calls = {
    list: [],
    documents: [],
    blocks: [],
    media: [],
  };
  const client = {
    async listPublishedRecords(appToken, tableId) {
      calls.list.push({ appToken, tableId });
      return structuredClone(records);
    },
    async getDocument(documentId) {
      calls.documents.push(documentId);
      return {
        document_id: documentId,
        revision_id: 7,
        title: '飞书文档标题',
      };
    },
    async listDocumentBlocks(documentId, revisionId) {
      calls.blocks.push({ documentId, revisionId });
      return structuredClone(blocks);
    },
    async downloadMedia(fileToken, extra) {
      calls.media.push({ fileToken, extra });
      const isCover = fileToken === coverFileToken;
      return {
        bytes: isCover
          ? new Uint8Array(coverBytes)
          : new TextEncoder().encode('body-image-bytes'),
        contentType: isCover ? coverContentType : 'image/png',
      };
    },
  };
  return { client, calls };
}
```

- [ ] **Step 2: 先写合法富内容 warning 与幂等测试**

读取 `feishu-rich-content.json`，在临时 `makeRoot()` 中同步两次，断言：

```js
assert.equal(first.changed, true);
assert.equal(second.changed, false);
assert.deepEqual(second.warnings, []);
assert.deepEqual(await generatedSnapshot(root), firstSnapshot);
```

生成 Markdown 中应含 `.feishu-document`、`.feishu-callout`、`.feishu-equation`，且不含真实 document/record/block ID。

- [ ] **Step 3: 先写失败不替换与公开脱敏测试**

分别注入：空公式、非法公式、公式预算超限、type 50 ReferenceSynced。每次在失败前 `await generatedSnapshot(root)` 与 `await generatedPublicOutput(root)`，失败后再次 await 并逐字节相等。公开错误只允许包含 build phase 与公开 slug：

```js
assert.match(publicMessage, /build/);
assert.match(publicMessage, /example-post/);
assert.doesNotMatch(
  publicMessage,
  /document_private|block_private|record_private|\\htmlClass|E = mc\^2/,
);
```

- [ ] **Step 4: 运行测试并观察 RED**

```sh
node --experimental-strip-types --test \
  --test-name-pattern='rich content|equation|reference synced' \
  tests/feishu-sync.test.mjs
```

预期：至少合法 rich fixture 或新错误断言失败；现有同步事务测试保持通过。

- [ ] **Step 5: 只在测试证明需要时调整同步层**

`buildNextState()` 继续在 `writeStage()` 和 `replaceOutputs()` 前调用 `blocksToMarkdown()`。现有 `publicSyncFailureMessage()` 已只公开 phase 和 slug，不公开 `error.message`；给转换调用补上与封面错误一致的 slug 弱映射：

```js
let converted;
try {
  converted = blocksToMarkdown(stable.blocks);
} catch (error) {
  if (error instanceof Error) syncFailureSlug.set(error, record.slug);
  throw error;
}
```

`inSyncPhase('build', ...)` 继续设置公开 phase；内部异常可保留 `blockId` 供诊断，但公开结果不得包含 document、record、block ID 或公式源码。合法 underline/color 不再生成 warning；代码语言回退 warning 保持原顺序与字段。

- [ ] **Step 6: 运行 GREEN 并提交**

```sh
node --experimental-strip-types --test tests/feishu-sync.test.mjs
git add tests/feishu-sync.test.mjs
if ! git diff --quiet -- scripts/feishu/sync.mjs; then
  git add scripts/feishu/sync.mjs
fi
git diff --cached --check
git commit -m "test: protect rich content sync transactions"
```

预期：所有同步测试 0 fail，真实生成目录没有变化。

### Task 9: 建立 Markdown / 受控 HTML 双状态扫描器

**Files:**
- Create: `src/lib/feishu-markup.ts`
- Create: `tests/feishu-markup.test.mjs`

- [ ] **Step 1: 写公共类型和正常路径测试**

创建 `tests/feishu-markup.test.mjs`，通过 Node type stripping import 新模块。测试以下接口：

```ts
export type FeishuMarkupMode = 'markdown' | 'controlled-document';
export type FeishuCodeKind =
  | 'markdown-fence'
  | 'markdown-code-span'
  | 'html-pre'
  | 'html-code';
export interface FeishuCodeRegion { kind: FeishuCodeKind; raw: string; content: string; }
export interface FeishuEquationRegion {
  raw: string;
  source: string;
  display: 'inline' | 'block';
}
export interface FeishuSearchUiRegion { raw: string; }
export interface ArticleHeading { depth: number; slug: string; text: string; }
export interface FeishuMarkupHandlers {
  code?: (region: FeishuCodeRegion) => string;
  equation?: (region: FeishuEquationRegion) => string;
  searchUi?: (region: FeishuSearchUiRegion) => string;
}
export interface FeishuMarkupResult {
  value: string;
  mode: FeishuMarkupMode;
  headings: readonly ArticleHeading[] | undefined;
}
export function decodeFeishuHtmlEntities(value: string): string;
export function transformFeishuMarkup(
  source: string,
  handlers?: FeishuMarkupHandlers,
): FeishuMarkupResult;
```

正常路径测试必须覆盖可变长度 backtick/tilde fence、比 opener 更长的合法 closing fence、未闭合 fence 一直延伸到 EOF、可变长度 inline code、唯一 `<div class="feishu-document">`、HTML `<pre>/<code>`、void `<img>`/`<hr>`、嵌套 KaTeX span、一个公式 wrapper、一个 UI wrapper、空 `data-feishu-heading-text=""` 和连续受控标题。HTML code 放入 `&lt;`、`&amp;`、`&#124;`、`&#x41;`、未知 `&copy;` 与 `https<!---->&#58;&#47;&#47;private.example/path`，断言前四项按现有表解码、未知项原样保留、精确空注释无空格消失且 URL 在 handler 内可完整删除。嵌套 `<pre><code>...</code></pre>` 只调用一次 code handler，以外层 pre 为 region；默认 Markdown 返回 `headings: undefined`；受控文档无标题返回 `[]`。

- [ ] **Step 2: 写代码伪标记与畸形协议测试**

在 Markdown fence、Markdown code span、HTML pre、HTML code 中各放入合法和畸形的：

```html
<span data-feishu-equation-source="QQ">x</span>
<h2 id="feishu-heading-9" data-feishu-heading-text="@@">x</h2>
<span data-feishu-search-ui>同步内容</span>
```

断言它们只触发 code handler，不触发公式/标题/UI handler，也不抛错；代码区之后的真实公式和标题仍被识别。另覆盖受控 HTML 普通文本里的未配对 backtick 和 `~~~`，确认不会切回 Markdown 状态。

非代码区必须用表驱动逐项拒绝：非法 Base64URL、有 padding、非规范编码、非法 UTF-8 字节（例如 Base64URL `_w`）、重复来源属性、未闭合公式 span、标题 ID 不连续/重复、标题标签与 depth 不匹配、重复/嵌套 `.feishu-document`、wrapper 外非空尾部、未闭合 HTML code/pre。部分/近似协议也必须失败，测试值至少包括：

```js
[
  '<div data-feishu-equation-source="eA">x</div>',
  '<span class="feishu-equation" data-feishu-equation-source="eA">x</span>',
  '<span class="feishu-equation feishu-equation--wide" data-feishu-equation-source="eA">x</span>',
  '<span class="feishu-equation feishu-equation--inline extra" data-feishu-equation-source="eA">x</span>',
  '<span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="eA" title="x">x</span>',
  '<h2 id="feishu-heading-1">标题</h2>',
  '<h2 data-feishu-heading-text="5qCH6aKY">标题</h2>',
  '<div id="feishu-heading-1" data-feishu-heading-text="5qCH6aKY">标题</div>',
  '<div class="feishu-source-synced__label" data-feishu-search-ui>同步内容</div>',
  '<span class="extra" data-feishu-search-ui>同步内容</span>',
  '<span class="feishu-source-synced__label" data-feishu-search-ui title="x">同步内容</span>',
]
```

每个值都放在非代码正文和受控文档正文中对应的合法位置，断言抛出 `Invalid controlled Feishu markup`；相同文本放进四类 code region 时不抛错。

- [ ] **Step 3: 运行测试并观察 RED**

```sh
node --experimental-strip-types --test tests/feishu-markup.test.mjs
```

预期：FAIL，原因是模块不存在。

- [ ] **Step 4: 实现一次线性扫描**

创建 `src/lib/feishu-markup.ts`。它会经 `search.ts` 间接进入浏览器模块图，所以只使用 Node 24 与现代浏览器共有的 `atob`、`btoa`、`TextDecoder` 和 typed arrays，不 import `node:*`，也不引用 `Buffer`。

入口先判断首个非空内容是否精确为 `<div class="feishu-document">`；否则留在 Markdown 模式。Markdown 模式逐行识别 fence opener 的字符与长度，同字符 closing run 长度大于等于 opener 即关闭，EOF 也合法结束 code region；逐字符识别 inline code delimiter。受控 HTML 模式使用标签栈并把最外层 `<pre>` 或不在 pre 内的 `<code>` 子树作为一个 code region。

HTML tokenizer 固定把下列元素视为 void，不入栈也不等待 closing tag：

```ts
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
```

严格 Base64URL 解码使用：

```ts
function decodeBase64Url(
  value: string,
  field: string,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): string {
  if (value.length === 0 && allowEmpty) return '';
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${field} Base64URL value.`);
  }
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new Error(`Invalid ${field} Base64URL value.`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  let canonicalBinary = '';
  for (const byte of bytes) canonicalBinary += String.fromCharCode(byte);
  const canonical = btoa(canonicalBinary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  if (canonical !== value) {
    throw new Error(`Non-canonical ${field} Base64URL value.`);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Invalid ${field} UTF-8 value.`);
  }
}
```

公式 wrapper 调用默认 `allowEmpty: false`，只接受固定 class `feishu-equation feishu-equation--inline|block` 和恰好一个非空 `data-feishu-equation-source`；识别后按同名 span 深度跳过整个 KaTeX 子树。标题调用 `{ allowEmpty: true }`，只接受 `h1`–`h6`、`id="feishu-heading-N"`、恰好一个 `data-feishu-heading-text`，且 N 从 1 连续递增；空可见标题的合法编码是空字符串，提取结果保留 `text: ''`，由现有 TOC 过滤逻辑排除。标题开标签只登记元数据，扫描器仍继续扫描其子树，确保标题内部真实 equation handler 被调用一次；只有公式 wrapper 才整体跳过内部 KaTeX 子树。UI wrapper 只接受 `<span class="feishu-source-synced__label" data-feishu-search-ui>` 且无其他属性，handler 收到完整 raw region。把 `search.ts` 当前 `decodeHtmlEntities()` 的六项 named entity、十进制/十六进制数值实体逻辑原样迁为导出的 `decodeFeishuHtmlEntities()`；HTML pre/code handler 的 `content` 先删除精确空注释 `<!---->`（不补空格），再用它解码为可见文本，未知或无分号实体保持原样，不把标签文本当代码内容。其他 HTML comment 不是生成代码内容的一部分，按畸形/普通文本边界处理。Markdown code handler 的 `content` 是去掉 fence/delimiter 后的原文。

- [ ] **Step 5: 运行 GREEN 并提交**

```sh
node --experimental-strip-types --test tests/feishu-markup.test.mjs
git add src/lib/feishu-markup.ts tests/feishu-markup.test.mjs
git diff --cached --check
git commit -m "feat: scan controlled Feishu markup"
```

### Task 10: 接入搜索文本与受控标题目录

**Files:**
- Modify: `src/lib/search.ts`
- Create: `src/lib/feishu-headings.ts`
- Modify: `src/pages/posts/[...id].astro`
- Modify: `src/layouts/PostLayout.astro`
- Modify: `tests/search.test.mjs`
- Create: `tests/feishu-headings.test.mjs`
- Modify: `tests/ui-source.test.mjs`

- [ ] **Step 1: 先写搜索去重与隐私回归**

在 `tests/search.test.mjs` 增加：

```js
test('indexes each Feishu equation source once and removes container UI', () => {
  const markdown = controlledDocumentWithEquation('x + y');
  const text = markdownToSearchText(markdown);
  assert.equal(text.match(/x \+ y/g)?.length, 1);
  assert.doesNotMatch(text, /katex|MathML|同步内容|feishu-/i);
});

test('keeps an equation source protected from generic URL cleanup', () => {
  const source = String.raw`\text{https://formula.example/path}`;
  const text = markdownToSearchText(controlledDocumentWithEquation(source));
  assert.equal((text.match(/\\text\{https:\/\/formula\.example\/path\}/g) ?? []).length, 1);
});

test('keeps controlled visible punctuation while removing its URLs', () => {
  const markdown = '<u class="feishu-underline">字面 &#42;x&#42; &#95;y&#95; &#96;z&#96; &#91;标签&#93; &#124; https&#58;&#47;&#47;private&#46;example&#47;path 尾</u>';
  const text = markdownToSearchText(markdown);
  assert.match(text, /字面 \*x\* _y_ `z` \[标签\] \| 尾/);
  assert.doesNotMatch(text, /https?|private|example|path/);
});
```

同时用四种 code region 放置真实/伪公式属性和私有 URL，断言伪标记作为代码文本保留，但 `https://private.example/path` 继续按现有规则移除；code 后真实公式仍出现一次。非法协议位于代码外时 `markdownToSearchText()` 必须抛错。

- [ ] **Step 2: 运行搜索测试并观察 RED**

```sh
node --experimental-strip-types --test tests/search.test.mjs
```

预期：公式文本重复、UI 残留或新断言抛错。

- [ ] **Step 3: 在通用 HTML 清理前接入扫描器**

在 `src/lib/search.ts` 用显式扩展名 import `transformFeishuMarkup`：

```ts
import {
  decodeFeishuHtmlEntities,
  transformFeishuMarkup,
} from './feishu-markup.ts';
```

`search.ts` 会同时进入 Node 构建和浏览器 search dialog 的模块图，因此 scanner 不得依赖 Node builtin。用 scanner-backed 单一 token 表替换当前 `markdownToSearchText()` 从 `preservedSegments` 声明到旧 fence/inline-code regex 结束的代码；不能在旧 `preserve` 旁再声明第二个 helper，也不能保留旧 code regex。替换后的函数开头为：

```ts
type PreservedPhase = 'literal' | 'final';
const preservedSegments: Array<{
  value: string;
  phase: PreservedPhase;
}> = [];
const preserve = (
  value: string,
  {
    padded = true,
    phase = 'final',
  }: { padded?: boolean; phase?: PreservedPhase } = {},
): string => {
  const token = `\uE000${preservedSegments.length}\uE001`;
  preservedSegments.push({ value, phase });
  return padded ? ` ${token} ` : token;
};

const normalized = markdown.normalize('NFKC').replace(/\r\n?/gu, '\n');
const transformed = transformFeishuMarkup(normalized, {
  code: ({ content }) => preserve(removeUrls(content)),
  equation: ({ source }) => preserve(source.normalize('NFKC')),
  searchUi: () => ' ',
});
let text = transformed.value;
text = text.replace(
  /\\([\\`*{}[\]()#+\-.!_>~|])/gu,
  (_match, character: string) => preserve(character),
);
text = removeUrls(text);
```

随后从现有 `removeReferenceDefinitions()` 与 `replaceInlineLinkTargets()` 继续执行，调整 `removeHtmlMarkup()` 的分隔语义再删除真实标签和防 autolink 空注释。精确空注释 `<!---->` 不补空格；`a, abbr, b, bdi, bdo, cite, data, del, dfn, em, i, kbd, mark, q, rp, rt, ruby, s, samp, small, span, strong, sub, sup, time, u, var, wbr` 的 opening/closing tag 作为 phrasing wrapper 零宽移除；`br` 及 block/unknown tag 继续补一个空格；script/style/template 仍整棵丢弃。HTML code 已由 scanner token 化，不依赖 `code` tag 的通用规则。这样 `<u>飞</u><strong>书</strong>` 得到 `飞书`，跨 wrapper 的 `https` + `://private.example/path` 也能在后续 URL pass 重组。

再在通用实体解码之前调用新 helper `protectLiteralHtmlEntities(text, preserve)`。该 helper 逐个解析与 `decodeFeishuHtmlEntities()` 相同的 entity 语法：若是已知 entity 且解码结果是单个 ASCII punctuation（U+0021–U+002F、U+003A–U+0040、U+005B–U+0060、U+007B–U+007E），用 `preserve(character, { padded: false, phase: 'literal' })` 替换；CR/LF 等空白和非 punctuation 仍留给通用解码；未知 entity 原样保留。然后调用 `decodeFeishuHtmlEntities(text)` 并执行既有 Markdown 标记清理。这样 `&#42;` 等作者字面 entity 不会重新变成 emphasis/link/table 语法，相邻不同样式 run 或被空注释切开的 URL 也不会被插入空格。

在 Markdown 清理后分阶段恢复同一 token 表：先只恢复 `phase: 'literal'`，把 `\uE000` / `\uE001` 继续列为 `URL_TERMINATORS`，再执行第二次 `removeUrls(text)`，最后恢复 `phase: 'final'`。第二遍只删除 HTML/entity/空注释清理后才重组出的受控作者 URL，包括跨样式 run；code token 已在 handler 内清过 URL，equation token 要到第二遍之后才恢复，因此公式源码继续按确认设计完整 protected、只出现一次。最后才做 `\s+` 折叠与 12,000 字符截断。code / equation token 保留两侧 padding，字面 entity token 不加 padding。增加 `前文<公式>后文`、相邻不同样式的 `飞` + `书`、`前文\`code\`后文`、实体化 URL、空注释打断 URL、跨两个 wrapper 的 `https` + `://private.example/path` 与公式 `\\text{https://formula.example/path}` 回归；分别断言公式/code 有搜索分隔、文本得到 `飞书` 而非 `飞 书`、作者 URL 被删除、字面标点完整恢复且公式 source URL 未被第二遍误删。HTML code 已在 scanner 内严格实体解码；Markdown fenced code 保留正文，Markdown inline code 继续执行“换行折叠为一个空格、两端同时有一个空格且含非空白时各去掉一个”的既有可见语义。

- [ ] **Step 4: 运行搜索 GREEN**

```sh
node --experimental-strip-types --test \
  tests/feishu-markup.test.mjs tests/search.test.mjs
```

预期：两个文件 0 fail，原有 code URL 隐私测试继续通过。

- [ ] **Step 5: 先写受控标题提取测试**

创建 `tests/feishu-headings.test.mjs`：

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractFeishuHeadings } from '../src/lib/feishu-headings.ts';

test('returns undefined for ordinary Markdown and controlled headings in order', () => {
  assert.equal(extractFeishuHeadings('## ordinary\n'), undefined);
  assert.deepEqual(extractFeishuHeadings(controlledHeadingDocument()), [
    { depth: 2, slug: 'feishu-heading-1', text: '标题 x + y' },
    { depth: 3, slug: 'feishu-heading-2', text: '重复标题' },
  ]);
});
```

再断言受控文档无标题返回 `[]`，空标题元数据返回 `{ text: '' }`，非法编码、跳号、重复 ID、标签/depth 不一致都抛错；代码内伪标题不参与结果。

- [ ] **Step 6: 创建薄标题入口并接入文章页**

`src/lib/feishu-headings.ts`：

```ts
import {
  transformFeishuMarkup,
  type ArticleHeading,
} from './feishu-markup.ts';

export type { ArticleHeading } from './feishu-markup.ts';

export function extractFeishuHeadings(
  markdown: string,
): readonly ArticleHeading[] | undefined {
  return transformFeishuMarkup(markdown).headings;
}
```

在 `src/pages/posts/[...id].astro` 正文存在性检查后加入：

```ts
import { extractFeishuHeadings } from '../../lib/feishu-headings';

const controlledHeadings = extractFeishuHeadings(post.body);
const articleHeadings = controlledHeadings ?? headings;
```

并把布局参数改为 `headings={articleHeadings}`。在 `PostLayout.astro` 删除本地 `ArticleHeading` interface，改为：

```ts
import type { ArticleHeading } from '../lib/feishu-headings';
```

- [ ] **Step 7: 加源码接线测试并运行 GREEN**

在 `tests/ui-source.test.mjs` 断言文章页 import/call `extractFeishuHeadings(post.body)` 且传 `articleHeadings`，布局 import 共享类型，并且没有新增 `<script>`、`client:*` 或 KaTeX 客户端初始化。读取 `feishu-markup.ts` 并锁住同构边界：

```js
assert.doesNotMatch(feishuMarkupSource, /from\s+['"]node:|\bBuffer\b/);
assert.match(feishuMarkupSource, /\batob\(/);
assert.match(feishuMarkupSource, /new TextDecoder\(['"]utf-8['"],\s*\{\s*fatal:\s*true/);
```

```sh
node --experimental-strip-types --test \
  tests/feishu-headings.test.mjs \
  tests/search.test.mjs \
  tests/ui-source.test.mjs
```

预期：0 fail；无受控标题的文章仍使用 Astro headings。

- [ ] **Step 8: 提交搜索与目录接线**

```sh
git add \
  src/lib/feishu-markup.ts \
  src/lib/feishu-headings.ts \
  src/lib/search.ts \
  src/pages/posts/'[...id].astro' \
  src/layouts/PostLayout.astro \
  tests/feishu-headings.test.mjs \
  tests/search.test.mjs \
  tests/ui-source.test.mjs
git diff --cached --check
git commit -m "feat: index and navigate Feishu rich content"
```

### Task 11: 添加双主题内容样式和对比度门禁

**Files:**
- Create: `src/styles/feishu-content.css`
- Modify: `src/layouts/PostLayout.astro`
- Modify: `tests/design-contrast.test.mjs`
- Modify: `tests/ui-source.test.mjs`

- [ ] **Step 1: 先写样式导入和 class 完整性测试**

在 `tests/ui-source.test.mjs` 断言布局导入顺序：

```ts
import 'katex/dist/katex.min.css';
import '../styles/feishu-content.css';
```

KaTeX CSS 必须在自定义 CSS 前。读取新 CSS，断言包含 7 个 `.feishu-text-color--*`、15 个 `.feishu-text-background--*`、15 个 `.feishu-callout--background-*`、7 个 `.feishu-callout--border-*` 和 7 个 `.feishu-callout--text-*`；断言 `.feishu-equation--inline`、`.feishu-equation--block`、`.feishu-callout`、`.feishu-source-synced`、`.feishu-document > * + *` 存在。再断言结构块出现在 `/* Feishu enum mappings */` 前：

```js
const baseIndex = source.indexOf('.prose .feishu-callout,');
const mappingIndex = source.indexOf('/* Feishu enum mappings */');
assert.ok(baseIndex >= 0 && mappingIndex > baseIndex);
assert.match(
  source,
  /\.prose \.feishu-source-synced\s*\{[^}]*border-color:\s*var\(--line\);[^}]*background:\s*color-mix\(/s,
);
assert.match(
  source,
  /\.feishu-callout--text-red\s*\{\s*--feishu-callout-text:\s*var\(--feishu-fg-red\);\s*\}/,
);
assert.match(
  source,
  /\.feishu-callout :is\(h1, h2, h3, h4, h5, h6, blockquote, code\)\s*\{\s*color:\s*inherit;/,
);
assert.match(
  source,
  /\.prose a\.feishu-link,\s*\.prose a\.feishu-link:hover\s*\{\s*color:\s*inherit;/,
);
assert.match(
  source,
  /\.prose \.feishu-task-list\s*\{[^}]*list-style:\s*none;/s,
);
assert.match(
  source,
  /\[class\*=['"]feishu-text-background--['"]\]\s*\{[^}]*color:\s*var\(--feishu-context-text,\s*var\(--ink\)\);/s,
);
assert.match(
  source,
  /\[class\*=['"]feishu-text-background--['"]\] code\s*\{\s*background:\s*transparent;/,
);
assert.doesNotMatch(
  source.match(/\.prose a\.feishu-link,[\s\S]*?\}/)?.[0] ?? '',
  /--accent-(?:text|hover)/,
);

const mappingContracts = [
  ['feishu-text-color--', 'color', '--feishu-fg-', fontColors],
  ['feishu-text-background--', 'background', '--feishu-font-bg-', fontBackgrounds],
  ['feishu-callout--background-', 'background', '--feishu-callout-bg-', calloutBackgrounds],
  ['feishu-callout--border-', 'border-color', '--feishu-border-', fontColors],
  ['feishu-callout--text-', '--feishu-callout-text', '--feishu-fg-', fontColors],
];
for (const [classPrefix, property, variablePrefix, tokens] of mappingContracts) {
  for (const token of tokens) {
    assert.match(
      source,
      new RegExp(
        `\\.prose \\.${classPrefix}${token}\\s*\\{\\s*${property}:\\s*var\\(${variablePrefix}${token}\\);\\s*\\}`,
      ),
    );
  }
}
```

这里的 `fontColors`、`fontBackgrounds`、`calloutBackgrounds` 使用与 Task 4 相同的显式 token 数组；门禁检查每个 selector 的 RHS，不能只检查 selector 数量。

- [ ] **Step 2: 先写全矩阵对比度测试**

扩展 `tests/design-contrast.test.mjs`，同时读取 `global.css` 与 `feishu-content.css`，分别合并两个文件的 `:root` 和 `:root[data-theme='dark']` token；`--ink` 来自 global，飞书前景/背景来自新文件。遍历每个主题：

- 7 个前景色 × 15 个文字背景色，全部 `contrastRatio >= 4.5`。
- 默认 `--ink` × 15 个文字背景色，覆盖仅设置 `background_color` 的合法组合。
- 7 个前景色 × `--paper`，覆盖仅设置 `text_color` 的正文组合。
- 默认 `--ink` × 15 个 Callout 背景色，全部 `>= 4.5`。
- 7 个 Callout 文字色 × 15 个 Callout 背景色，全部 `>= 4.5`。
- 受控 `.feishu-link` normal/hover 固定 `color: inherit`，因此逐项复用上述 `--ink` 或显式前景矩阵；源码门禁同时禁止它引用全局 `--accent-text` / `--accent-hover`。背景-only link fixture 必须落在这一分支。
- background-only inline 固定使用 `--feishu-context-text, var(--ink)`；普通/SourceSynced quote 不能继承全局 `--muted`，Callout 则把 context 绑定到 `--feishu-callout-text`。因此矩阵同时覆盖普通 quote 的 ink × 15 背景和 Callout 的 7 前景 × 15 文字背景。

失败消息输出主题、前景 token、背景 token 和实际比值。

- [ ] **Step 3: 运行测试并观察 RED**

```sh
node --experimental-strip-types --test \
  tests/design-contrast.test.mjs tests/ui-source.test.mjs
```

预期：样式文件和 import 不存在，测试 FAIL。

- [ ] **Step 4: 定义精确双主题 palette**

创建 `src/styles/feishu-content.css`，完整 token 块如下。文字背景和 Callout 背景必须保留两套不同变量名；8–13 分别使用 `red..purple` 与 `medium-red..medium-purple`：

```css
:root {
  --feishu-fg-red: #8a2737;
  --feishu-fg-orange: #7a3e00;
  --feishu-fg-yellow: #5f4b00;
  --feishu-fg-green: #1f5d3a;
  --feishu-fg-blue: #2257a0;
  --feishu-fg-purple: #633c8f;
  --feishu-fg-gray: #46505c;
  --feishu-border-red: #8a2737;
  --feishu-border-orange: #7a3e00;
  --feishu-border-yellow: #5f4b00;
  --feishu-border-green: #1f5d3a;
  --feishu-border-blue: #2257a0;
  --feishu-border-purple: #633c8f;
  --feishu-border-gray: #46505c;
  --feishu-font-bg-light-red: #fff0f2;
  --feishu-font-bg-light-orange: #fff4e8;
  --feishu-font-bg-light-yellow: #fff9d8;
  --feishu-font-bg-light-green: #eaf8ef;
  --feishu-font-bg-light-blue: #edf4ff;
  --feishu-font-bg-light-purple: #f5efff;
  --feishu-font-bg-medium-gray: #e9edf2;
  --feishu-font-bg-red: #f8dce1;
  --feishu-font-bg-orange: #fbe3cc;
  --feishu-font-bg-yellow: #f4e8ad;
  --feishu-font-bg-green: #d8efdf;
  --feishu-font-bg-blue: #dbe9fb;
  --feishu-font-bg-purple: #e8dcf6;
  --feishu-font-bg-gray: #dfe3e8;
  --feishu-font-bg-light-gray: #f3f5f7;
  --feishu-callout-bg-light-red: #fff0f2;
  --feishu-callout-bg-light-orange: #fff4e8;
  --feishu-callout-bg-light-yellow: #fff9d8;
  --feishu-callout-bg-light-green: #eaf8ef;
  --feishu-callout-bg-light-blue: #edf4ff;
  --feishu-callout-bg-light-purple: #f5efff;
  --feishu-callout-bg-medium-gray: #e9edf2;
  --feishu-callout-bg-medium-red: #f8dce1;
  --feishu-callout-bg-medium-orange: #fbe3cc;
  --feishu-callout-bg-medium-yellow: #f4e8ad;
  --feishu-callout-bg-medium-green: #d8efdf;
  --feishu-callout-bg-medium-blue: #dbe9fb;
  --feishu-callout-bg-medium-purple: #e8dcf6;
  --feishu-callout-bg-gray: #dfe3e8;
  --feishu-callout-bg-light-gray: #f3f5f7;
}

:root[data-theme='dark'] {
  --feishu-fg-red: #ff9aa8;
  --feishu-fg-orange: #ffb26b;
  --feishu-fg-yellow: #e8ce73;
  --feishu-fg-green: #85d6a1;
  --feishu-fg-blue: #8fbaff;
  --feishu-fg-purple: #c8a7ff;
  --feishu-fg-gray: #c4ccd6;
  --feishu-border-red: #ff9aa8;
  --feishu-border-orange: #ffb26b;
  --feishu-border-yellow: #e8ce73;
  --feishu-border-green: #85d6a1;
  --feishu-border-blue: #8fbaff;
  --feishu-border-purple: #c8a7ff;
  --feishu-border-gray: #c4ccd6;
  --feishu-font-bg-light-red: #2b1c20;
  --feishu-font-bg-light-orange: #2c2117;
  --feishu-font-bg-light-yellow: #292617;
  --feishu-font-bg-light-green: #17271e;
  --feishu-font-bg-light-blue: #172233;
  --feishu-font-bg-light-purple: #241b31;
  --feishu-font-bg-medium-gray: #242a31;
  --feishu-font-bg-red: #42232a;
  --feishu-font-bg-orange: #43301f;
  --feishu-font-bg-yellow: #3d371d;
  --feishu-font-bg-green: #203a29;
  --feishu-font-bg-blue: #20334e;
  --feishu-font-bg-purple: #342449;
  --feishu-font-bg-gray: #303740;
  --feishu-font-bg-light-gray: #1b2026;
  --feishu-callout-bg-light-red: #2b1c20;
  --feishu-callout-bg-light-orange: #2c2117;
  --feishu-callout-bg-light-yellow: #292617;
  --feishu-callout-bg-light-green: #17271e;
  --feishu-callout-bg-light-blue: #172233;
  --feishu-callout-bg-light-purple: #241b31;
  --feishu-callout-bg-medium-gray: #242a31;
  --feishu-callout-bg-medium-red: #42232a;
  --feishu-callout-bg-medium-orange: #43301f;
  --feishu-callout-bg-medium-yellow: #3d371d;
  --feishu-callout-bg-medium-green: #203a29;
  --feishu-callout-bg-medium-blue: #20334e;
  --feishu-callout-bg-medium-purple: #342449;
  --feishu-callout-bg-gray: #303740;
  --feishu-callout-bg-light-gray: #1b2026;
}
```

- [ ] **Step 5: 添加固定 class 到 token 映射**

在文件末尾加入 `/* Feishu enum mappings */` 标记，并在标记后显式添加全部 class；Step 6 的结构规则必须插入这个标记之前，确保后置枚举 class 的 `border-color` 不被基础 Callout border 重置。使用下面的完整映射：

```css
/* Feishu enum mappings */
.prose .feishu-text-color--red { color: var(--feishu-fg-red); }
.prose .feishu-text-color--orange { color: var(--feishu-fg-orange); }
.prose .feishu-text-color--yellow { color: var(--feishu-fg-yellow); }
.prose .feishu-text-color--green { color: var(--feishu-fg-green); }
.prose .feishu-text-color--blue { color: var(--feishu-fg-blue); }
.prose .feishu-text-color--purple { color: var(--feishu-fg-purple); }
.prose .feishu-text-color--gray { color: var(--feishu-fg-gray); }
.prose .feishu-text-background--light-red { background: var(--feishu-font-bg-light-red); }
.prose .feishu-text-background--light-orange { background: var(--feishu-font-bg-light-orange); }
.prose .feishu-text-background--light-yellow { background: var(--feishu-font-bg-light-yellow); }
.prose .feishu-text-background--light-green { background: var(--feishu-font-bg-light-green); }
.prose .feishu-text-background--light-blue { background: var(--feishu-font-bg-light-blue); }
.prose .feishu-text-background--light-purple { background: var(--feishu-font-bg-light-purple); }
.prose .feishu-text-background--medium-gray { background: var(--feishu-font-bg-medium-gray); }
.prose .feishu-text-background--red { background: var(--feishu-font-bg-red); }
.prose .feishu-text-background--orange { background: var(--feishu-font-bg-orange); }
.prose .feishu-text-background--yellow { background: var(--feishu-font-bg-yellow); }
.prose .feishu-text-background--green { background: var(--feishu-font-bg-green); }
.prose .feishu-text-background--blue { background: var(--feishu-font-bg-blue); }
.prose .feishu-text-background--purple { background: var(--feishu-font-bg-purple); }
.prose .feishu-text-background--gray { background: var(--feishu-font-bg-gray); }
.prose .feishu-text-background--light-gray { background: var(--feishu-font-bg-light-gray); }
.prose .feishu-callout--background-light-red { background: var(--feishu-callout-bg-light-red); }
.prose .feishu-callout--background-light-orange { background: var(--feishu-callout-bg-light-orange); }
.prose .feishu-callout--background-light-yellow { background: var(--feishu-callout-bg-light-yellow); }
.prose .feishu-callout--background-light-green { background: var(--feishu-callout-bg-light-green); }
.prose .feishu-callout--background-light-blue { background: var(--feishu-callout-bg-light-blue); }
.prose .feishu-callout--background-light-purple { background: var(--feishu-callout-bg-light-purple); }
.prose .feishu-callout--background-medium-gray { background: var(--feishu-callout-bg-medium-gray); }
.prose .feishu-callout--background-medium-red { background: var(--feishu-callout-bg-medium-red); }
.prose .feishu-callout--background-medium-orange { background: var(--feishu-callout-bg-medium-orange); }
.prose .feishu-callout--background-medium-yellow { background: var(--feishu-callout-bg-medium-yellow); }
.prose .feishu-callout--background-medium-green { background: var(--feishu-callout-bg-medium-green); }
.prose .feishu-callout--background-medium-blue { background: var(--feishu-callout-bg-medium-blue); }
.prose .feishu-callout--background-medium-purple { background: var(--feishu-callout-bg-medium-purple); }
.prose .feishu-callout--background-gray { background: var(--feishu-callout-bg-gray); }
.prose .feishu-callout--background-light-gray { background: var(--feishu-callout-bg-light-gray); }
.prose .feishu-callout--border-red { border-color: var(--feishu-border-red); }
.prose .feishu-callout--border-orange { border-color: var(--feishu-border-orange); }
.prose .feishu-callout--border-yellow { border-color: var(--feishu-border-yellow); }
.prose .feishu-callout--border-green { border-color: var(--feishu-border-green); }
.prose .feishu-callout--border-blue { border-color: var(--feishu-border-blue); }
.prose .feishu-callout--border-purple { border-color: var(--feishu-border-purple); }
.prose .feishu-callout--border-gray { border-color: var(--feishu-border-gray); }
.prose .feishu-callout--text-red { --feishu-callout-text: var(--feishu-fg-red); }
.prose .feishu-callout--text-orange { --feishu-callout-text: var(--feishu-fg-orange); }
.prose .feishu-callout--text-yellow { --feishu-callout-text: var(--feishu-fg-yellow); }
.prose .feishu-callout--text-green { --feishu-callout-text: var(--feishu-fg-green); }
.prose .feishu-callout--text-blue { --feishu-callout-text: var(--feishu-fg-blue); }
.prose .feishu-callout--text-purple { --feishu-callout-text: var(--feishu-fg-purple); }
.prose .feishu-callout--text-gray { --feishu-callout-text: var(--feishu-fg-gray); }
```

测试必须按语义 token 数组逐项寻找 class，不能只计数。

- [ ] **Step 6: 在枚举映射之前添加公式和容器布局**

把下面的结构规则插入 `/* Feishu enum mappings */` 之前：

```css
.prose .feishu-document > * + * { margin-block-start: var(--space-5); }
.prose .feishu-underline {
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.16em;
}
.prose a.feishu-link,
.prose a.feishu-link:hover {
  color: inherit;
}
.prose .feishu-task-list {
  list-style: none;
  padding-inline-start: 0;
}
.prose .feishu-task-list__marker {
  display: inline-block;
  inline-size: 1.25em;
}
.prose [class*='feishu-text-background--'] {
  color: var(--feishu-context-text, var(--ink));
  padding-inline: 0.08em;
  border-radius: 0.2em;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.prose [class*='feishu-text-background--'] code {
  background: transparent;
}
.prose [class*='feishu-text-color--'] :is(code, .katex) {
  color: inherit;
}
.prose .feishu-equation {
  max-inline-size: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}
.prose .feishu-equation--inline {
  display: inline-block;
  vertical-align: -0.15em;
}
.prose .feishu-equation--block {
  display: block;
  padding-block: var(--space-2);
}
.prose .feishu-callout,
.prose .feishu-source-synced {
  min-inline-size: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  padding: var(--space-4);
}
.prose .feishu-callout {
  --feishu-callout-text: var(--ink);
  --feishu-context-text: var(--feishu-callout-text);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-3);
  color: var(--feishu-callout-text);
}
.prose .feishu-callout :is(h1, h2, h3, h4, h5, h6, blockquote, code) {
  color: inherit;
}
.prose .feishu-source-synced {
  border-color: var(--line);
  background: color-mix(in srgb, var(--paper-raised) 65%, transparent);
}
.prose .feishu-callout__content,
.prose .feishu-source-synced__content { min-inline-size: 0; }
.prose :is(.feishu-callout__content, .feishu-source-synced__content) > * + * {
  margin-block-start: var(--space-4);
}
.prose .feishu-callout__emoji { line-height: 1.7; }
.prose .feishu-source-synced__label {
  display: inline-flex;
  color: var(--muted);
  font-size: 0.75rem;
  font-weight: 650;
}
.prose .feishu-source-synced__title--align-left { text-align: left; }
.prose .feishu-source-synced__title--align-center { text-align: center; }
.prose .feishu-source-synced__title--align-right { text-align: right; }
.prose :is(
  .feishu-callout__content,
  .feishu-source-synced__content
) :is(ul, ol, blockquote, pre, table) {
  min-inline-size: 0;
  max-inline-size: 100%;
}
.prose :is(.feishu-callout__content, .feishu-source-synced__content) table {
  display: block;
  overflow-x: auto;
}

@media (max-width: 40rem) {
  .prose .feishu-callout,
  .prose .feishu-source-synced {
    padding: var(--space-3);
  }
}
```

`.feishu-link` 只覆盖 global normal/hover accent color，继续复用现有 underline、transition 与全局 focus outline；不得声明 `outline: none`。Task 13 还要读取背景-only link 的 computed color，确认它等于所属文字/Callout 的继承前景。Task list 清除原生圆点，保留 `☑/☐` marker 与 visually-hidden 状态文字。

- [ ] **Step 7: 运行 GREEN 并提交**

```sh
node --experimental-strip-types --test \
  tests/design-contrast.test.mjs tests/ui-source.test.mjs
git add src/styles/feishu-content.css src/layouts/PostLayout.astro \
  tests/design-contrast.test.mjs tests/ui-source.test.mjs
git diff --cached --check
git commit -m "style: render Feishu rich content themes"
```

预期：全颜色矩阵至少 4.5:1，样式源码契约通过。

### Task 12: 用真实 Astro build 验证完整输出

**Files:**
- Modify: `tests/build-output.test.mjs`

- [ ] **Step 1: 在临时项目中生成富内容文章**

在 `tests/build-output.test.mjs` import `blocksToMarkdown` 和 `decodeFeishuHtmlEntities`（来自 `../src/lib/feishu-markup.ts`），并在模块初始化时读取 `feishu-rich-content.json` 和 `feishu-legacy-document.json`。扩展 `runCleanBuild()`：只在它创建的临时项目里调用转换器，把每个媒体 placeholder 替换为 `/media/feishu/build-output-rich.svg`，然后写入临时 `src/content/posts/feishu/rich-content.md`。固定 frontmatter：

```yaml
---
title: 飞书富内容构建夹具
description: 仅用于生产构建验证
pubDate: 2026-07-15
category: 工程
tags:
  - 飞书
featured: false
slug: build-output-feishu-rich-content
---
```

在临时项目同时写入下面的公开测试图片；它只存在于 `temporaryProjectRoot`：

```js
const richSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"',
  ' viewBox="0 0 16 16"><rect width="16" height="16" fill="#2257a0"/></svg>',
].join('');
await writeFile(
  join(
    temporaryProjectRoot,
    'public/media/feishu/build-output-rich.svg',
  ),
  richSvg,
  { encoding: 'utf8', flag: 'wx' },
);
```

转换与正文组装使用：

```js
const converted = blocksToMarkdown(structuredClone(richFixture.items));
const richBody = converted.mediaReferences.reduce(
  (markdown, { placeholder }) =>
    markdown.replaceAll(placeholder, '/media/feishu/build-output-rich.svg'),
  converted.markdown,
);
const richPost = `${richFrontmatter}\n${richBody}`;
```

同一临时 build 再写两篇隔离回归文章：

```js
const legacyConverted = blocksToMarkdown(
  structuredClone(legacyFixture.items),
);
const legacyBody = legacyConverted.mediaReferences.reduce(
  (markdown, { placeholder }) =>
    markdown.replaceAll(placeholder, '/media/feishu/build-output-rich.svg'),
  legacyConverted.markdown,
);
const legacyPost = `---
title: 飞书旧格式构建夹具
description: 验证默认 Markdown 兼容
pubDate: 2026-07-14
category: 工程
tags: []
featured: false
slug: build-output-feishu-legacy
---

${legacyBody}`;

const protocolBlocks = [
  {
    block_id: 'protocol-page',
    block_type: 1,
    children: [
      'protocol-code',
      'protocol-inline-code',
      'protocol-styled-literal',
      'protocol-private-url',
      'protocol-formula',
      'protocol-table',
    ],
    page: { elements: [] },
  },
  {
    block_id: 'protocol-code',
    block_type: 14,
    parent_id: 'protocol-page',
    code: {
      style: { language: 24 },
      elements: [{ text_run: {
        content: '<span data-feishu-equation-source="eA">伪公式</span>\n<h2 id="feishu-heading-9" data-feishu-heading-text="@@">伪标题</h2>\n<span data-feishu-search-ui>伪界面</span>',
        text_element_style: {},
      } }],
    },
  },
  {
    block_id: 'protocol-inline-code',
    block_type: 2,
    parent_id: 'protocol-page',
    text: { elements: [{ text_run: {
      content: [
        '<span data-feishu-equation-source="@@">行内伪公式</span>',
        '<h2 id="feishu-heading-99" data-feishu-heading-text="@@">行内伪标题</h2>',
        '<span data-feishu-search-ui>行内伪界面</span>',
      ].join(' '),
      text_element_style: { inline_code: true },
    } }] },
  },
  {
    block_id: 'protocol-formula',
    block_type: 2,
    parent_id: 'protocol-page',
    text: { elements: [{ equation: {
      content: 'z + 1 + \\text{*x* `y` [z](w)}',
      text_element_style: {},
    } }] },
  },
  {
    block_id: 'protocol-styled-literal',
    block_type: 2,
    parent_id: 'protocol-page',
    text: { elements: [{ text_run: {
      content: '字面 *x* _y_ `z` [链接](target) \\ | 尾\r\n下一行',
      text_element_style: { underline: true, background_color: 2 },
    } }] },
  },
  {
    block_id: 'protocol-private-url',
    block_type: 2,
    parent_id: 'protocol-page',
    text: { elements: [{ text_run: {
      content: '私有链接 https://private.example/path',
      text_element_style: { underline: true },
    } }] },
  },
  {
    block_id: 'protocol-table',
    block_type: 31,
    parent_id: 'protocol-page',
    children: [
      'protocol-cell-a', 'protocol-cell-b',
      'protocol-cell-c', 'protocol-cell-d',
    ],
    table: {
      cells: [
        'protocol-cell-a', 'protocol-cell-b',
        'protocol-cell-c', 'protocol-cell-d',
      ],
      property: { row_size: 2, column_size: 2 },
    },
  },
  ...['a', 'b', 'c', 'd'].flatMap((suffix, index) => {
    const elements = index === 2
      ? [{ equation: {
          content: 'm | n\n% 表格注释\n+ r',
          text_element_style: {
            bold: true,
            underline: true,
            text_color: 1,
            background_color: 2,
            link: { url: 'https://example.com/gfm-table' },
          },
        } }]
      : [{ text_run: {
          content: index === 3
            ? '表格 | *字* `码`\r\n下一行'
            : ['列 A', '列 B', ''][index],
          text_element_style: index === 3
            ? {
                underline: true,
                background_color: 2,
                link: { url: 'https://example.com/a|b' },
              }
            : {},
        } }];
    return [
      {
        block_id: `protocol-cell-${suffix}`,
        block_type: 32,
        parent_id: 'protocol-table',
        children: [`protocol-cell-${suffix}-text`],
        table_cell: {},
      },
      {
        block_id: `protocol-cell-${suffix}-text`,
        block_type: 2,
        parent_id: `protocol-cell-${suffix}`,
        text: { elements },
      },
    ];
  }),
];
const protocolConverted = blocksToMarkdown(protocolBlocks);
const protocolPost = `---
title: 飞书协议代码边界夹具
description: 验证默认 Markdown 代码伪协议
pubDate: 2026-07-13
category: 工程
tags: []
featured: false
slug: build-output-feishu-code-protocol
---

${protocolConverted.markdown}`;
```

把 `richPost` 写入临时 `src/content/posts/feishu/rich-content.md`，把 `legacyPost` 和 `protocolPost` 写入临时 manual 目录；三次 `writeFile` 都使用 `{ encoding: 'utf8', flag: 'wx' }`。

不要写当前 worktree 的真实 `src/content/posts/feishu/` 或 `public/media/feishu/`。

- [ ] **Step 2: 先写文章 HTML 结构断言**

在 build 完成后读取目标 HTML，断言：

- 恰好一个 `.feishu-document`。
- KaTeX 同时存在 `.katex-html` 与 `<math` / MathML。
- Callout 与 SourceSynced 双向嵌套列表；容器内 blockquote、link、strong、em、del、u、code、table、img 都为真实元素。
- 没有原始 `**`、`~~`、Markdown link、fence 或媒体私用区 placeholder。
- 含 `|`、CR/LF、`%` 注释的公式不增加表格列，不截断 HTML。
- 标题 ID 从 `feishu-heading-1` 连续且唯一；桌面和移动 TOC href 都命中实际标题；每个公式源码在目录文字中只出现一次。
- 纯 legacy 临时文章仍使用原 Astro slug，输出不含 `.feishu-document`。

核心测试代码使用稳定结构，不依赖 Astro 资源 hash：

```js
test('build renders the complete controlled Feishu document', async () => {
  const html = await readOutput(
    'posts/build-output-feishu-rich-content/index.html',
  );
  assert.equal((html.match(/class="feishu-document"/g) ?? []).length, 1);
  assert.match(html, /class="katex-html"/);
  assert.match(html, /<math\b/);
  assert.match(html, /class="feishu-source-synced"/);

  const firstCalloutText = html.indexOf('高亮块 1');
  const firstCalloutStart = html.lastIndexOf('<aside', firstCalloutText);
  const firstCalloutEnd = html.indexOf('</aside>', firstCalloutText);
  const calloutListText = html.indexOf('高亮块内列表');
  assert.ok(
    firstCalloutStart >= 0 &&
    calloutListText > firstCalloutStart &&
    calloutListText < firstCalloutEnd,
    'the first callout should contain its list before the callout closes',
  );
  const firstCalloutHtml = html.slice(
    firstCalloutStart,
    firstCalloutEnd + '</aside>'.length,
  );
  assert.match(firstCalloutHtml, /class="feishu-text-color--blue"/);
  assert.match(
    firstCalloutHtml,
    /<span class="feishu-callout__emoji" aria-hidden="true">🎁<\/span>/,
  );
  const calloutHeadingId = firstCalloutHtml.match(
    /<h2\b[^>]*id="(feishu-heading-\d+)"[^>]*>[\s\S]*?高亮块内标题[\s\S]*?<\/h2>/,
  )?.[1];
  assert.ok(calloutHeadingId);
  assert.match(
    firstCalloutHtml,
    /<blockquote\b[^>]*>[\s\S]*高亮块内引用[\s\S]*<\/blockquote>/,
  );
  assert.match(
    firstCalloutHtml,
    /<li\b[^>]*>[\s\S]*高亮块内列表[\s\S]*<ul\b[^>]*>[\s\S]*<li\b[^>]*>[\s\S]*嵌套列表项[\s\S]*<\/li>[\s\S]*<\/ul>[\s\S]*<\/li>/,
  );

  const sourceStart = html.indexOf('<section class="feishu-source-synced">');
  const sourceEnd = html.indexOf('</section>', sourceStart);
  const sourceHtml = html.slice(sourceStart, sourceEnd + '</section>'.length);
  assert.match(
    sourceHtml,
    /class="feishu-source-synced__title feishu-source-synced__title--align-center"/,
  );
  const sourceHeadingId = sourceHtml.match(
    /<h2\b[^>]*id="(feishu-heading-\d+)"[^>]*>[\s\S]*?同步块内标题[\s\S]*?<\/h2>/,
  )?.[1];
  assert.ok(sourceHeadingId);
  const sourceListText = sourceHtml.indexOf('列表包含高亮块');
  const nestedCalloutText = sourceHtml.indexOf('列表内高亮块');
  const sourceListEnd = sourceHtml.indexOf('</li>', sourceListText);
  assert.ok(
    sourceListText >= 0 &&
    nestedCalloutText > sourceListText &&
    nestedCalloutText < sourceListEnd,
    'the source list item should contain a callout before the item closes',
  );
  for (const tag of ['blockquote', 'a', 'strong', 'em', 'del', 'u', 'code', 'table', 'img']) {
    assert.match(
      sourceHtml,
      new RegExp(`<${tag}\\b`),
      `source synced content is missing rendered <${tag}>`,
    );
  }
  assert.match(
    html,
    /<pre><code\b[^>]*>[\s\S]*未配对反引号[\s\S]*伪公式[\s\S]*<\/code><\/pre>/,
  );
  assert.match(
    html,
    /<p\b[^>]*>[\s\S]*<u class="feishu-underline"><code>[\s\S]*HTML 行内伪公式[\s\S]*HTML 行内伪标题[\s\S]*HTML 行内伪界面[\s\S]*<\/code><\/u>[\s\S]*<\/p>/,
  );

  const tableHtml = sourceHtml.match(/<table\b[\s\S]*?<\/table>/)?.[0];
  assert.ok(tableHtml);
  const tableRows = [...tableHtml.matchAll(/<tr\b[\s\S]*?<\/tr>/g)]
    .map((match) => match[0]);
  assert.equal(tableRows.length, 2);
  assert.equal((tableRows[0].match(/<th\b/g) ?? []).length, 2);
  assert.equal((tableRows[1].match(/<td\b/g) ?? []).length, 2);
  assert.match(html, /<ol>[\s\S]*受控有序列表[\s\S]*<\/ol>/);
  assert.match(
    html,
    /class="feishu-task-list"[\s\S]*class="feishu-task-list__marker" aria-hidden="true">☑<\/span><span class="visually-hidden">已完成：<\/span>[\s\S]*受控待办事项/,
  );
  assert.match(
    html,
    /class="feishu-task-list"[\s\S]*class="feishu-task-list__marker" aria-hidden="true">☐<\/span><span class="visually-hidden">未完成：<\/span>[\s\S]*未完成待办事项/,
  );
  assert.match(html, /<hr\s*\/?>/);
  assert.doesNotMatch(html, /\uE000feishu-media:|```|\*\*组合样式\*\*/);

  const equationSources = [...html.matchAll(
    /data-feishu-equation-source="([A-Za-z0-9_-]+)"/g,
  )].map((match) => Buffer.from(match[1], 'base64url').toString('utf8'));
  const expectedSources = [
    'h + i',
    'x + y',
    'a | b\n% 注释\n+ c',
    Array.from({ length: 32 }, (_, index) => `x_{${index + 1}}`).join(' + '),
    Array.from({ length: 32 }, (_, index) => `y_{${index + 1}}`).join(' + '),
    's = t',
    'p | q',
  ];
  assert.deepEqual(equationSources.toSorted(), expectedSources.toSorted());

  const headingIds = [...html.matchAll(
    /<h[1-6]\b[^>]*\bid="(feishu-heading-\d+)"/g,
  )].map((match) => match[1]);
  assert.deepEqual(
    headingIds,
    headingIds.map((_, index) => `feishu-heading-${index + 1}`),
  );
  assert.equal(new Set(headingIds).size, headingIds.length);
  for (const [containerHeadingId, label] of [
    [calloutHeadingId, '高亮块内标题'],
    [sourceHeadingId, '同步块内标题'],
  ]) {
    assert.ok(headingIds.includes(containerHeadingId));
    assert.equal(
      (
        html.match(
          new RegExp(`href="#${containerHeadingId}">${label}<\\/a>`, 'g'),
        ) ?? []
      ).length,
      2,
    );
  }
  for (const headingId of headingIds) {
    assert.ok(
      (html.match(new RegExp(`href="#${headingId}"`, 'g')) ?? []).length >= 2,
      `desktop and mobile TOCs should link to ${headingId}`,
    );
  }
  assert.equal(
    (html.match(/href="#feishu-heading-1">公式标题 h \+ i<\/a>/g) ?? []).length,
    2,
  );
  const duplicateHeadingIds = [...html.matchAll(
    /<h3\b[^>]*id="(feishu-heading-\d+)"[^>]*data-feishu-heading-text="5pmu6YCa5qCH6aKY"/g,
  )].map((match) => match[1]);
  assert.equal(duplicateHeadingIds.length, 2);
  assert.equal(new Set(duplicateHeadingIds).size, 2);
  for (const headingId of duplicateHeadingIds) {
    assert.equal(
      (html.match(new RegExp(`href="#${headingId}"`, 'g')) ?? []).length,
      2,
    );
  }

  const legacyHtml = await readOutput(
    'posts/build-output-feishu-legacy/index.html',
  );
  assert.doesNotMatch(legacyHtml, /class="feishu-document"/);
  assert.match(legacyHtml, /<h2 id="二级标题">二级标题<\/h2>/);

  const protocolHtml = await readOutput(
    'posts/build-output-feishu-code-protocol/index.html',
  );
  assert.doesNotMatch(protocolHtml, /class="feishu-document"/);
  assert.match(protocolHtml, /伪公式/);
  assert.match(protocolHtml, /行内伪公式/);
  assert.match(protocolHtml, /行内伪标题/);
  assert.match(protocolHtml, /行内伪界面/);
  const markdownPunctuationFormula = 'z + 1 + \\text{*x* `y` [z](w)}';
  const markdownPunctuationSource = Buffer.from(
    markdownPunctuationFormula,
  ).toString('base64url');
  const protocolParagraphs = [...protocolHtml.matchAll(
    /<p\b[^>]*>[\s\S]*?<\/p>/g,
  )].map((match) => match[0]);
  const markdownPunctuationParagraph = protocolParagraphs.find((paragraph) =>
    paragraph.includes(
      `data-feishu-equation-source="${markdownPunctuationSource}"`,
    ));
  assert.ok(markdownPunctuationParagraph);
  assert.doesNotMatch(markdownPunctuationParagraph, /<(?:em|code|a)\b/);

  const styledParagraph = protocolParagraphs.find((paragraph) =>
    paragraph.includes('字面 ') && paragraph.includes('下一行'));
  assert.ok(styledParagraph);
  assert.match(styledParagraph, /<u class="feishu-underline">/);
  assert.match(styledParagraph, /class="feishu-text-background--light-orange"/);
  assert.doesNotMatch(styledParagraph, /<(?:em|code|a)\b/);
  assert.equal(
    decodeFeishuHtmlEntities(styledParagraph.replace(/<[^>]+>/g, ''))
      .replace(/\r\n?/g, '\n'),
    '字面 *x* _y_ `z` [链接](target) \\ | 尾\n下一行',
  );

  const privateUrlParagraph = protocolParagraphs.find((paragraph) =>
    paragraph.includes('私有链接'));
  assert.ok(privateUrlParagraph);
  assert.match(privateUrlParagraph, /<!---->/);
  assert.doesNotMatch(privateUrlParagraph, /<a\b/);
  assert.equal(
    decodeFeishuHtmlEntities(privateUrlParagraph.replace(/<[^>]+>/g, '')),
    '私有链接 https://private.example/path',
  );

  const protocolTable = protocolHtml.match(/<table\b[\s\S]*?<\/table>/)?.[0];
  assert.ok(protocolTable);
  const protocolRows = [...protocolTable.matchAll(/<tr\b[\s\S]*?<\/tr>/g)]
    .map((match) => match[0]);
  assert.equal(protocolRows.length, 2);
  assert.equal((protocolRows[0].match(/<th\b/g) ?? []).length, 2);
  assert.equal((protocolRows[1].match(/<td\b/g) ?? []).length, 2);
  const protocolCells = [...protocolRows[1].matchAll(/<td\b[\s\S]*?<\/td>/g)]
    .map((match) => match[0]);
  assert.equal(protocolCells.length, 2);
  const [formulaCell, styledCell] = protocolCells;
  assert.match(
    formulaCell,
    /^<td\b[^>]*><a class="feishu-link" href="https:\/\/example\.com\/gfm-table"><span class="feishu-text-color--red feishu-text-background--light-orange"><u class="feishu-underline"><strong><span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="[A-Za-z0-9_-]+">[\s\S]*<\/span><\/strong><\/u><\/span><\/a><\/td>$/,
  );
  assert.doesNotMatch(formulaCell, /feishu-equation--block/);
  assert.match(styledCell, /class="feishu-text-background--light-orange"/);
  assert.match(styledCell, /<u class="feishu-underline">/);
  assert.equal((styledCell.match(/<a\b/g) ?? []).length, 1);
  assert.match(
    styledCell,
    /class="feishu-link" href="https:\/\/example\.com\/a(?:\||&#124;)b"/,
  );
  assert.doesNotMatch(styledCell, /<(?:em|code)\b/);
  assert.equal(
    decodeFeishuHtmlEntities(styledCell.replace(/<[^>]+>/g, ''))
      .replace(/\r\n?/g, '\n'),
    '表格 | *字* `码`\n下一行',
  );
  const protocolSources = [...protocolHtml.matchAll(
    /data-feishu-equation-source="([A-Za-z0-9_-]+)"/g,
  )].map((match) => Buffer.from(match[1], 'base64url').toString('utf8'));
  assert.deepEqual(
    protocolSources.toSorted(),
    [markdownPunctuationFormula, 'm | n\n% 表格注释\n+ r'].toSorted(),
  );
});
```

- [ ] **Step 3: 写搜索索引与静态资源断言**

读取临时 build 的搜索索引，要求每个公式源码恰好一次，不含 `katex`、MathML 重复文本、真实“↻ 同步内容”或视觉 `feishu-document/callout/equation--*` class。代码示例中的字面量 `data-feishu-*` 是作者可见代码，必须保留，因此不能用全局 `/feishu-/` 否定断言。检查 HTML 有 KaTeX CSS 链接、输出目录有 KaTeX 字体文件，且文章没有 KaTeX 客户端 JS。

再把合法/畸形受控属性分别放入 Markdown fence、inline code、HTML pre/code，真实公式放在代码之后，断言代码示例可见且后续公式仍被搜索和标题协议处理。

```js
test('build indexes Feishu formulas once without visual or UI noise', async () => {
  const index = assertPublicSearchIndexContract(
    await readOutput('search-index.json'),
  );
  const entry = index.entries.find(
    ({ href }) => href === '/posts/build-output-feishu-rich-content/',
  );
  assert.ok(entry);
  assert.equal((entry.searchText.match(/x \+ y/g) ?? []).length, 1);
  assert.equal((entry.searchText.match(/h \+ i/g) ?? []).length, 1);
  assert.equal((entry.searchText.match(/s = t/g) ?? []).length, 1);
  assert.equal((entry.searchText.match(/p \| q/g) ?? []).length, 1);
  assert.match(entry.searchText, /伪公式/);
  assert.match(entry.searchText, /伪标题/);
  assert.match(entry.searchText, /伪界面/);
  assert.match(entry.searchText, /HTML 行内伪公式/);
  assert.match(entry.searchText, /HTML 行内伪标题/);
  assert.match(entry.searchText, /HTML 行内伪界面/);
  assert.doesNotMatch(entry.searchText, /private\.example|html-code/);
  assert.doesNotMatch(
    entry.searchText,
    /katex|mathml|↻ 同步内容|feishu-document|feishu-callout|feishu-equation--/i,
  );

  const protocolEntry = index.entries.find(
    ({ href }) => href === '/posts/build-output-feishu-code-protocol/',
  );
  assert.ok(protocolEntry);
  assert.match(protocolEntry.searchText, /伪公式/);
  assert.match(protocolEntry.searchText, /行内伪公式/);
  assert.match(protocolEntry.searchText, /行内伪标题/);
  assert.match(protocolEntry.searchText, /行内伪界面/);
  assert.equal((protocolEntry.searchText.match(/z \+ 1/g) ?? []).length, 1);
  assert.equal(
    (protocolEntry.searchText.match(/m \| n % 表格注释 \+ r/g) ?? []).length,
    1,
  );
  assert.equal(
    (protocolEntry.searchText.match(/字面 \*x\* _y_ `z` \[链接\]\(target\) \\ \| 尾 下一行/g) ?? []).length,
    1,
  );
  assert.match(protocolEntry.searchText, /私有链接/);
  assert.doesNotMatch(protocolEntry.searchText, /https?:|example\.com|private/i);

  const html = await readOutput(
    'posts/build-output-feishu-rich-content/index.html',
  );
  assert.match(html, /<link\b[^>]*href="[^"]+\.css"/);
  assert.doesNotMatch(html, /<script\b[^>]*src="[^"]*katex/i);
  const outputFiles = await readdir(fileURLToPath(distRoot), {
    recursive: true,
  });
  assert.ok(
    outputFiles.some((path) => /KaTeX_[^/]+\.(?:woff2?|ttf)$/i.test(path)),
    'the production build should emit KaTeX fonts',
  );
  const browserJavaScript = (
    await Promise.all(
      outputFiles
        .filter((path) => path.endsWith('.js'))
        .map((path) => readFile(join(fileURLToPath(distRoot), path), 'utf8')),
    )
  ).join('\n');
  assert.doesNotMatch(browserJavaScript, /node:buffer|\bBuffer\.from\b/);
  assert.doesNotMatch(
    browserJavaScript,
    /KaTeX parse error|katex-error|\brenderToString\b/i,
  );
});
```

- [ ] **Step 4: 运行最终集成门禁并记录结果**

```sh
node --experimental-strip-types --test tests/build-output.test.mjs
```

预期：既有 build 断言保持通过。由于 Tasks 6–11 已先完成生产实现，新集成测试允许首次即 GREEN；记录实际结果。若 FAIL，失败即真实的跨层缺口，不能人为制造失败或放宽断言。

- [ ] **Step 5: 运行真实构建 GREEN**

完成 Steps 1–3 的测试代码后重复运行：

```sh
node --experimental-strip-types --test tests/build-output.test.mjs
```

预期：0 fail，临时目录自动清理，真实生成目录 `git status` 无变化。若仍失败，按失败断言返回负责该行为的 Task 6–11 修复后，再从 Task 12 Step 4 重跑；不得删除或放宽生产断言。

- [ ] **Step 6: 提交生产构建门禁**

```sh
git add tests/build-output.test.mjs
git diff --cached --check
git commit -m "test: verify Feishu rich content build output"
```

若 Step 5 必须修改生产文件，使用明确 allowlist 把对应文件加入同一提交，并在提交前检查 `git diff --cached --name-only`。

### Task 13: 全量验证与四种浏览器组合验收

**Files:**
- Verify: all files changed by Tasks 1–12
- Temporary, remove before finish: `src/content/posts/manual/feishu-rich-content-qa.md`

- [ ] **Step 1: 运行全部聚焦测试**

```sh
node --version
npm --version
node --experimental-strip-types --test \
  tests/toolchain.test.mjs \
  tests/feishu-semantics.test.mjs \
  tests/feishu-markdown.test.mjs \
  tests/feishu-conversion.test.mjs \
  tests/feishu-sync.test.mjs \
  tests/feishu-markup.test.mjs \
  tests/feishu-headings.test.mjs \
  tests/search.test.mjs \
  tests/design-contrast.test.mjs \
  tests/ui-source.test.mjs \
  tests/build-output.test.mjs
```

预期：Node `v24.1.0`，npm `11.4.1`，全部测试 0 fail。

- [ ] **Step 2: 运行项目完整门禁**

```sh
npm run verify
```

预期：所有 Node tests 通过；Astro 为 `0 errors / 0 warnings / 0 hints`；生产 build 成功。

- [ ] **Step 3: 创建仅用于浏览器验收的临时文章**

用 Node 读取 rich fixture、调用 `blocksToMarkdown()`，在隔离 worktree 中机械生成 `src/content/posts/manual/feishu-rich-content-qa.md`；frontmatter 使用 Task 12 的字段，但把 `slug` 固定为 `feishu-rich-content-qa`。正文使用转换结果，并把所有媒体 placeholder 替换为仓库已有的 `/favicon.svg`。创建后确认只新增这一临时文件，且没有触碰三个飞书生成保护区：

```sh
node --input-type=module - <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
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
title: 飞书富内容浏览器验收
description: 仅用于本地浏览器验收
pubDate: 2026-07-15
category: 工程
tags:
  - 飞书
featured: false
slug: feishu-rich-content-qa
---

`;
await writeFile(
  './src/content/posts/manual/feishu-rich-content-qa.md',
  `${frontmatter}${body}`,
  { encoding: 'utf8', flag: 'wx' },
);
NODE
git status --short
```

- [ ] **Step 4: 启动本地站点并调用浏览器 skill**

```sh
npm run dev -- --host 127.0.0.1 --port 4327 --strictPort
```

保持 dev server 的 PTY/session ID，调用 `browser:control-in-app-browser` skill，在 `http://127.0.0.1:4327/posts/feishu-rich-content-qa/` 验收以下四组。把浏览器动作视为 `try` 主体；无论任一断言或 tool 调用是否失败，都先执行 Step 5 的停止 server 与删除临时文章，再报告原始失败，不能让 QA 文件或 server 遗留。

| 视口 | 主题 |
| --- | --- |
| 1440 × 900 | light |
| 1440 × 900 | dark |
| 320 × 760 | light |
| 320 × 760 | dark |

每组检查：

- `document.documentElement.scrollWidth <= document.documentElement.clientWidth`。
- 解码 `data-feishu-equation-source` 找到短公式 `x + y`，断言 `scrollWidth <= clientWidth + 1`；找到以 `x_{1}` 开头的长行内公式和以 `y_{1}` 开头的长块级公式，断言两者 `getComputedStyle(element).overflowX === 'auto'` 且 `scrollWidth > clientWidth`。滚动任一长公式后，document 的 `scrollLeft` 和整体宽度不变。
- Callout 的 emoji、嵌套列表、引用、表格和 SourceSynced 标记不溢出。
- 文字色、背景色和链接 focus 在当前主题清晰可读。
- 桌面 sticky TOC 与移动折叠 TOC 使用同一标题文字；点击后 hash 命中实际 `feishu-heading-N`。
- 主题切换后无需刷新，公式与颜色立即更新。
- 对一个带 `feishu-callout--border-red` 的 Callout 读取 computed style，`borderTopColor` 等于当前主题 `--feishu-border-red`，且不等于透明色或通用 `--line`。
- 对同一 `feishu-callout--text-red` 内的 heading 与 blockquote 读取 computed `color`，两者都等于容器的 `--feishu-fg-red`；再确认其中显式 `.feishu-text-color--*` 子节点仍使用自己的 token。
- 找到“仅背景链接”的 `.feishu-link`，normal 与真实 hover 后的 computed `color` 都等于所属正文继承前景而非 `--accent-text/hover`；focus-visible outline 仍存在。四种主题/视口都执行。
- 分别检查 SourceSynced quote 和 Callout quote 中的 background-only `.feishu-link`：前者可见 span 使用 `--ink`，后者使用容器 `--feishu-callout-text`，两者都不继承低对比度 `--muted`/accent。组合样式的 `<code>` computed `backgroundColor` 为 transparent，作者的外层背景色没有被 global code surface 遮住。
- 对 checked/unchecked 两个 `.feishu-task-list > li` 断言 `getComputedStyle(li).listStyleType === 'none'`，页面只显示 `☑` / `☐` 自定义 marker，没有第二个原生圆点。
- 控制台没有错误或 warning；KaTeX CSS 和字体请求没有 404；没有 KaTeX 客户端脚本。

- [ ] **Step 5: 删除临时 QA 文章并重新验证状态**

先向 Step 4 保存的 dev server session 发送 Ctrl-C 并确认进程退出，再使用 `apply_patch` 删除刚创建的 `src/content/posts/manual/feishu-rich-content-qa.md`。这一步是强制 finally 清理，即使浏览器验收失败也必须执行。然后运行：

```sh
test ! -e src/content/posts/manual/feishu-rich-content-qa.md
git diff --check
git status --short --branch
```

预期：临时文章不存在；没有 `.playwright-cli/`、`.superpowers/` 或飞书生成保护区变化；只有计划内已提交内容。

- [ ] **Step 6: 执行完成前验证与提交审计**

调用 `verification-before-completion` skill，检查：

```sh
PLAN_BASE=$(git log -1 --format=%H -- \
  docs/superpowers/plans/2026-07-15-feishu-rich-content-rendering.md)
git log --oneline "$PLAN_BASE"..HEAD
git diff --stat "$PLAN_BASE"..HEAD
git diff --check "$PLAN_BASE"..HEAD
git status --short --branch
```

预期：提交按任务边界清晰；无未提交改动；保护路径不在 diff；功能分支仍为 `codex/feishu-rich-content-rendering`。

完成后调用 `finishing-a-development-branch` skill，让用户选择合并、PR、保留或丢弃 worktree；不要自行合并到分叉的 `main`。
