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
  return { block_id, block_type: 2, parent_id, text: { elements }, ...extra };
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
    heading2: { elements: [text('公式标题 '), equation('h + i')] },
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
  addTopLevel(
    richTextBlock(
      'rich-text-colors',
      'rich-page',
      Array.from({ length: 7 }, (_, i) => [
        text(`文字色 ${i + 1}`, { text_color: i + 1 }),
        text(i === 6 ? '' : ' '),
      ]).flat(),
    ),
  );
  addTopLevel(
    richTextBlock(
      'rich-text-backgrounds',
      'rich-page',
      Array.from({ length: 15 }, (_, i) => [
        text(`背景色 ${i + 1}`, { background_color: i + 1 }),
        text(i === 14 ? '' : ' '),
      ]).flat(),
    ),
  );
  addTopLevel(
    richTextBlock('rich-background-only-link', 'rich-page', [
      text('仅背景链接', {
        background_color: 9,
        link: { url: 'https://example.com/background-only' },
      }),
    ]),
  );
  addTopLevel(
    richTextBlock('rich-combined-style', 'rich-page', [
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
    ]),
  );
  addTopLevel(
    richTextBlock('rich-html-inline-code-protocol', 'rich-page', [
      text(
        [
          '<span data-feishu-equation-source="@@">HTML 行内伪公式</span>',
          '<h2 id="feishu-heading-99" data-feishu-heading-text="@@">HTML 行内伪标题</h2>',
          '<span data-feishu-search-ui>HTML 行内伪界面</span>',
          'https://private.example/html-code',
        ].join(' '),
        { inline_code: true, underline: true },
      ),
    ]),
  );
  addTopLevel(
    richTextBlock('rich-inline-formula', 'rich-page', [
      text('混排 '),
      equation('x + y', {
        bold: true,
        underline: true,
        text_color: 5,
        background_color: 2,
        link: { url: 'https://example.com/formula' },
      }),
      text(' 完成'),
    ]),
  );
  addTopLevel(
    richTextBlock('rich-block-formula', 'rich-page', [
      text('  '),
      equation('a | b\n% 注释\n+ c'),
      text('\n'),
    ]),
  );
  addTopLevel(
    richTextBlock('rich-long-inline-formula', 'rich-page', [
      text('长行内公式 '),
      equation(
        Array.from({ length: 32 }, (_, i) => `x_{${i + 1}}`).join(' + '),
      ),
      text(' 结束'),
    ]),
  );
  addTopLevel(
    richTextBlock('rich-long-block-formula', 'rich-page', [
      equation(
        Array.from({ length: 32 }, (_, i) => `y_{${i + 1}}`).join(' + '),
      ),
    ]),
  );
  addTopLevel({
    block_id: 'rich-controlled-code-protocol',
    block_type: 14,
    parent_id: 'rich-page',
    code: {
      style: { language: 24 },
      elements: [
        text(
          [
            '` 未配对反引号',
            '~~~',
            '<span data-feishu-equation-source="eA">伪公式</span>',
            '<h2 id="feishu-heading-9" data-feishu-heading-text="@@">伪标题</h2>',
            '<span data-feishu-search-ui>伪界面</span>',
          ].join('\n'),
        ),
      ],
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
    todo: { style: { done: true }, elements: [text('受控待办事项')] },
  });
  addTopLevel({
    block_id: 'rich-todo-open',
    block_type: 17,
    parent_id: 'rich-page',
    todo: { style: { done: false }, elements: [text('未完成待办事项')] },
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
    blocks.push(
      richTextBlock(
        paragraphId,
        calloutId,
        [text(`高亮块 ${value}`, value === 1 ? { text_color: 5 } : {})],
      ),
    );
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
    quote: {
      elements: [
        text('高亮块内引用', {
          background_color: 13,
          link: { url: 'https://example.com/callout-quote' },
        }),
      ],
    },
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
  blocks.push(
    richTextBlock('rich-source-paragraph', 'rich-source', [
      text('同步正文与安全链接', {
        bold: true,
        italic: true,
        strikethrough: true,
        underline: true,
        inline_code: true,
        text_color: 5,
        background_color: 2,
        link: { url: 'https://example.com/source' },
      }),
    ]),
  );
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
  blocks.push(
    richTextBlock(
      'rich-source-list-callout-text',
      'rich-source-list-callout',
      [text('列表内高亮块')],
    ),
  );
  blocks.push({
    block_id: 'rich-source-quote',
    block_type: 15,
    parent_id: 'rich-source',
    quote: {
      elements: [
        text('同步引用背景链接', {
          background_color: 13,
          link: { url: 'https://example.com/source-quote' },
        }),
      ],
    },
  });
  blocks.push({
    block_id: 'rich-source-table',
    block_type: 31,
    parent_id: 'rich-source',
    children: ['rich-cell-a', 'rich-cell-b', 'rich-cell-c', 'rich-cell-d'],
    table: {
      cells: ['rich-cell-a', 'rich-cell-b', 'rich-cell-c', 'rich-cell-d'],
      property: { row_size: 2, column_size: 2 },
    },
  });
  const cellElements = [
    [text('列 A')],
    [text('列 B')],
    [equation('p | q')],
    [
      text('值 B', {
        bold: true,
        underline: true,
        link: { url: 'https://example.com/table' },
      }),
    ],
  ];
  for (const [index, suffix] of ['a', 'b', 'c', 'd'].entries()) {
    blocks.push({
      block_id: `rich-cell-${suffix}`,
      block_type: 32,
      parent_id: 'rich-source-table',
      children: [`rich-cell-${suffix}-text`],
      table_cell: {},
    });
    blocks.push(
      richTextBlock(
        `rich-cell-${suffix}-text`,
        `rich-cell-${suffix}`,
        cellElements[index],
      ),
    );
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
