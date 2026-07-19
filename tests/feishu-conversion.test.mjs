import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  blocksToMarkdown,
  FeishuConversionError,
} from '../scripts/feishu/blocks.mjs';
import {
  CALLOUT_EMOJI_BY_ID,
  CALLOUT_EMOJI_SNAPSHOT,
} from '../scripts/feishu/callout-emojis.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/feishu-document.json', import.meta.url), 'utf8'),
);

const legacyFixture = JSON.parse(
  await readFile(
    new URL('./fixtures/feishu-legacy-document.json', import.meta.url),
    'utf8',
  ),
);

const referenceSyncedFixture = JSON.parse(
  await readFile(
    new URL('./fixtures/feishu-reference-synced.json', import.meta.url),
    'utf8',
  ),
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
  assert.equal(first.mediaReferences.length, 1);
  assert.equal(first.mediaReferences[0].token, 'img_v2_example');
  assert.match(
    first.markdown,
    new RegExp(`!\\[图片\\]\\(${first.mediaReferences[0].placeholder}\\)`),
  );
  assert.doesNotMatch(first.markdown, /feishu-media:\/\//);
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

test('rejects reference synced blocks with a dedicated issue', () => {
  const items = structuredClone(referenceSyncedFixture.items);
  assert.throws(() => blocksToMarkdown(items), (error) => {
    assert.ok(error instanceof FeishuConversionError);
    assert.equal(
      error.issues.find(({ code }) => code === 'unsupported_reference_synced')
        ?.code,
      'unsupported_reference_synced',
    );
    assert.deepEqual(error.issues.map(({ code }) => code), [
      'unsupported_reference_synced',
    ]);
    assert.doesNotMatch(error.message, /document_private|block_private/);
    return true;
  });
});

test('reference synced rejection short-circuits descendants and graph validation', () => {
  const reference = {
    block_id: 'reference',
    block_type: 50,
    parent_id: 'page',
    children: ['secret-child-id'],
    reference_synced: {
      source_document_id: 'secret-document-id',
      source_block_id: 'secret-source-block-id',
    },
  };
  const malformedChild = textBlock(
    'secret-child-id',
    'wrong-private-parent',
    'secret-descendant-content',
  );
  malformedChild.text.elements[0].text_run.text_element_style.link = {
    url: 'javascript:secret-descendant-link',
  };
  const duplicateChild = textBlock(
    'secret-child-id',
    'reference',
    'ordinary-duplicate-content',
  );

  assert.throws(
    () =>
      blocksToMarkdown(
        pageWith(['reference'], [reference, malformedChild, duplicateChild]),
      ),
    (error) => {
      assert.ok(error instanceof FeishuConversionError);
      assert.deepEqual(error.issues.map(({ code }) => code), [
        'unsupported_reference_synced',
      ]);
      assert.doesNotMatch(
        error.message,
        /secret-child-id|secret-document-id|secret-source-block-id|secret-descendant|ordinary-duplicate/,
      );
      return true;
    },
  );
});

for (const [label, container, child, privateValues] of [
  [
    'callout',
    {
      block_id: 'callout-private',
      block_type: 19,
      parent_id: 'page',
      children: ['callout-child'],
      callout: { emoji_id: 'gift' },
    },
    textBlock('callout-child', 'callout-private', 'private-callout-body'),
    /callout-private|private-callout-body/,
  ],
  [
    'source synced',
    {
      block_id: 'source-private',
      block_type: 49,
      parent_id: 'page',
      children: ['source-child'],
      source_synced: {
        elements: [
          {
            text_run: {
              content: 'private-source-title',
              text_element_style: {},
            },
          },
        ],
      },
    },
    textBlock('source-child', 'source-private', 'private-source-body'),
    /source-private|private-source-title|private-source-body/,
  ],
]) {
  test(`legacy renderer rejects a ${label} instead of dropping visible content`, () => {
    assert.throws(
      () => blocksToMarkdown(pageWith([container.block_id], [container, child])),
      (error) => {
        assert.ok(error instanceof FeishuConversionError);
        assert.deepEqual(error.issues.map(({ code }) => code), [
          'unsupported_rich_container_renderer',
        ]);
        assert.doesNotMatch(error.message, privateValues);
        return true;
      },
    );
  });
}

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

test('rejects reserved structured media placeholder characters in author text', () => {
  const block = textBlock('reserved-marker', 'page', '\uE000feishu-media:a\uE001');
  assert.throws(
    () => blocksToMarkdown(pageWith(['reserved-marker'], [block])),
    /reserved-marker.*reserved media placeholder/i,
  );
});

test('preserves consecutive blank lines inside fenced code blocks', () => {
  const code = {
    block_id: 'code-blank-lines',
    block_type: 14,
    parent_id: 'page',
    code: {
      elements: [
        { text_run: { content: 'first\n\n\nsecond', text_element_style: {} } },
      ],
      style: { language: 1 },
    },
  };

  const { markdown } = blocksToMarkdown(
    pageWith(['code-blank-lines'], [code]),
  );
  assert.match(markdown, /```text\nfirst\n\n\nsecond\n```/);
});

test('indents a nested list by the full width of its parent marker', () => {
  const parent = {
    block_id: 'ordered-parent',
    block_type: 13,
    parent_id: 'page',
    children: ['bullet-child'],
    ordered: {
      elements: [
        { text_run: { content: '父级', text_element_style: {} } },
      ],
    },
  };
  const child = {
    block_id: 'bullet-child',
    block_type: 12,
    parent_id: 'ordered-parent',
    bullet: {
      elements: [
        { text_run: { content: '子级', text_element_style: {} } },
      ],
    },
  };

  const { markdown } = blocksToMarkdown(
    pageWith(['ordered-parent'], [parent, child]),
  );
  assert.match(markdown, /^1\. 父级\n {3}- 子级$/m);
});

test('indents every line of a non-list block nested under a list item', () => {
  const parent = {
    block_id: 'ordered-with-code',
    block_type: 13,
    parent_id: 'page',
    children: ['nested-code'],
    ordered: {
      elements: [
        { text_run: { content: '示例', text_element_style: {} } },
      ],
    },
  };
  const code = {
    block_id: 'nested-code',
    block_type: 14,
    parent_id: 'ordered-with-code',
    code: {
      elements: [
        { text_run: { content: 'line 1\nline 2', text_element_style: {} } },
      ],
      style: { language: 1 },
    },
  };

  const { markdown } = blocksToMarkdown(
    pageWith(['ordered-with-code'], [parent, code]),
  );
  assert.match(
    markdown,
    /^1\. 示例\n {3}```text\n {3}line 1\n {3}line 2\n {3}```$/m,
  );
});

test('uses the bullet marker width when nesting under a task item', () => {
  const parent = {
    block_id: 'todo-parent',
    block_type: 17,
    parent_id: 'page',
    children: ['todo-child'],
    todo: {
      elements: [
        { text_run: { content: '父任务', text_element_style: {} } },
      ],
      style: { done: true },
    },
  };
  const child = {
    block_id: 'todo-child',
    block_type: 12,
    parent_id: 'todo-parent',
    bullet: {
      elements: [
        { text_run: { content: '子项', text_element_style: {} } },
      ],
    },
  };

  const { markdown } = blocksToMarkdown(
    pageWith(['todo-parent'], [parent, child]),
  );
  assert.match(markdown, /^- \[x\] 父任务\n {2}- 子项$/m);
});

test('escapes pipes inside inline code when rendering a GFM table cell', () => {
  const text = textBlock('cell-text', 'cell', 'a|b and a\\|b');
  text.text.elements[0].text_run.text_element_style.inline_code = true;
  const cell = {
    block_id: 'cell',
    block_type: 32,
    parent_id: 'table',
    children: ['cell-text'],
    table_cell: {},
  };
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

  const { markdown } = blocksToMarkdown(
    pageWith(['table'], [table, cell, text]),
  );
  assert.match(
    markdown,
    /^\| <code>a&#124;b and a&#92;&#124;b<\/code> \|$/m,
  );
  assert.match(markdown, /^\| --- \|$/m);
});

test('protects paragraph-leading indentation from becoming a code block', () => {
  const block = textBlock(
    'leading-indent',
    'page',
    '    这仍是段落\n\t这也是段落',
  );
  const { markdown } = blocksToMarkdown(pageWith(['leading-indent'], [block]));

  assert.doesNotMatch(markdown, /^ {4}|^\t/m);
  assert.match(markdown, /^&nbsp;&nbsp;&nbsp;&nbsp;这仍是段落$/m);
  assert.match(markdown, /^(?:&nbsp;){4}这也是段落$/m);
});

test('empty and whitespace-only inline code does not add visible content', () => {
  const empty = textBlock('empty-inline-code', 'page', '');
  empty.text.elements[0].text_run.text_element_style.inline_code = true;
  assert.equal(
    blocksToMarkdown(pageWith(['empty-inline-code'], [empty])).markdown,
    '',
  );

  const space = textBlock('space-inline-code', 'page', ' ');
  space.text.elements[0].text_run.text_element_style.inline_code = true;
  assert.equal(
    blocksToMarkdown(pageWith(['space-inline-code'], [space])).markdown,
    ' \n',
  );
});

test('maps official C++ code language and rejects unknown language enums', () => {
  const code = {
    block_id: 'cpp-code',
    block_type: 14,
    parent_id: 'page',
    code: {
      elements: [
        { text_run: { content: 'int main() {}', text_element_style: {} } },
      ],
      style: { language: 9 },
    },
  };
  assert.match(blocksToMarkdown(pageWith(['cpp-code'], [code])).markdown, /^```cpp$/m);

  code.code.style.language = 999;
  assert.throws(
    () => blocksToMarkdown(pageWith(['cpp-code'], [code])),
    /cpp-code.*language.*999/i,
  );
});

test('escapes ampersands so entity-like text remains literal', () => {
  const block = textBlock('entity', 'page', '&copy; is source text');
  const { markdown } = blocksToMarkdown(pageWith(['entity'], [block]));

  assert.match(markdown, /\\&copy\\;/);
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
