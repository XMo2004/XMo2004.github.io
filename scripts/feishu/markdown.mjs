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

function encodeMarkdownEmbeddedText(value, { htmlText = false } = {}) {
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
    if (htmlText && character === '&') {
      encoded += '&amp;';
    } else if (htmlText && character === '<') {
      encoded += '&lt;';
    } else if (htmlText && character === '>') {
      encoded += '&gt;';
    } else if (htmlText && character === '"') {
      encoded += '&quot;';
    } else if (character === '\r') {
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

function unsupportedKind(kind) {
  throw new Error(`Unsupported Feishu semantic kind: ${String(kind)}`);
}

function collectEquations(document) {
  if (document.kind !== 'document') unsupportedKind(document.kind);
  const equations = [];

  const visitInlines = (inlines) => {
    for (const inline of inlines) {
      if (inline.kind === 'equation') {
        equations.push(inline);
      } else if (inline.kind !== 'text') {
        unsupportedKind(inline.kind);
      }
    }
  };

  const visitBlocks = (blocks) => {
    for (const block of blocks) {
      switch (block.kind) {
        case 'paragraph':
        case 'heading':
        case 'quote':
          visitInlines(block.inlines);
          break;
        case 'listItem':
          visitInlines(block.inlines);
          visitBlocks(block.children);
          break;
        case 'callout':
          visitBlocks(block.children);
          break;
        case 'sourceSynced':
          visitInlines(block.title);
          visitBlocks(block.children);
          break;
        case 'table':
          for (const row of block.rows) {
            for (const cell of row) {
              for (const cellBlockInlines of cell) {
                visitInlines(cellBlockInlines);
              }
            }
          }
          break;
        case 'code':
        case 'divider':
        case 'image':
          break;
        default:
          unsupportedKind(block.kind);
      }
    }
  };

  visitBlocks(document.children);
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
      renderedEquations.set(equation.node, {
        source: equation.source,
        html: renderedHtml,
      });
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

function equationHtml(node, renderedEquation) {
  const source = Buffer.from(renderedEquation.source, 'utf8')
    .toString('base64url');
  const display = node.display === 'block' ? 'block' : 'inline';
  return `<span class="feishu-equation feishu-equation--${display}" data-feishu-equation-source="${source}">${encodeKatexForMarkdown(renderedEquation.html)}</span>`;
}

function escapeControlledMarkdownText(value) {
  return encodeMarkdownEmbeddedText(value, { htmlText: true });
}

function escapeHtmlText(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttribute(value) {
  return escapeHtmlText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeControlledHref(value, { markdownTableCell = false } = {}) {
  let escaped = escapeHtmlAttribute(value);
  if (markdownTableCell) {
    escaped = escaped
      .replace(/\|/g, '&#124;')
      .replace(/\r/g, '&#13;')
      .replace(/\n/g, '&#10;');
  }
  return escaped;
}

function requiresControlledInline(node, forceControlled) {
  return (
    forceControlled ||
    node.kind === 'equation' ||
    node.style.underline ||
    node.style.textColor !== null ||
    node.style.backgroundColor !== null
  );
}

function serializeControlledInline(
  node,
  renderedEquations,
  context,
) {
  if (node.kind === 'text' && /^\s*$/.test(node.value)) return node.value;
  if (!['text', 'equation'].includes(node.kind)) unsupportedKind(node.kind);

  const style = node.style;
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
    style.backgroundColor &&
      `feishu-text-background--${style.backgroundColor}`,
  ].filter(Boolean).join(' ');
  if (colorClasses) value = `<span class="${colorClasses}">${value}</span>`;
  if (style.href) {
    value = `<a class="feishu-link" href="${escapeControlledHref(style.href, context)}">${value}</a>`;
  }
  return value;
}

function escapeMarkdown(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([!"#$%&'()*+,\-./:;<=>?@\[\]^_`{|}~])/g, '\\$1');
}

function maxBacktickRun(value) {
  return Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
}

function inlineCode(value) {
  if (value.length === 0 || /^\s+$/.test(value)) return value;
  const fence = '`'.repeat(Math.max(1, maxBacktickRun(value) + 1));
  const padding = /^\s|\s$|^`|`$/.test(value) ? ' ' : '';
  return `${fence}${padding}${value}${padding}${fence}`;
}

function tableInlineCode(value) {
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/\\/g, '&#92;')
    .replace(/\|/g, '&#124;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<code>${escaped}</code>`;
}

function protectLeadingIndentation(value) {
  return value.replace(/^[ \t]+/gm, (indentation) => {
    if (!indentation.includes('\t') && indentation.length < 4) {
      return indentation;
    }
    return [...indentation]
      .map((character) => character === '\t' ? '&nbsp;'.repeat(4) : '&nbsp;')
      .join('');
  });
}

function escapeTablePipes(value) {
  let escaped = '';
  let precedingBackslashes = 0;
  for (const character of value) {
    if (character === '\\') {
      escaped += character;
      precedingBackslashes += 1;
      continue;
    }
    if (character === '|' && precedingBackslashes % 2 === 0) escaped += '\\';
    escaped += character;
    precedingBackslashes = 0;
  }
  return escaped;
}

function codeFence(value) {
  return '`'.repeat(Math.max(3, maxBacktickRun(value) + 1));
}

function indentBlock(value, indentation) {
  return indentation.length === 0
    ? value
    : value.split('\n').map((line) => `${indentation}${line}`).join('\n');
}

function serializeMarkdownInline(node, renderedEquations, context) {
  if (requiresControlledInline(node, false)) {
    return serializeControlledInline(node, renderedEquations, context);
  }
  if (node.kind !== 'text') unsupportedKind(node.kind);
  if (/^\s*$/.test(node.value)) return node.value;

  const style = node.style;
  let value = style.inlineCode
    ? context.markdownTableCell
      ? tableInlineCode(node.value)
      : inlineCode(node.value)
    : escapeMarkdown(node.value);
  if (style.bold) value = `**${value}**`;
  if (style.italic) value = `*${value}*`;
  if (style.strikethrough) value = `~~${value}~~`;
  if (style.href) value = `[${value}](${style.href})`;
  return value;
}

function serializeInlines(
  inlines,
  renderedEquations,
  { forceControlled = false, markdownTableCell = false } = {},
) {
  const context = { markdownTableCell };
  const value = inlines.map((inline) =>
    forceControlled || requiresControlledInline(inline, false)
      ? serializeControlledInline(inline, renderedEquations, context)
      : serializeMarkdownInline(inline, renderedEquations, context)).join('');
  return forceControlled ? value : protectLeadingIndentation(value);
}

function createMediaRegistry() {
  const mediaTokens = [];
  const mediaReferences = [];
  const seen = new Set();
  const register = (token) => {
    const placeholder = `\uE000feishu-media:${token}\uE001`;
    if (!seen.has(token)) {
      seen.add(token);
      mediaTokens.push(token);
      mediaReferences.push({ token, placeholder });
    }
    return placeholder;
  };
  return { mediaTokens, mediaReferences, register };
}

function serializeMarkdownDocument(document, renderedEquations, media) {
  const renderBlock = (block, indentation = '') => {
    if (block.kind === 'heading') {
      return indentBlock(
        `${'#'.repeat(block.depth)} ${serializeInlines(block.inlines, renderedEquations)}`,
        indentation,
      );
    }
    switch (block.kind) {
      case 'paragraph':
        return indentBlock(
          serializeInlines(block.inlines, renderedEquations),
          indentation,
        );
      case 'listItem': {
        const marker = block.listKind === 'bullet'
          ? '-'
          : block.listKind === 'ordered'
            ? '1.'
            : block.checked
              ? '- [x]'
              : '- [ ]';
        const line = `${indentation}${marker} ${serializeInlines(block.inlines, renderedEquations)}`;
        const markerWidth = block.listKind === 'ordered' ? 3 : 2;
        const childIndentation = `${indentation}${' '.repeat(markerWidth)}`;
        const children = block.children.map((child) =>
          renderBlock(child, childIndentation));
        return [line, ...children].filter(Boolean).join('\n');
      }
      case 'code': {
        const fence = codeFence(block.value);
        const beforeClosingFence = block.value.endsWith('\n') ? '' : '\n';
        return indentBlock(
          `${fence}${block.language}\n${block.value}${beforeClosingFence}${fence}`,
          indentation,
        );
      }
      case 'quote':
        return indentBlock(
          serializeInlines(block.inlines, renderedEquations)
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n'),
          indentation,
        );
      case 'divider':
        return indentBlock('---', indentation);
      case 'image':
        return indentBlock(`![图片](${media.register(block.token)})`, indentation);
      case 'table': {
        const rows = block.rows.map((row) => row.map((cell) =>
          escapeTablePipes(cell.map((cellBlockInlines) =>
            serializeInlines(cellBlockInlines, renderedEquations, {
              markdownTableCell: true,
            }).replace(/\r\n?|\n/g, '<br>')).join('<br>'))));
        const columnSize = rows[0]?.length ?? 0;
        if (columnSize === 0) return '';
        return indentBlock([
          `| ${rows[0].join(' | ')} |`,
          `| ${Array.from({ length: columnSize }, () => '---').join(' | ')} |`,
          ...rows.slice(1).map((row) => `| ${row.join(' | ')} |`),
        ].join('\n'), indentation);
      }
      case 'callout':
      case 'sourceSynced':
        throw new Error('Controlled container reached Markdown serializer.');
      default:
        return unsupportedKind(block.kind);
    }
  };

  return document.children.map((block) => renderBlock(block))
    .filter(Boolean)
    .join('\n\n');
}

function serializeControlledDocument(document, renderedEquations, media) {
  let headingIndex = 0;

  const renderInlines = (inlines) => serializeInlines(
    inlines,
    renderedEquations,
    { forceControlled: true },
  );

  const renderChildren = (children) => {
    const parts = [];
    for (let index = 0; index < children.length;) {
      const child = children[index];
      if (child.kind !== 'listItem') {
        parts.push(renderBlock(child));
        index += 1;
        continue;
      }
      const items = [];
      const listKind = child.listKind;
      while (
        index < children.length &&
        children[index].kind === 'listItem' &&
        children[index].listKind === listKind
      ) {
        items.push(children[index]);
        index += 1;
      }
      parts.push(renderList(items, listKind));
    }
    return parts.join('\n');
  };

  const renderList = (items, listKind) => {
    const tag = listKind === 'ordered' ? 'ol' : 'ul';
    const className = listKind === 'todo' ? ' class="feishu-task-list"' : '';
    const body = items.map((item) => {
      const marker = listKind === 'todo'
        ? `<span class="feishu-task-list__marker" aria-hidden="true">${item.checked ? '☑' : '☐'}</span><span class="visually-hidden">${item.checked ? '已完成：' : '未完成：'}</span>`
        : '';
      const children = renderChildren(item.children);
      return `<li>${marker}${renderInlines(item.inlines)}${children ? `\n${children}` : ''}</li>`;
    }).join('\n');
    return `<${tag}${className}>\n${body}\n</${tag}>`;
  };

  const renderTableCell = (cell) => cell
    .map((cellBlockInlines) => renderInlines(cellBlockInlines))
    .join('<br>');

  const renderBlock = (block) => {
    switch (block.kind) {
      case 'paragraph':
        return `<p>${renderInlines(block.inlines)}</p>`;
      case 'heading': {
        headingIndex += 1;
        const visibleText = block.inlines.map((inline) =>
          inline.kind === 'equation'
            ? renderedEquations.get(inline).source
            : inline.value).join('').replace(/\s+/gu, ' ').trim();
        const encodedText = Buffer.from(visibleText, 'utf8').toString('base64url');
        return `<h${block.depth} id="feishu-heading-${headingIndex}" data-feishu-heading-text="${encodedText}">${renderInlines(block.inlines)}</h${block.depth}>`;
      }
      case 'listItem':
        return renderList([block], block.listKind);
      case 'quote':
        return `<blockquote>${renderInlines(block.inlines)}</blockquote>`;
      case 'code':
        return `<pre><code class="language-${escapeHtmlAttribute(block.language)}">${escapeHtmlText(block.value)}</code></pre>`;
      case 'divider':
        return '<hr>';
      case 'image':
        return `<img src="${escapeHtmlAttribute(media.register(block.token))}" alt="图片">`;
      case 'table': {
        if (block.rows.length === 0) return '<table></table>';
        const renderRow = (row, cellTag) => `<tr>${row.map((cell) =>
          `<${cellTag}>${renderTableCell(cell)}</${cellTag}>`).join('')}</tr>`;
        const head = `<thead>${renderRow(block.rows[0], 'th')}</thead>`;
        const body = block.rows.length > 1
          ? `<tbody>${block.rows.slice(1).map((row) => renderRow(row, 'td')).join('')}</tbody>`
          : '';
        return `<table>${head}${body}</table>`;
      }
      case 'callout': {
        const classes = [
          'feishu-callout',
          block.background && `feishu-callout--background-${block.background}`,
          block.border && `feishu-callout--border-${block.border}`,
          block.textColor && `feishu-callout--text-${block.textColor}`,
        ].filter(Boolean).join(' ');
        const content = renderChildren(block.children);
        return `<aside class="${classes}">\n<span class="feishu-callout__emoji" aria-hidden="true">${escapeHtmlText(block.emoji)}</span>\n<div class="feishu-callout__content">${content}</div>\n</aside>`;
      }
      case 'sourceSynced': {
        const renderedTitle = renderInlines(block.title);
        const title = /\S/u.test(renderedTitle)
          ? `\n<div class="feishu-source-synced__title feishu-source-synced__title--align-${block.align}">${renderedTitle}</div>`
          : '';
        const childContent = renderChildren(block.children);
        const content = childContent
          ? `\n<div class="feishu-source-synced__content">${childContent}</div>`
          : '';
        return `<section class="feishu-source-synced">\n<span class="feishu-source-synced__label" data-feishu-search-ui>↻ 同步内容</span>${title}${content}\n</section>`;
      }
      default:
        return unsupportedKind(block.kind);
    }
  };

  const content = renderChildren(document.children);
  return content ? `<div class="feishu-document">\n${content}\n</div>` : '';
}

function serializeDocument(document, renderedEquations) {
  if (document.kind !== 'document') return unsupportedKind(document.kind);
  const media = createMediaRegistry();
  const body = document.mode === 'controlled-document'
    ? serializeControlledDocument(document, renderedEquations, media)
    : serializeMarkdownDocument(document, renderedEquations, media);
  const markdown = body.length === 0 ? '' : `${body.replace(/\n+$/u, '')}\n`;
  return {
    markdown,
    mediaTokens: media.mediaTokens,
    mediaReferences: media.mediaReferences,
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
