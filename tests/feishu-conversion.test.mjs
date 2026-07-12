import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  blocksToMarkdown,
  FeishuConversionError,
} from '../scripts/feishu/blocks.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/feishu-document.json', import.meta.url), 'utf8'),
);

function textBlock(id, parentId, content = id) {
  return {
    block_id: id,
    block_type: 2,
    parent_id: parentId,
    text: {
      elements: [
        { text_run: { content, text_element_style: {} } },
      ],
    },
  };
}

function pageWith(children, extra = []) {
  return [
    { block_id: 'page', block_type: 1, children, page: { elements: [] } },
    ...extra,
  ];
}

test('converts supported Feishu text blocks to deterministic Markdown', () => {
  const input = structuredClone(fixture.items);
  const first = blocksToMarkdown(input);
  const second = blocksToMarkdown(input);

  assert.equal(first.markdown, second.markdown);
  assert.deepEqual(input, fixture.items);
  assert.match(first.markdown, /^## 二级标题$/m);
  assert.match(first.markdown, /Markdown \\[*]特殊\\[*] 内容：/);
  assert.match(first.markdown, /[*][*]粗体[*][*]/);
  assert.match(first.markdown, /[*]斜体[*]/);
  assert.match(first.markdown, /~~删除~~/);
  assert.match(first.markdown, /``a`b``/);
  assert.match(first.markdown, /\[链接\]\(https:\/\/example\.com\/docs_%281%29\)/);
  assert.match(first.markdown, /^- 父级列表$/m);
  assert.match(first.markdown, /^  - 嵌套列表$/m);
  assert.match(first.markdown, /^1\. 有序项目$/m);
  assert.match(first.markdown, /^> 引用内容$/m);
  assert.match(first.markdown, /^- \[x\] 已经完成$/m);
  assert.match(first.markdown, /^- \[ \] 尚未完成$/m);
  assert.match(first.markdown, /^````javascript$/m);
  assert.match(first.markdown, /const fence = "```";/);
  assert.match(first.markdown, /^````$/m);
  assert.match(first.markdown, /^---$/m);
  assert.match(first.markdown, /!\[图片\]\(feishu-media:\/\/img_v2_example\)/);
  assert.match(first.markdown, /^\| 列 A \| 列 B \|$/m);
  assert.match(first.markdown, /^\| --- \| --- \|$/m);
  assert.match(first.markdown, /^\| 值 \\\| A \| \*\*值 B\*\* \|$/m);
  assert.deepEqual(first.mediaTokens, ['img_v2_example']);
  assert.deepEqual(first.warnings, [
    { blockId: 'formatted-paragraph', type: 'underline' },
  ]);
});

test('aggregates unsupported block types before rendering', () => {
  const items = pageWith(['unsupported-a', 'unsupported-b'], [
    { block_id: 'unsupported-a', block_type: 43, parent_id: 'page' },
    { block_id: 'unsupported-b', block_type: 999, parent_id: 'page' },
  ]);

  assert.throws(
    () => blocksToMarkdown(items),
    (error) => {
      assert.ok(error instanceof FeishuConversionError);
      assert.match(error.message, /unsupported-a.*43/s);
      assert.match(error.message, /unsupported-b.*999/s);
      assert.equal(error.issues.length, 2);
      return true;
    },
  );
});

test('aggregates unsupported rich-text element types', () => {
  const block = textBlock('rich', 'page');
  block.text.elements = [
    { mention_user: { user_id: 'ou_example' } },
    { file: { file_token: 'box_example' } },
    { undefined_element: {} },
  ];

  assert.throws(
    () => blocksToMarkdown(pageWith(['rich'], [block])),
    (error) => {
      assert.ok(error instanceof FeishuConversionError);
      assert.match(error.message, /rich.*mention_user/s);
      assert.match(error.message, /rich.*file/s);
      assert.match(error.message, /rich.*undefined_element/s);
      return true;
    },
  );
});

test('rejects dangerous rich-text links', () => {
  const block = textBlock('link', 'page', '危险链接');
  block.text.elements[0].text_run.text_element_style.link = {
    url: 'javascript:alert(1)',
  };

  assert.throws(
    () => blocksToMarkdown(pageWith(['link'], [block])),
    /link.*javascript/s,
  );
});

test('reports duplicate block ids and missing children', () => {
  const duplicate = textBlock('same', 'page');
  const items = pageWith(['same', 'missing'], [duplicate, structuredClone(duplicate)]);

  assert.throws(
    () => blocksToMarkdown(items),
    (error) => {
      assert.match(error.message, /duplicate.*same/i);
      assert.match(error.message, /missing/i);
      return true;
    },
  );
});

test('reports parent mismatches, orphan blocks, and cycles', () => {
  const parentMismatch = textBlock('child', 'wrong-parent');
  parentMismatch.children = ['child'];
  const orphan = textBlock('orphan', 'page');

  assert.throws(
    () => blocksToMarkdown(pageWith(['child'], [parentMismatch, orphan])),
    (error) => {
      assert.match(error.message, /parent.*child/i);
      assert.match(error.message, /orphan/i);
      assert.match(error.message, /cycle.*child/i);
      return true;
    },
  );
});

test('requires exactly one page root', () => {
  assert.throws(() => blocksToMarkdown([]), /page root/i);
  assert.throws(
    () => blocksToMarkdown([
      { block_id: 'page-a', block_type: 1, page: { elements: [] } },
      { block_id: 'page-b', block_type: 1, page: { elements: [] } },
    ]),
    /page root/i,
  );
});

test('escapes tilde and equals characters that can create Markdown syntax', () => {
  const block = textBlock('markdown', 'page', '~~不是删除线~~\n===');
  const { markdown } = blocksToMarkdown(pageWith(['markdown'], [block]));

  assert.match(markdown, /\\~\\~不是删除线\\~\\~/);
  assert.match(markdown, /\\=\\=\\=/);
});

test('rejects children on leaf blocks instead of silently dropping them', () => {
  const parent = textBlock('parent', 'page', '父段落');
  parent.children = ['child'];
  const child = textBlock('child', 'parent', '不能丢失的子内容');

  assert.throws(
    () => blocksToMarkdown(pageWith(['parent'], [parent, child])),
    /parent.*children.*not supported|leaf block/i,
  );
});

test('detects cycles even when the cycle is orphaned from the page root', () => {
  const first = textBlock('orphan-a', 'orphan-b', 'A');
  const second = textBlock('orphan-b', 'orphan-a', 'B');
  first.children = ['orphan-b'];
  second.children = ['orphan-a'];

  assert.throws(
    () => blocksToMarkdown(pageWith([], [first, second])),
    (error) => {
      assert.match(error.message, /cycle.*orphan-[ab]/i);
      assert.match(error.message, /orphan.*orphan-a/i);
      assert.match(error.message, /orphan.*orphan-b/i);
      return true;
    },
  );
});

test('rejects invalid table dimensions and cell counts', () => {
  const table = {
    block_id: 'table',
    block_type: 31,
    parent_id: 'page',
    children: [],
    table: {
      cells: [],
      property: { row_size: 2, column_size: 2 },
    },
  };

  assert.throws(
    () => blocksToMarkdown(pageWith(['table'], [table])),
    /table.*4.*0|cell count/i,
  );

  table.table.property.row_size = 0;
  assert.throws(
    () => blocksToMarkdown(pageWith(['table'], [table])),
    /row_size|dimension/i,
  );
});

test('requires table cell references to target simple table-cell blocks', () => {
  const directText = textBlock('not-a-cell', 'table', '错误单元格');
  const table = {
    block_id: 'table',
    block_type: 31,
    parent_id: 'page',
    children: ['not-a-cell'],
    table: {
      cells: ['not-a-cell'],
      property: { row_size: 1, column_size: 1 },
    },
  };

  assert.throws(
    () => blocksToMarkdown(pageWith(['table'], [table, directText])),
    /table.*not-a-cell.*32|table cell/i,
  );
});

test('rejects complex content inside simple table cells', () => {
  const table = {
    block_id: 'table',
    block_type: 31,
    parent_id: 'page',
    children: ['cell'],
    table: {
      cells: ['cell'],
      property: { row_size: 1, column_size: 1 },
    },
  };
  const cell = {
    block_id: 'cell',
    block_type: 32,
    parent_id: 'table',
    children: ['cell-image'],
    table_cell: {},
  };
  const image = {
    block_id: 'cell-image',
    block_type: 27,
    parent_id: 'cell',
    image: { token: 'img_cell' },
  };

  assert.throws(
    () => blocksToMarkdown(pageWith(['table'], [table, cell, image])),
    /table cell.*cell-image.*text|complex/i,
  );
});
