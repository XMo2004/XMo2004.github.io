import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
import { buildRichFixture } from './helpers/feishu-rich-fixture.mjs';

const richFixture = JSON.parse(
  await readFile(
    new URL('./fixtures/feishu-rich-content.json', import.meta.url),
    'utf8',
  ),
);

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

function calloutDocument(callout = {}) {
  const block = {
    block_id: 'callout',
    block_type: 19,
    parent_id: 'page',
    callout,
  };
  return blockDocument(['callout'], [block]);
}

function sourceSyncedDocument({ align, elements } = {}) {
  const source = {
    block_id: 'source',
    block_type: 49,
    parent_id: 'page',
    children: ['source-paragraph'],
    source_synced: {
      ...(align === undefined ? {} : { align }),
      elements:
        elements === undefined
          ? [text('同步标题 '), equation('s = t')]
          : elements,
    },
  };
  const paragraph = textBlock('source-paragraph', 'source', {
    elements: [text('同步正文')],
  });
  return blockDocument(['source'], [source, paragraph]);
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

test('public rendering accepts equations through the safe renderer', () => {
  const privateBlockId = 'block_private_equation';
  const privateEquation = 'private_formula = secret';
  const block = textBlock(privateBlockId, 'page', {
    elements: [equation(privateEquation)],
  });

  const result = blocksToMarkdown([
    ...blockDocument([privateBlockId], [block]).blocks.values(),
  ]);
  assert.match(
    result.markdown,
    /class="feishu-equation feishu-equation--block"/,
  );
  assert.match(result.markdown, /data-feishu-equation-source="[A-Za-z0-9_-]+"/);
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

test('callout container fields ignore inherited values', () => {
  const inherited = Object.create({
    emoji_id: 'grinning',
    background_color: 1,
    border_color: 2,
    text_color: 3,
  });
  const result = normalizeFeishuDocument(calloutDocument(inherited));

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
});

test('normalizes source synced title alignment and descendants', () => {
  const result = normalizeFeishuDocument(sourceSyncedDocument({ align: 3 }));
  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.document.children[0], {
    kind: 'sourceSynced',
    blockId: 'source',
    title: [
      {
        kind: 'text',
        blockId: 'source',
        value: '同步标题 ',
        style: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          inlineCode: false,
          textColor: null,
          backgroundColor: null,
          href: null,
        },
      },
      {
        kind: 'equation',
        blockId: 'source',
        source: 's = t',
        display: 'inline',
        style: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          inlineCode: false,
          textColor: null,
          backgroundColor: null,
          href: null,
        },
      },
    ],
    align: 'right',
    children: [
      {
        kind: 'paragraph',
        blockId: 'source-paragraph',
        inlines: [
          {
            kind: 'text',
            blockId: 'source-paragraph',
            value: '同步正文',
            style: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              inlineCode: false,
              textColor: null,
              backgroundColor: null,
              href: null,
            },
          },
        ],
      },
    ],
  });
  assert.equal(result.document.mode, 'controlled-document');
});

test('source synced container fields ignore inherited values', () => {
  const input = sourceSyncedDocument();
  input.blocks.get('source').source_synced = Object.create({
    elements: [text('继承标题'), equation('private = source')],
    align: 3,
  });
  const result = normalizeFeishuDocument(input);

  assert.equal(result.issues.length, 0);
  assert.equal(result.document.children[0].align, 'left');
  assert.deepEqual(result.document.children[0].title, []);
  assert.equal(result.document.children[0].children[0].kind, 'paragraph');
});

for (const [field, values, tokens] of [
  ['background_color', CALLOUT_BACKGROUND_BY_ENUM, calloutBackgrounds],
  ['border_color', CALLOUT_BORDER_BY_ENUM, fontColors],
  ['text_color', FONT_COLOR_BY_ENUM, fontColors],
]) {
  for (const [index, token] of tokens.entries()) {
    test(`normalizes callout ${field} enum ${index + 1}`, () => {
      const result = normalizeFeishuDocument(
        calloutDocument({ [field]: index + 1 }),
      );
      assert.equal(result.issues.length, 0);
      const semanticField =
        field === 'background_color'
          ? 'background'
          : field === 'border_color'
            ? 'border'
            : 'textColor';
      assert.equal(result.document.children[0][semanticField], token);
      assert.equal(values[index + 1], token);
    });
  }
}

for (const [label, callout, emoji] of [
  ['missing callout emoji', {}, '🎁'],
  ['gift callout emoji', { emoji_id: 'gift' }, '🎁'],
  ['known callout emoji', { emoji_id: 'grinning' }, '😀'],
]) {
  test(`normalizes ${label}`, () => {
    const result = normalizeFeishuDocument(calloutDocument(callout));
    assert.equal(result.issues.length, 0);
    assert.equal(result.document.children[0].emoji, emoji);
  });
}

for (const invalid of ['', null, 1, 'unknown-private-emoji']) {
  test(`rejects unsupported callout emoji ${JSON.stringify(invalid)}`, () => {
    const { issues } = normalizeFeishuDocument(
      calloutDocument({ emoji_id: invalid }),
    );
    assert.deepEqual(issues.map(({ code }) => code), [
      'unsupported_callout_emoji',
    ]);
    assert.doesNotMatch(
      issues[0].message,
      /unknown-private-emoji/,
    );
  });
}

for (const [field, invalidValues] of [
  ['background_color', [null, 0, -1, 1.5, '1', 16]],
  ['border_color', [null, 0, -1, 1.5, '1', 8]],
  ['text_color', [null, 0, -1, 1.5, '1', 8]],
]) {
  for (const invalid of invalidValues) {
    test(`rejects invalid callout ${field} enum ${JSON.stringify(invalid)}`, () => {
      const { issues } = normalizeFeishuDocument(
        calloutDocument({ [field]: invalid }),
      );
      assert.deepEqual(issues.map(({ code }) => code), ['invalid_color_enum']);
    });
  }
}

for (const [label, callout] of [
  ['missing callout data', undefined],
  ['null callout data', null],
  ['array callout data', []],
  ['string callout data', 'private-callout'],
]) {
  test(`rejects ${label}`, () => {
    const input = calloutDocument({});
    if (label === 'missing callout data') {
      delete input.blocks.get('callout').callout;
    } else {
      input.blocks.get('callout').callout = callout;
    }
    const { issues } = normalizeFeishuDocument(input);
    assert.deepEqual(issues.map(({ code }) => code), ['invalid_callout']);
    assert.doesNotMatch(issues[0].message, /private-callout/);
  });
}

for (const [align, expected] of [
  [undefined, 'left'],
  [1, 'left'],
  [2, 'center'],
  [3, 'right'],
]) {
  test(`normalizes source synced align ${String(align)} to ${expected}`, () => {
    const result = normalizeFeishuDocument(sourceSyncedDocument({ align }));
    assert.equal(result.issues.length, 0);
    assert.equal(result.document.children[0].align, expected);
  });
}

for (const invalid of [0, 4, 1.5, '1']) {
  test(`rejects invalid source synced align ${JSON.stringify(invalid)}`, () => {
    const { issues } = normalizeFeishuDocument(
      sourceSyncedDocument({ align: invalid }),
    );
    assert.deepEqual(issues.map(({ code }) => code), [
      'invalid_source_synced_align',
    ]);
  });
}

for (const [label, sourceData] of [
  ['missing source synced data', undefined],
  ['null source synced data', null],
  ['array source synced data', []],
  ['string source synced data', 'private-source'],
]) {
  test(`rejects ${label}`, () => {
    const input = sourceSyncedDocument();
    if (label === 'missing source synced data') {
      delete input.blocks.get('source').source_synced;
    } else {
      input.blocks.get('source').source_synced = sourceData;
    }
    const { issues } = normalizeFeishuDocument(input);
    assert.deepEqual(issues.map(({ code }) => code), ['invalid_source_synced']);
    assert.doesNotMatch(issues[0].message, /private-source/);
  });
}

test('treats only undefined source synced elements as an empty title', () => {
  const input = sourceSyncedDocument();
  delete input.blocks.get('source').source_synced.elements;
  const result = normalizeFeishuDocument(input);
  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.document.children[0].title, []);
});

for (const invalid of [null, {}, 'private-title', 1, false]) {
  test(`rejects non-array source synced elements ${JSON.stringify(invalid)}`, () => {
    const input = sourceSyncedDocument();
    input.blocks.get('source').source_synced.elements = invalid;
    const { issues } = normalizeFeishuDocument(input);
    assert.deepEqual(issues.map(({ code }) => code), ['invalid_source_synced']);
    assert.doesNotMatch(issues[0].message, /private-title/);
  });
}

test('aggregates invalid callout data with invalid descendant equations', () => {
  const input = calloutDocument(null);
  const callout = input.blocks.get('callout');
  callout.children = ['callout-child'];
  input.blocks.set(
    'callout-child',
    textBlock('callout-child', 'callout', { elements: [equation('')] }),
  );
  assert.deepEqual(
    normalizeFeishuDocument(input).issues.map(({ code }) => code),
    ['invalid_equation', 'invalid_callout'],
  );
});

test('aggregates invalid source synced data with invalid descendant equations', () => {
  const input = sourceSyncedDocument();
  input.blocks.get('source').source_synced = null;
  input.blocks.get('source-paragraph').text.elements = [equation('')];
  assert.deepEqual(
    normalizeFeishuDocument(input).issues.map(({ code }) => code),
    ['invalid_equation', 'invalid_source_synced'],
  );
});

test('aggregates malformed source synced title leaves with invalid descendants', () => {
  const input = sourceSyncedDocument({ elements: [{ text_run: null }] });
  input.blocks.get('source-paragraph').text.elements = [equation('')];
  assert.deepEqual(
    normalizeFeishuDocument(input).issues.map(({ code }) => code),
    ['invalid_equation', 'invalid_text_run'],
  );
});

test('requires controlled document mode for a callout nested in a list', () => {
  const callout = {
    block_id: 'nested-callout',
    block_type: 19,
    parent_id: 'list',
    callout: {},
  };
  const list = textBlock('list', 'page', {
    blockType: 12,
    property: 'bullet',
    children: ['nested-callout'],
  });
  const result = normalizeFeishuDocument(
    blockDocument(['list'], [list, callout]),
  );
  assert.equal(result.issues.length, 0);
  assert.equal(result.document.mode, 'controlled-document');
});

test('keeps the deterministic rich fixture and its enum coverage in sync', () => {
  const built = buildRichFixture();
  assert.deepEqual(richFixture, built);

  const byId = new Map(built.items.map((block) => [block.block_id, block]));
  const richStyles = collectObjects(built)
    .filter((value) => Object.hasOwn(value, 'text_element_style'))
    .map(({ text_element_style: style }) => style);
  const uniqueStyleEnums = (field) => [
    ...new Set(
      richStyles
        .map((style) => style[field])
        .filter((value) => value !== undefined),
    ),
  ].sort((left, right) => left - right);
  const textColors = uniqueStyleEnums('text_color');
  const textBackgrounds = uniqueStyleEnums('background_color');
  const callouts = built.items.filter(({ block_type }) => block_type === 19);
  const uniqueCalloutEnums = (field) => [
    ...new Set(
      callouts
        .map(({ callout }) => callout[field])
        .filter((value) => value !== undefined),
    ),
  ].sort((left, right) => left - right);
  const calloutBackgroundsInFixture = uniqueCalloutEnums('background_color');
  const calloutBordersInFixture = uniqueCalloutEnums('border_color');
  const calloutTextColorsInFixture = uniqueCalloutEnums('text_color');

  assert.deepEqual(textColors, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(
    textBackgrounds,
    Array.from({ length: 15 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    calloutBackgroundsInFixture,
    Array.from({ length: 15 }, (_, index) => index + 1),
  );
  assert.deepEqual(calloutBordersInFixture, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(calloutTextColorsInFixture, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(Object.hasOwn(byId.get('rich-callout-1').callout, 'emoji_id'), false);
  assert.equal(byId.get('rich-callout-2').callout.emoji_id, 'grinning');
  assert.equal(byId.get('rich-callout-3').callout.emoji_id, 'gift');
  assert.ok(byId.get('rich-callout-1').children.includes('rich-callout-1-list'));
  assert.ok(byId.get('rich-source-list').children.includes('rich-source-list-callout'));
  assert.ok(byId.get('rich-source').children.includes('rich-source-table'));
  assert.ok(byId.get('rich-source').children.includes('rich-source-image'));
  assert.equal(
    built.items.filter(({ block_type }) => block_type >= 3 && block_type <= 8)
      .length >= 3,
    true,
  );
});
