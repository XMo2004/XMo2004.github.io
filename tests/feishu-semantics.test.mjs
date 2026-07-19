import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FeishuConversionError,
  blocksToMarkdown,
} from '../scripts/feishu/blocks.mjs';
import {
  CALLOUT_BACKGROUND_BY_ENUM,
  CALLOUT_BORDER_BY_ENUM,
  FONT_BACKGROUND_BY_ENUM,
  FONT_COLOR_BY_ENUM,
  normalizeFeishuDocument,
} from '../scripts/feishu/semantics.mjs';

const fontColors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
const fontBackgrounds = [
  'light-red',
  'light-orange',
  'light-yellow',
  'light-green',
  'light-blue',
  'light-purple',
  'medium-gray',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'gray',
  'light-gray',
];
const calloutBackgrounds = [
  'light-red',
  'light-orange',
  'light-yellow',
  'light-green',
  'light-blue',
  'light-purple',
  'medium-gray',
  'medium-red',
  'medium-orange',
  'medium-yellow',
  'medium-green',
  'medium-blue',
  'medium-purple',
  'gray',
  'light-gray',
];

function text(content = '示例', textElementStyle = {}) {
  return {
    text_run: {
      content,
      text_element_style: textElementStyle,
    },
  };
}

function equation(content = 'E = mc^2', textElementStyle = {}) {
  return {
    equation: {
      content,
      text_element_style: textElementStyle,
    },
  };
}

function textBlock(
  blockId,
  parentId,
  {
    blockType = 2,
    property = 'text',
    elements = [text()],
    children,
    style,
  } = {},
) {
  return {
    block_id: blockId,
    block_type: blockType,
    parent_id: parentId,
    ...(children === undefined ? {} : { children }),
    [property]: {
      elements,
      ...(style === undefined ? {} : { style }),
    },
  };
}

function blockDocument(children, additionalBlocks) {
  const root = {
    block_id: 'page',
    block_type: 1,
    children,
    page: { elements: [] },
  };
  return {
    blocks: new Map([
      ['page', root],
      ...additionalBlocks.map((block) => [block.block_id, block]),
    ]),
    root,
  };
}

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
      elements: [text('示例', style)],
    },
  };
  return {
    blocks: new Map([
      ['page', root],
      ['paragraph', paragraph],
    ]),
    root,
  };
}

function collectObjects(value, collected = []) {
  if (value === null || typeof value !== 'object') return collected;
  collected.push(value);
  for (const child of Object.values(value)) collectObjects(child, collected);
  return collected;
}

function normalizeSingleTextBlock({
  blockType = 2,
  property = 'text',
  elements = [equation()],
  style,
} = {}) {
  const block = textBlock('subject', 'page', {
    blockType,
    property,
    elements,
    style,
  });
  return normalizeFeishuDocument(blockDocument(['subject'], [block]));
}

test('maps every Feishu color enum to the required semantic token', () => {
  assert.equal(Object.isFrozen(FONT_COLOR_BY_ENUM), true);
  assert.equal(Object.isFrozen(CALLOUT_BORDER_BY_ENUM), true);
  assert.equal(Object.isFrozen(FONT_BACKGROUND_BY_ENUM), true);
  assert.equal(Object.isFrozen(CALLOUT_BACKGROUND_BY_ENUM), true);
  assert.deepEqual(Object.values(FONT_COLOR_BY_ENUM), fontColors);
  assert.deepEqual(Object.values(CALLOUT_BORDER_BY_ENUM), fontColors);
  assert.deepEqual(Object.values(FONT_BACKGROUND_BY_ENUM), fontBackgrounds);
  assert.deepEqual(Object.values(CALLOUT_BACKGROUND_BY_ENUM), calloutBackgrounds);
  assert.notEqual(FONT_BACKGROUND_BY_ENUM[8], CALLOUT_BACKGROUND_BY_ENUM[8]);
  assert.notEqual(FONT_BACKGROUND_BY_ENUM[13], CALLOUT_BACKGROUND_BY_ENUM[13]);
});

for (const [enumValue, token] of fontColors.entries()) {
  test(`normalizes text color enum ${enumValue + 1}`, () => {
    const result = normalizeFeishuDocument(
      paragraphDocument({ text_color: enumValue + 1 }),
    );
    assert.equal(result.issues.length, 0);
    assert.equal(result.document.children[0].inlines[0].style.textColor, token);
  });
}

for (const [enumValue, token] of fontBackgrounds.entries()) {
  test(`normalizes text background enum ${enumValue + 1}`, () => {
    const result = normalizeFeishuDocument(
      paragraphDocument({ background_color: enumValue + 1 }),
    );
    assert.equal(result.issues.length, 0);
    assert.equal(
      result.document.children[0].inlines[0].style.backgroundColor,
      token,
    );
  });
}

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

for (const property of [
  'bold',
  'italic',
  'strikethrough',
  'underline',
  'inline_code',
]) {
  test(`requires ${property} to be boolean when present`, () => {
    const { issues } = normalizeFeishuDocument(
      paragraphDocument({ [property]: 1 }),
    );
    assert.equal(issues[0].code, 'invalid_text_style');
  });
}

test('normalizes the complete fixed inline style shape', () => {
  const result = normalizeFeishuDocument(
    paragraphDocument({
      bold: true,
      italic: true,
      strikethrough: true,
      underline: true,
      inline_code: true,
      text_color: 1,
      background_color: 5,
      link: { url: 'https://example.com/docs_(1)' },
      comment_ids: ['comment_example'],
    }),
  );

  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.document.children[0].inlines[0], {
    kind: 'text',
    blockId: 'paragraph',
    value: '示例',
    style: {
      bold: true,
      italic: true,
      strikethrough: true,
      underline: true,
      inlineCode: true,
      textColor: 'red',
      backgroundColor: 'light-blue',
      href: 'https://example.com/docs_%281%29',
    },
  });
});

test('ignores inherited rich-text style properties', () => {
  const style = Object.create({
    bold: true,
    text_color: 1,
    background_color: 2,
    link: { url: 'https://example.com/inherited' },
  });
  style.italic = true;

  const result = normalizeFeishuDocument(paragraphDocument(style));

  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.document.children[0].inlines[0].style, {
    bold: false,
    italic: true,
    strikethrough: false,
    underline: false,
    inlineCode: false,
    textColor: null,
    backgroundColor: null,
    href: null,
  });
});

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
    text('一', { link: { url: 'javascript:alert(1)' } }),
    text('二', { link: { url: 'https://user:pass@example.com/' } }),
    text('三', { text_shadow: 'red' }),
  ];
  const result = normalizeFeishuDocument(input);
  assert.deepEqual(
    result.issues.map(({ code }) => code),
    ['unsafe_link', 'unsafe_link', 'unsupported_text_style'],
  );
  assert.doesNotMatch(
    result.issues.map(({ message }) => message).join('\n'),
    /javascript|user:pass|example\.com/,
  );
});

test('does not mutate input and recursively freezes the semantic document', () => {
  const input = paragraphDocument({ bold: true, comment_ids: ['comment_example'] });
  const before = structuredClone({
    root: input.root,
    entries: [...input.blocks.entries()],
  });
  const result = normalizeFeishuDocument(input);

  assert.equal(result.issues.length, 0);
  assert.deepEqual(
    { root: input.root, entries: [...input.blocks.entries()] },
    before,
  );
  for (const object of collectObjects(result.document)) {
    assert.equal(Object.isFrozen(object), true);
    assert.equal(Object.hasOwn(object, 'block_id'), false);
  }
});

test('normalizes every existing block kind to a fixed semantic shape', () => {
  const blocks = [
    textBlock('paragraph', 'page'),
    textBlock('heading', 'page', {
      blockType: 4,
      property: 'heading2',
    }),
    textBlock('bullet', 'page', {
      blockType: 12,
      property: 'bullet',
      children: ['nested'],
    }),
    textBlock('nested', 'bullet', {
      blockType: 13,
      property: 'ordered',
    }),
    textBlock('todo', 'page', {
      blockType: 17,
      property: 'todo',
      style: { done: true },
    }),
    textBlock('quote', 'page', {
      blockType: 15,
      property: 'quote',
    }),
    textBlock('code', 'page', {
      blockType: 14,
      property: 'code',
      elements: [text('const x = 1;')],
      style: { language: 30 },
    }),
    {
      block_id: 'divider',
      block_type: 22,
      parent_id: 'page',
      divider: {},
    },
    {
      block_id: 'image',
      block_type: 27,
      parent_id: 'page',
      image: { token: 'img_example' },
    },
  ];
  const result = normalizeFeishuDocument(
    blockDocument(
      ['paragraph', 'heading', 'bullet', 'todo', 'quote', 'code', 'divider', 'image'],
      blocks,
    ),
  );

  assert.equal(result.issues.length, 0);
  assert.deepEqual(
    result.document.children.map(({ kind }) => kind),
    ['paragraph', 'heading', 'listItem', 'listItem', 'quote', 'code', 'divider', 'image'],
  );
  assert.deepEqual(result.document.children[1], {
    kind: 'heading',
    blockId: 'heading',
    depth: 2,
    inlines: result.document.children[1].inlines,
  });
  assert.deepEqual(result.document.children[2], {
    kind: 'listItem',
    blockId: 'bullet',
    listKind: 'bullet',
    checked: undefined,
    inlines: result.document.children[2].inlines,
    children: [
      {
        kind: 'listItem',
        blockId: 'nested',
        listKind: 'ordered',
        checked: undefined,
        inlines: result.document.children[2].children[0].inlines,
        children: [],
      },
    ],
  });
  assert.equal(result.document.children[3].listKind, 'todo');
  assert.equal(result.document.children[3].checked, true);
  assert.deepEqual(result.document.children[5], {
    kind: 'code',
    blockId: 'code',
    value: 'const x = 1;',
    language: 'javascript',
  });
  assert.deepEqual(result.document.children[6], {
    kind: 'divider',
    blockId: 'divider',
  });
  assert.deepEqual(result.document.children[7], {
    kind: 'image',
    blockId: 'image',
    token: 'img_example',
  });
});

test('preserves plain-text code language fallback warnings', () => {
  const result = normalizeSingleTextBlock({
    blockType: 14,
    property: 'code',
    elements: [text('plain')],
    style: { language: 21 },
  });

  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.document.children[0], {
    kind: 'code',
    blockId: 'subject',
    value: 'plain',
    language: 'text',
  });
  assert.deepEqual(result.document.warnings, [
    { blockId: 'subject', type: 'code_language_fallback', language: 21 },
  ]);
});

for (const [elementName, richElement] of [
  ['text run', text(`before\uE000feishu-media:token\uE001after`)],
  ['equation', equation(`x + \uE000feishu-media:token\uE001`)],
]) {
  test(`rejects reserved media placeholders in a ${elementName}`, () => {
    const result = normalizeSingleTextBlock({ elements: [richElement] });
    assert.equal(result.issues[0].code, 'reserved_media_placeholder');
  });
}

for (const source of ['', ' ', '\n\t']) {
  test(`rejects empty equation source ${JSON.stringify(source)}`, () => {
    const result = normalizeSingleTextBlock({ elements: [equation(source)] });
    assert.equal(result.issues[0].code, 'invalid_equation');
  });
}

test('rejects inline-code styling on equations', () => {
  const result = normalizeSingleTextBlock({
    elements: [equation('x', { inline_code: true })],
  });
  assert.equal(result.issues[0].code, 'invalid_text_style');
});

test('uses block display only for a sole equation in a normal paragraph', () => {
  const result = normalizeSingleTextBlock({
    elements: [text('  '), equation('E = mc^2', { bold: true }), text('\n')],
  });

  assert.equal(result.issues.length, 0);
  assert.equal(result.document.mode, 'markdown');
  assert.deepEqual(result.document.children[0].inlines, [
    {
      kind: 'equation',
      blockId: 'subject',
      source: 'E = mc^2',
      display: 'block',
      style: {
        bold: true,
        italic: false,
        strikethrough: false,
        underline: false,
        inlineCode: false,
        textColor: null,
        backgroundColor: null,
        href: null,
      },
    },
  ]);
});

test('validates styles on whitespace omitted around a block equation', () => {
  const privateBlockId = 'block_private_whitespace_style';
  const invalidBlock = textBlock(privateBlockId, 'page', {
    elements: [
      text('  ', {
        text_shadow: 'private-shadow',
        link: { url: 'javascript:private-link' },
      }),
      equation('E = mc^2'),
      text('\n', { text_color: 8, comment_ids: 'private-comment' }),
    ],
  });
  const invalidResult = normalizeFeishuDocument(
    blockDocument([privateBlockId], [invalidBlock]),
  );

  assert.deepEqual(
    invalidResult.issues.map(({ code }) => code),
    [
      'unsupported_text_style',
      'unsafe_link',
      'invalid_text_style',
      'invalid_color_enum',
    ],
  );
  for (const diagnostic of invalidResult.issues) {
    assert.doesNotMatch(
      diagnostic.message,
      /block_private_whitespace_style|private-shadow|private-link|private-comment/,
    );
  }

  const validResult = normalizeSingleTextBlock({
    elements: [
      text(' ', { bold: true, link: { url: 'https://example.com/space' } }),
      equation('E = mc^2'),
      text('\n', { background_color: 2 }),
    ],
  });
  assert.equal(validResult.issues.length, 0);
  assert.deepEqual(
    validResult.document.children[0].inlines.map(({ kind, display }) => ({
      kind,
      display,
    })),
    [{ kind: 'equation', display: 'block' }],
  );
});

test('keeps equations inline when a paragraph mixes text and formula', () => {
  const result = normalizeSingleTextBlock({
    elements: [text('质量 '), equation('m'), text(' 能量')],
  });
  assert.equal(result.issues.length, 0);
  assert.equal(result.document.children[0].inlines[1].display, 'inline');
});

test('keeps multiple equations in one paragraph inline', () => {
  const result = normalizeSingleTextBlock({
    elements: [equation('a'), text(' '), equation('b')],
  });
  assert.equal(result.issues.length, 0);
  assert.deepEqual(
    result.document.children[0].inlines
      .filter(({ kind }) => kind === 'equation')
      .map(({ display }) => display),
    ['inline', 'inline'],
  );
});

for (const [label, blockType, property, style] of [
  ['heading', 3, 'heading1', undefined],
  ['bullet list', 12, 'bullet', undefined],
  ['ordered list', 13, 'ordered', undefined],
  ['todo list', 17, 'todo', { done: false }],
  ['quote', 15, 'quote', undefined],
]) {
  test(`keeps a sole equation inline in a ${label}`, () => {
    const result = normalizeSingleTextBlock({
      blockType,
      property,
      elements: [equation('x')],
      style,
    });
    assert.equal(result.issues.length, 0);
    assert.equal(result.document.children[0].inlines[0].display, 'inline');
  });
}

test('a heading equation requires controlled-document mode', () => {
  const result = normalizeSingleTextBlock({
    blockType: 3,
    property: 'heading1',
    elements: [equation('x')],
  });
  assert.equal(result.issues.length, 0);
  assert.equal(result.document.mode, 'controlled-document');
});

for (const [label, style] of [
  ['underline', { underline: true }],
  ['text color', { text_color: 1 }],
  ['background color', { background_color: 1 }],
]) {
  test(`a heading with ${label} requires controlled-document mode`, () => {
    const result = normalizeSingleTextBlock({
      blockType: 3,
      property: 'heading1',
      elements: [text('标题', style)],
    });
    assert.equal(result.issues.length, 0);
    assert.equal(result.document.mode, 'controlled-document');
  });

  test(`a paragraph with ${label} remains in markdown mode`, () => {
    const result = normalizeSingleTextBlock({
      elements: [text('正文', style)],
    });
    assert.equal(result.issues.length, 0);
    assert.equal(result.document.mode, 'markdown');
  });
}

test('keeps a sole equation inline through a real table and cell parent chain', () => {
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
    children: ['cell-text'],
    table_cell: {},
  };
  const cellText = textBlock('cell-text', 'cell', {
    elements: [equation('x + y')],
  });
  const result = normalizeFeishuDocument(
    blockDocument(['table'], [table, cell, cellText]),
  );

  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.document.children[0].rows, [
    [[result.document.children[0].rows[0][0][0]]],
  ]);
  assert.equal(result.document.children[0].rows[0][0][0][0].kind, 'equation');
  assert.equal(result.document.children[0].rows[0][0][0][0].display, 'inline');
});

test('legacy Markdown rendering rejects equations with a redacted structured issue', () => {
  const privateBlockId = 'block_private_equation';
  const privateEquation = 'private_formula = secret';
  const block = textBlock(privateBlockId, 'page', {
    elements: [equation(privateEquation)],
  });

  assert.throws(
    () =>
      blocksToMarkdown([
        ...blockDocument([privateBlockId], [block]).blocks.values(),
      ]),
    (error) => {
      assert.ok(error instanceof FeishuConversionError);
      assert.deepEqual(error.issues, [
        {
          code: 'unsupported_equation_renderer',
          message: 'The legacy Markdown renderer does not support equations.',
        },
      ]);
      assert.doesNotMatch(error.message, /block_private_equation|private_formula|secret/);
      return true;
    },
  );
});

test('requires exactly one raw rich-element key in public and semantic inputs', () => {
  const malformedElements = [
    { ...text('一'), equation: null },
    { ...text('二'), unexpected: undefined },
  ];
  const block = textBlock('malformed-union', 'page', {
    elements: malformedElements,
  });

  assert.throws(
    () =>
      blocksToMarkdown([
        ...blockDocument(['malformed-union'], [block]).blocks.values(),
      ]),
    (error) => {
      assert.ok(error instanceof FeishuConversionError);
      assert.deepEqual(
        error.issues.map(({ code }) => code),
        Array.from({ length: 4 }, () => 'unsupported_rich_element'),
      );
      return true;
    },
  );

  const semanticResult = normalizeFeishuDocument(
    blockDocument(['malformed-union'], [block]),
  );
  assert.deepEqual(
    semanticResult.issues.map(({ code }) => code),
    ['unsupported_rich_element', 'unsupported_rich_element'],
  );
});

test('semantic issue messages keep private block IDs only in blockId fields', () => {
  const privateBlockId = 'block_private_diagnostic';
  const block = textBlock(privateBlockId, 'page', {
    elements: [
      text('样式', { text_shadow: 'private-style' }),
      null,
      equation(''),
      text('链接', { link: { url: 'javascript:private-link' } }),
    ],
  });
  const result = normalizeFeishuDocument(
    blockDocument([privateBlockId], [block]),
  );

  assert.deepEqual(
    result.issues.map(({ code }) => code),
    [
      'unsupported_text_style',
      'invalid_element',
      'invalid_equation',
      'unsafe_link',
    ],
  );
  for (const diagnostic of result.issues) {
    assert.equal(diagnostic.blockId, privateBlockId);
    assert.doesNotMatch(diagnostic.message, /block_private_diagnostic/);
  }
});
