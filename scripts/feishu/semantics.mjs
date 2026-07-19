export const FONT_COLOR_BY_ENUM = Object.freeze({
  1: 'red',
  2: 'orange',
  3: 'yellow',
  4: 'green',
  5: 'blue',
  6: 'purple',
  7: 'gray',
});

export const CALLOUT_BORDER_BY_ENUM = Object.freeze({
  ...FONT_COLOR_BY_ENUM,
});

export const FONT_BACKGROUND_BY_ENUM = Object.freeze({
  1: 'light-red',
  2: 'light-orange',
  3: 'light-yellow',
  4: 'light-green',
  5: 'light-blue',
  6: 'light-purple',
  7: 'medium-gray',
  8: 'red',
  9: 'orange',
  10: 'yellow',
  11: 'green',
  12: 'blue',
  13: 'purple',
  14: 'gray',
  15: 'light-gray',
});

export const CALLOUT_BACKGROUND_BY_ENUM = Object.freeze({
  1: 'light-red',
  2: 'light-orange',
  3: 'light-yellow',
  4: 'light-green',
  5: 'light-blue',
  6: 'light-purple',
  7: 'medium-gray',
  8: 'medium-red',
  9: 'medium-orange',
  10: 'medium-yellow',
  11: 'medium-green',
  12: 'medium-blue',
  13: 'medium-purple',
  14: 'gray',
  15: 'light-gray',
});

export const TEXT_PROPERTY_BY_TYPE = new Map([
  [2, 'text'],
  [3, 'heading1'],
  [4, 'heading2'],
  [5, 'heading3'],
  [6, 'heading4'],
  [7, 'heading5'],
  [8, 'heading6'],
  [12, 'bullet'],
  [13, 'ordered'],
  [14, 'code'],
  [15, 'quote'],
  [17, 'todo'],
]);

export const CODE_LANGUAGES = new Map([
  [1, 'text'],
  [2, 'abap'],
  [3, 'ada'],
  [4, 'apache'],
  [5, 'apex'],
  [6, 'asm'],
  [7, 'bash'],
  [8, 'csharp'],
  [9, 'cpp'],
  [10, 'c'],
  [11, 'cobol'],
  [12, 'css'],
  [13, 'coffeescript'],
  [14, 'd'],
  [15, 'dart'],
  [16, 'pascal'],
  [17, 'jinja'],
  [18, 'dockerfile'],
  [19, 'erlang'],
  [20, 'fortran-free-form'],
  [21, 'text'],
  [22, 'go'],
  [23, 'groovy'],
  [24, 'html'],
  [25, 'handlebars'],
  [26, 'http'],
  [27, 'haskell'],
  [28, 'json'],
  [29, 'java'],
  [30, 'javascript'],
  [31, 'julia'],
  [32, 'kotlin'],
  [33, 'latex'],
  [34, 'lisp'],
  [35, 'logo'],
  [36, 'lua'],
  [37, 'matlab'],
  [38, 'makefile'],
  [39, 'markdown'],
  [40, 'nginx'],
  [41, 'objective-c'],
  [42, 'text'],
  [43, 'php'],
  [44, 'perl'],
  [45, 'text'],
  [46, 'powershell'],
  [47, 'prolog'],
  [48, 'protobuf'],
  [49, 'python'],
  [50, 'r'],
  [51, 'text'],
  [52, 'ruby'],
  [53, 'rust'],
  [54, 'sas'],
  [55, 'scss'],
  [56, 'sql'],
  [57, 'scala'],
  [58, 'scheme'],
  [59, 'text'],
  [60, 'shell'],
  [61, 'swift'],
  [62, 'text'],
  [63, 'typescript'],
  [64, 'vb'],
  [65, 'vb'],
  [66, 'xml'],
  [67, 'yaml'],
  [68, 'cmake'],
  [69, 'diff'],
  [70, 'gherkin'],
  [71, 'graphql'],
  [72, 'glsl'],
  [73, 'properties'],
  [74, 'solidity'],
  [75, 'toml'],
]);

export const PLAIN_TEXT_CODE_FALLBACKS = new Set([21, 42, 45, 51, 59, 62]);

const STYLE_KEYS = new Set([
  'bold',
  'italic',
  'strikethrough',
  'underline',
  'inline_code',
  'text_color',
  'background_color',
  'link',
  'comment_ids',
]);
const BOOLEAN_STYLE_KEYS = [
  'bold',
  'italic',
  'strikethrough',
  'underline',
  'inline_code',
];
const MEDIA_PLACEHOLDER_PREFIX = '\uE000feishu-media:';
const MEDIA_PLACEHOLDER_SUFFIX = '\uE001';

function issue(code, message, blockId) {
  return { code, message, ...(blockId ? { blockId } : {}) };
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function normalizeLinkUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('link URL is missing');
  }

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // A normal URL may contain a literal percent. URL parsing below remains final.
  }

  let url;
  try {
    url = new URL(decoded);
  } catch {
    throw new Error(`link URL "${value}" is invalid`);
  }

  if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
    throw new Error(`link protocol "${url.protocol}" is not allowed`);
  }
  if (url.username || url.password) {
    throw new Error('link URL must not contain credentials');
  }

  return url.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function optionalEnum(value, values, issues, block) {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || !Object.hasOwn(values, value)) {
    issues.push(
      issue(
        'invalid_color_enum',
        'Rich-text color enum is invalid.',
        block.block_id,
      ),
    );
    return null;
  }
  return values[value];
}

function ownStyleValue(style, key) {
  return Object.hasOwn(style, key) ? style[key] : undefined;
}

function normalizeStyle(rawStyle, block, issues) {
  let style = rawStyle;
  if (style === undefined) {
    style = {};
  } else if (style === null || typeof style !== 'object' || Array.isArray(style)) {
    issues.push(
      issue(
        'invalid_text_style',
        'Rich-text style data must be an object.',
        block.block_id,
      ),
    );
    style = {};
  }

  for (const key of Object.keys(style)) {
    if (!STYLE_KEYS.has(key)) {
      issues.push(
        issue(
          'unsupported_text_style',
          `Rich-text style "${key}" is unsupported.`,
          block.block_id,
        ),
      );
    }
  }

  for (const key of BOOLEAN_STYLE_KEYS) {
    if (Object.hasOwn(style, key) && typeof style[key] !== 'boolean') {
      issues.push(
        issue(
          'invalid_text_style',
          'Rich-text boolean style must be boolean.',
          block.block_id,
        ),
      );
    }
  }

  if (
    Object.hasOwn(style, 'comment_ids') &&
    (!Array.isArray(style.comment_ids) ||
      style.comment_ids.some((commentId) => typeof commentId !== 'string'))
  ) {
    issues.push(
      issue(
        'invalid_text_style',
        'Rich-text comment metadata must be a string array.',
        block.block_id,
      ),
    );
  }

  let href = null;
  if (Object.hasOwn(style, 'link')) {
    try {
      href = normalizeLinkUrl(ownStyleValue(style, 'link')?.url);
    } catch {
      issues.push(
        issue(
          'unsafe_link',
          'Rich-text link is unsafe.',
          block.block_id,
        ),
      );
    }
  }

  return {
    bold: ownStyleValue(style, 'bold') === true,
    italic: ownStyleValue(style, 'italic') === true,
    strikethrough: ownStyleValue(style, 'strikethrough') === true,
    underline: ownStyleValue(style, 'underline') === true,
    inlineCode: ownStyleValue(style, 'inline_code') === true,
    textColor: optionalEnum(
      ownStyleValue(style, 'text_color'),
      FONT_COLOR_BY_ENUM,
      issues,
      block,
    ),
    backgroundColor: optionalEnum(
      ownStyleValue(style, 'background_color'),
      FONT_BACKGROUND_BY_ENUM,
      issues,
      block,
    ),
    href,
  };
}

function containsReservedMediaPlaceholder(value) {
  return (
    value.includes(MEDIA_PLACEHOLDER_PREFIX) ||
    value.includes(MEDIA_PLACEHOLDER_SUFFIX)
  );
}

function normalizeRichElements(
  block,
  elements,
  issues,
  { forceInlineEquation = false } = {},
) {
  if (!Array.isArray(elements)) {
    issues.push(
      issue(
        'invalid_elements',
        'Rich-text elements must be an array.',
        block.block_id,
      ),
    );
    return [];
  }

  const nonWhitespaceElements = elements.filter(
    (element) =>
      element?.equation !== undefined ||
      !/^\s*$/.test(element?.text_run?.content ?? ''),
  );
  const blockEquation =
    block.block_type === 2 &&
    !forceInlineEquation &&
    nonWhitespaceElements.length === 1 &&
    nonWhitespaceElements[0]?.equation !== undefined;
  const inlines = [];

  for (const element of elements) {
    if (element === null || typeof element !== 'object' || Array.isArray(element)) {
      issues.push(
        issue(
          'invalid_element',
          'Rich-text element must be an object.',
          block.block_id,
        ),
      );
      continue;
    }

    const elementTypes = Object.keys(element);
    if (
      elementTypes.length !== 1 ||
      !['text_run', 'equation'].includes(elementTypes[0])
    ) {
      issues.push(
        issue(
          'unsupported_rich_element',
          'Rich-text element must contain exactly one supported field.',
          block.block_id,
        ),
      );
      continue;
    }

    if (elementTypes[0] === 'text_run') {
      const textRun = element.text_run;
      if (
        textRun === null ||
        typeof textRun !== 'object' ||
        Array.isArray(textRun) ||
        typeof textRun.content !== 'string'
      ) {
        issues.push(
          issue(
            'invalid_text_run',
            'Text run must contain string content.',
            block.block_id,
          ),
        );
        continue;
      }
      if (containsReservedMediaPlaceholder(textRun.content)) {
        issues.push(
          issue(
            'reserved_media_placeholder',
            'Text run contains reserved media placeholder characters.',
            block.block_id,
          ),
        );
      }
      const style = normalizeStyle(textRun.text_element_style, block, issues);
      if (blockEquation && /^\s*$/.test(textRun.content)) continue;
      inlines.push({
        kind: 'text',
        blockId: block.block_id,
        value: textRun.content,
        style,
      });
      continue;
    }

    const equation = element.equation;
    if (
      equation === null ||
      typeof equation !== 'object' ||
      Array.isArray(equation) ||
      typeof equation.content !== 'string' ||
      /^\s*$/.test(equation.content)
    ) {
      issues.push(
        issue(
          'invalid_equation',
          'Equation must contain non-whitespace string content.',
          block.block_id,
        ),
      );
      continue;
    }
    if (containsReservedMediaPlaceholder(equation.content)) {
      issues.push(
        issue(
          'reserved_media_placeholder',
          'Equation contains reserved media placeholder characters.',
          block.block_id,
        ),
      );
    }
    const style = normalizeStyle(equation.text_element_style, block, issues);
    if (style.inlineCode) {
      issues.push(
        issue(
          'invalid_text_style',
          'Equation cannot use inline-code styling.',
          block.block_id,
        ),
      );
    }
    inlines.push({
      kind: 'equation',
      blockId: block.block_id,
      source: equation.content,
      display: blockEquation ? 'block' : 'inline',
      style,
    });
  }

  return inlines;
}

function normalizeChildren(block, blocks, issues, warnings) {
  return (Array.isArray(block.children) ? block.children : [])
    .map((blockId) =>
      normalizeBlock(blocks.get(blockId), blocks, issues, warnings),
    )
    .filter((node) => node !== null);
}

function normalizeTable(block, blocks, issues) {
  const rowSize = block.table?.property?.row_size ?? 0;
  const columnSize = block.table?.property?.column_size ?? 0;
  const cells = Array.isArray(block.table?.cells) ? block.table.cells : [];
  const normalizedCells = cells.map((cellId) => {
    const cell = blocks.get(cellId);
    return (Array.isArray(cell?.children) ? cell.children : []).map((childId) => {
      const child = blocks.get(childId);
      const property = child === undefined ? undefined : TEXT_PROPERTY_BY_TYPE.get(child.block_type);
      const elements = property === undefined ? undefined : child[property]?.elements;
      return child === undefined
        ? []
        : normalizeRichElements(child, elements, issues, {
            forceInlineEquation: true,
          });
    });
  });
  const rows = Array.from({ length: rowSize }, (_, rowIndex) =>
    normalizedCells.slice(
      rowIndex * columnSize,
      (rowIndex + 1) * columnSize,
    ),
  );
  return { kind: 'table', blockId: block.block_id, rows };
}

function normalizeBlock(block, blocks, issues, warnings) {
  if (block === undefined) return null;
  const property = TEXT_PROPERTY_BY_TYPE.get(block.block_type);
  const elements = property === undefined ? undefined : block[property]?.elements;

  if (block.block_type >= 3 && block.block_type <= 8) {
    return {
      kind: 'heading',
      blockId: block.block_id,
      depth: block.block_type - 2,
      inlines: normalizeRichElements(block, elements, issues, {
        forceInlineEquation: true,
      }),
    };
  }

  switch (block.block_type) {
    case 2:
      return {
        kind: 'paragraph',
        blockId: block.block_id,
        inlines: normalizeRichElements(block, elements, issues),
      };
    case 12:
    case 13:
    case 17:
      return {
        kind: 'listItem',
        blockId: block.block_id,
        listKind:
          block.block_type === 12
            ? 'bullet'
            : block.block_type === 13
              ? 'ordered'
              : 'todo',
        checked:
          block.block_type === 17 ? block.todo?.style?.done === true : undefined,
        inlines: normalizeRichElements(block, elements, issues, {
          forceInlineEquation: true,
        }),
        children: normalizeChildren(block, blocks, issues, warnings),
      };
    case 14: {
      normalizeRichElements(block, elements, issues, {
        forceInlineEquation: true,
      });
      const languageEnum = block.code?.style?.language;
      if (PLAIN_TEXT_CODE_FALLBACKS.has(languageEnum)) {
        warnings.push({
          blockId: block.block_id,
          type: 'code_language_fallback',
          language: languageEnum,
        });
      }
      return {
        kind: 'code',
        blockId: block.block_id,
        value: Array.isArray(elements)
          ? elements
              .map(
                (element) =>
                  element?.text_run?.content ?? element?.equation?.content ?? '',
              )
              .join('')
          : '',
        language: CODE_LANGUAGES.get(languageEnum) ?? 'text',
      };
    }
    case 15:
      return {
        kind: 'quote',
        blockId: block.block_id,
        inlines: normalizeRichElements(block, elements, issues, {
          forceInlineEquation: true,
        }),
      };
    case 22:
      return { kind: 'divider', blockId: block.block_id };
    case 27:
      return {
        kind: 'image',
        blockId: block.block_id,
        token: block.image?.token,
      };
    case 31:
      return normalizeTable(block, blocks, issues);
    default:
      return null;
  }
}

function requiresControlledDocument(children) {
  function visit(node) {
    if (node === null || typeof node !== 'object') return false;
    if (node.kind === 'callout' || node.kind === 'sourceSynced') return true;
    if (
      node.kind === 'heading' &&
      node.inlines.some(
        (inline) =>
          inline.kind === 'equation' ||
          inline.style.underline ||
          inline.style.textColor !== null ||
          inline.style.backgroundColor !== null,
      )
    ) {
      return true;
    }
    return Object.values(node).some((value) =>
      Array.isArray(value) ? value.some(visit) : false,
    );
  }
  return children.some(visit);
}

export function normalizeFeishuDocument({ blocks, root }) {
  const issues = [];
  const warnings = [];
  const children = (root?.children ?? [])
    .map((blockId) =>
      normalizeBlock(blocks.get(blockId), blocks, issues, warnings),
    )
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
