import { decodeHTMLStrict } from 'entities';
import katex from 'katex';

export const FORMULA_LIMITS = Object.freeze({
  count: 200,
  sourceBytes: 8 * 1024,
  renderedBytes: 512 * 1024,
  totalRenderedBytes: 4 * 1024 * 1024,
});

const INVALID_EQUATION_MESSAGE = 'Equation could not be rendered safely.';
const FORMULA_BUDGET_MESSAGE = 'Equation rendering budget was exceeded.';
const HTML_ENTITY = /&(?:#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);/y;
const PUNCTUATION_OR_LINE_BREAK =
  /[\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e\r\n]/;
const FORBIDDEN_TEX_COMMANDS = new Set([
  'includegraphics',
  'htmlClass',
  'htmlStyle',
  'htmlId',
  'htmlData',
  'href',
  'url',
]);

function issue(code, message, blockId) {
  return { code, message, blockId };
}

function isValidNumericEntity(token) {
  if (!token.startsWith('&#')) return true;
  const hexadecimal = token[2] === 'x' || token[2] === 'X';
  const digits = token.slice(hexadecimal ? 3 : 2, -1);
  const value = Number.parseInt(digits, hexadecimal ? 16 : 10);
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0x10ffff &&
    !(value >= 0xd800 && value <= 0xdfff)
  );
}

function decodeEntityAt(value, index) {
  HTML_ENTITY.lastIndex = index;
  const match = HTML_ENTITY.exec(value);
  if (!match || !isValidNumericEntity(match[0])) return null;
  const decoded = decodeHTMLStrict(match[0]);
  if (decoded === match[0]) return null;
  return { decoded, length: match[0].length };
}

function addProtocolBreaks(value, breaks) {
  const protocol = /(^|[^A-Za-z0-9])(?:https?|mailto)(?=:)/gi;
  let match;
  while ((match = protocol.exec(value)) !== null) {
    breaks.add(match.index + match[0].length);
  }
}

function addWwwBreaks(value, breaks) {
  const www = /(^|[^A-Za-z0-9])www(?=\.)/gi;
  let match;
  while ((match = www.exec(value)) !== null) {
    breaks.add(match.index + match[0].length);
  }
}

function isAsciiAlphaNumeric(character) {
  const codePoint = character.codePointAt(0);
  return (
    (codePoint >= 0x30 && codePoint <= 0x39) ||
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a)
  );
}

function isEmailLocalCharacter(character) {
  return (
    isAsciiAlphaNumeric(character) ||
    ".!#$%&'*+/=?^_`{|}~-".includes(character)
  );
}

function addEmailBreaks(value, breaks) {
  for (
    let at = value.indexOf('@');
    at !== -1;
    at = value.indexOf('@', at + 1)
  ) {
    let localStart = at;
    while (
      localStart > 0 &&
      isEmailLocalCharacter(value[localStart - 1])
    ) {
      localStart -= 1;
    }
    if (localStart === at) continue;

    let labelLength = 0;
    let dots = 0;
    let hasCompleteDomain = false;
    for (let index = at + 1; index < value.length; index += 1) {
      const character = value[index];
      if (isAsciiAlphaNumeric(character) || character === '-') {
        labelLength += 1;
        if (dots > 0) hasCompleteDomain = true;
      } else if (character === '.' && labelLength > 0) {
        dots += 1;
        labelLength = 0;
      } else {
        break;
      }
    }
    if (hasCompleteDomain) breaks.add(at);
  }
}

function encodeMarkdownEmbeddedText(value) {
  if (!PUNCTUATION_OR_LINE_BREAK.test(value)) return value;
  const breaks = new Set();
  if (value.includes(':')) addProtocolBreaks(value, breaks);
  if (value.includes('.')) addWwwBreaks(value, breaks);
  if (value.includes('@')) addEmailBreaks(value, breaks);

  let encoded = '';
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index);
    const character = String.fromCodePoint(codePoint);
    if (breaks.has(index)) encoded += '<!---->';
    if (character === '\r') {
      encoded += '&#13;';
    } else if (character === '\n') {
      encoded += '&#10;';
    } else if (isAsciiPunctuation(codePoint)) {
      encoded += `&#${codePoint};`;
    } else {
      encoded += character;
    }
    index += character.length;
  }
  return encoded;
}

function isAsciiPunctuation(codePoint) {
  return (
    (codePoint >= 0x21 && codePoint <= 0x2f) ||
    (codePoint >= 0x3a && codePoint <= 0x40) ||
    (codePoint >= 0x5b && codePoint <= 0x60) ||
    (codePoint >= 0x7b && codePoint <= 0x7e)
  );
}

function containsForbiddenTexCommand(source) {
  for (let index = 0; index < source.length;) {
    if (source[index] === '%') {
      const newline = source.slice(index + 1).search(/[\r\n]/);
      if (newline === -1) return false;
      index += newline + 1;
      continue;
    }
    if (source[index] !== '\\') {
      index += 1;
      continue;
    }

    let runEnd = index;
    while (source[runEnd] === '\\') runEnd += 1;
    const runLength = runEnd - index;
    index = runEnd;
    if (runLength % 2 === 0 || index >= source.length) continue;

    if (!/[A-Za-z]/.test(source[index])) {
      index += 1;
      continue;
    }
    const wordStart = index;
    while (/[A-Za-z]/.test(source[index] ?? '')) index += 1;
    const command = source.slice(wordStart, index);
    if (command === 'verb') {
      if (source[index] === '*') index += 1;
      if (index >= source.length || /[\r\n]/.test(source[index])) continue;
      const delimiter = source[index];
      const literalEnd = source.indexOf(delimiter, index + 1);
      index = literalEnd === -1 ? source.length : literalEnd + 1;
      continue;
    }
    if (FORBIDDEN_TEX_COMMANDS.has(command)) return true;
  }
  return false;
}

function encodeTextNode(value) {
  if (!value.includes('&')) return encodeMarkdownEmbeddedText(value);
  let decoded = '';
  for (let index = 0; index < value.length;) {
    if (value[index] === '&') {
      const entity = decodeEntityAt(value, index);
      if (entity) {
        decoded += entity.decoded;
        index += entity.length;
        continue;
      }
    }
    const codePoint = value.codePointAt(index);
    const character = String.fromCodePoint(codePoint);
    decoded += character;
    index += character.length;
  }
  return encodeMarkdownEmbeddedText(decoded);
}

function encodeQuotedAttributeCharacter(character) {
  if (character === '|') return '&#124;';
  if (character === '\r') return '&#13;';
  if (character === '\n') return '&#10;';
  return character;
}

function encodeKatexForMarkdown(html) {
  if (!html.includes('<')) return encodeTextNode(html);
  let encoded = '';
  let state = 'text';
  let textNode = '';

  const flushTextNode = () => {
    if (textNode.length > 0) {
      encoded += encodeTextNode(textNode);
      textNode = '';
    }
  };

  for (let index = 0; index < html.length; index += 1) {
    const character = html[index];
    if (state === 'text') {
      if (html.startsWith('<!--', index)) {
        flushTextNode();
        encoded += '<!--';
        state = 'comment';
        index += 3;
      } else if (character === '<') {
        flushTextNode();
        encoded += character;
        state = 'tag';
      } else {
        textNode += character;
      }
      continue;
    }

    if (state === 'comment') {
      if (html.startsWith('-->', index)) {
        encoded += '-->';
        state = 'text';
        index += 2;
      } else {
        encoded += character;
      }
      continue;
    }

    if (state === 'double-quoted-attribute') {
      encoded += encodeQuotedAttributeCharacter(character);
      if (character === '"') state = 'tag';
      continue;
    }

    if (state === 'single-quoted-attribute') {
      encoded += encodeQuotedAttributeCharacter(character);
      if (character === "'") state = 'tag';
      continue;
    }

    if (character === '"') {
      encoded += character;
      state = 'double-quoted-attribute';
    } else if (character === "'") {
      encoded += character;
      state = 'single-quoted-attribute';
    } else if (character === '>') {
      encoded += character;
      state = 'text';
    } else if (character === '\r' || character === '\n') {
      encoded += ' ';
      if (character === '\r' && html[index + 1] === '\n') index += 1;
    } else {
      encoded += character;
    }
  }
  if (state === 'comment') encoded += '-->';
  flushTextNode();
  return encoded;
}

function collectEquations(document) {
  if (document.kind !== 'document') unsupportedKind(document.kind);
  const equations = [];
  for (const block of document.children) {
    if (block.kind !== 'paragraph') unsupportedKind(block.kind);
    for (const inline of block.inlines) {
      if (inline.kind === 'equation') {
        equations.push(inline);
      } else if (inline.kind !== 'text') {
        unsupportedKind(inline.kind);
      }
    }
  }
  return equations;
}

function preRenderEquations(document, katexRender, issues) {
  const equationNodes = collectEquations(document);
  const equations = equationNodes.map((node) => ({
    node,
    source: node.source.normalize('NFKC'),
  }));

  if (equations.length > FORMULA_LIMITS.count) {
    issues.push(issue(
      'formula_budget_exceeded',
      FORMULA_BUDGET_MESSAGE,
      equations[FORMULA_LIMITS.count]?.node.blockId,
    ));
  }
  for (const equation of equations) {
    if (Buffer.byteLength(equation.source, 'utf8') > FORMULA_LIMITS.sourceBytes) {
      issues.push(issue(
        'formula_budget_exceeded',
        FORMULA_BUDGET_MESSAGE,
        equation.node.blockId,
      ));
    }
  }
  if (issues.length > 0) return new Map();

  const renderedEquations = new Map();
  let totalRenderedBytes = 0;
  let totalExceededAt;
  for (const equation of equations) {
    try {
      const renderedHtml = katexRender(equation.source, {
        displayMode: equation.node.display === 'block',
        output: 'htmlAndMathml',
        throwOnError: true,
        trust: false,
        strict: 'error',
        maxSize: 20,
        maxExpand: 1000,
      });
      if (typeof renderedHtml !== 'string') {
        throw new TypeError('KaTeX renderer returned a non-string result.');
      }
      const renderedBytes = Buffer.byteLength(renderedHtml, 'utf8');
      totalRenderedBytes += renderedBytes;
      if (renderedBytes > FORMULA_LIMITS.renderedBytes) {
        issues.push(issue(
          'formula_budget_exceeded',
          FORMULA_BUDGET_MESSAGE,
          equation.node.blockId,
        ));
      }
      if (
        totalExceededAt === undefined &&
        totalRenderedBytes > FORMULA_LIMITS.totalRenderedBytes
      ) {
        totalExceededAt = equation.node.blockId;
      }
      renderedEquations.set(equation.node, renderedHtml);
      if (containsForbiddenTexCommand(equation.source)) {
        issues.push(issue(
          'invalid_equation',
          INVALID_EQUATION_MESSAGE,
          equation.node.blockId,
        ));
      }
    } catch {
      issues.push(issue(
        'invalid_equation',
        INVALID_EQUATION_MESSAGE,
        equation.node.blockId,
      ));
    }
  }
  if (totalExceededAt !== undefined) {
    issues.push(issue(
      'formula_budget_exceeded',
      FORMULA_BUDGET_MESSAGE,
      totalExceededAt,
    ));
  }
  return renderedEquations;
}

function equationHtml(node, renderedHtml) {
  const source = Buffer.from(node.source.normalize('NFKC'), 'utf8')
    .toString('base64url');
  const display = node.display === 'block' ? 'block' : 'inline';
  return `<span class="feishu-equation feishu-equation--${display}" data-feishu-equation-source="${source}">${encodeKatexForMarkdown(renderedHtml)}</span>`;
}

function unsupportedKind(kind) {
  throw new Error(
    `Task 6 partial serializer does not support semantic kind: ${String(kind)}`,
  );
}

function serializeInline(node, renderedEquations) {
  if (node.kind === 'text') return node.value;
  if (node.kind === 'equation') {
    return equationHtml(node, renderedEquations.get(node));
  }
  return unsupportedKind(node.kind);
}

function serializeBlock(node, renderedEquations) {
  if (node.kind !== 'paragraph') return unsupportedKind(node.kind);
  return node.inlines.map((inline) =>
    serializeInline(inline, renderedEquations)).join('');
}

function serializeDocument(document, renderedEquations) {
  if (document.kind !== 'document') return unsupportedKind(document.kind);
  return {
    markdown: document.children.map((child) =>
      serializeBlock(child, renderedEquations)).join('\n\n'),
    mediaTokens: [],
    mediaReferences: [],
    warnings: [...document.warnings],
  };
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
