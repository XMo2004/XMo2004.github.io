export type FeishuMarkupMode = 'markdown' | 'controlled-document';

export type FeishuCodeKind =
  | 'markdown-fence'
  | 'markdown-code-span'
  | 'html-pre'
  | 'html-code';

export interface FeishuCodeRegion {
  kind: FeishuCodeKind;
  raw: string;
  content: string;
}

export interface FeishuEquationRegion {
  raw: string;
  source: string;
  display: 'inline' | 'block';
}

export interface FeishuSearchUiRegion {
  raw: string;
}

export interface ArticleHeading {
  depth: number;
  slug: string;
  text: string;
}

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

interface HtmlAttribute {
  name: string;
  value: string | undefined;
}

interface HtmlTagToken {
  kind: 'open' | 'close';
  start: number;
  end: number;
  raw: string;
  name: string;
  sourceName: string;
  attributes: HtmlAttribute[];
  selfClosing: boolean;
}

interface HtmlCommentToken {
  kind: 'comment';
  start: number;
  end: number;
  raw: string;
}

type HtmlToken = HtmlTagToken | HtmlCommentToken;

interface Replacement {
  start: number;
  end: number;
  value: string;
}

interface ElementRegion {
  end: number;
  raw: string;
  text: string;
}

const CONTROLLED_ROOT = '<div class="feishu-document">';

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const MALFORMED_PROTOCOL_TRACE = /(?:data-feishu-(?:equation|heading|search)|(?:class|id)\s*=\s*["']?[^>\n]*feishu-(?:document|equation|heading|source-synced__label))/iu;

function invalidMarkup(detail?: string): never {
  const suffix = detail === undefined ? '' : ` ${detail}`;
  throw new Error(`Invalid controlled Feishu markup.${suffix}`);
}

export function decodeFeishuHtmlEntities(value: string): string {
  const namedEntities: Readonly<Record<string, string>> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu,
    (
      entity,
      decimal: string | undefined,
      hexadecimal: string | undefined,
      name: string | undefined,
    ) => {
      const codePoint = decimal === undefined
        ? hexadecimal === undefined
          ? undefined
          : Number.parseInt(hexadecimal, 16)
        : Number.parseInt(decimal, 10);

      if (codePoint !== undefined) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return entity;
        }
      }

      return namedEntities[name?.toLocaleLowerCase('en-US') ?? ''] ?? entity;
    },
  );
}

function findTagEnd(source: string, start: number): number {
  let quote: '"' | "'" | undefined;

  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }

  return -1;
}

function parseTag(source: string, start: number): HtmlToken | undefined {
  if (source[start] !== '<') return undefined;
  if (source.startsWith('<!--', start)) {
    const close = source.indexOf('-->', start + 4);
    if (close === -1) return undefined;
    const end = close + 3;
    return { kind: 'comment', start, end, raw: source.slice(start, end) };
  }

  const tagEnd = findTagEnd(source, start);
  if (tagEnd === -1) return undefined;
  const raw = source.slice(start, tagEnd + 1);
  let cursor = start + 1;
  let closing = false;
  if (source[cursor] === '/') {
    closing = true;
    cursor += 1;
  }
  while (/\s/u.test(source[cursor] ?? '')) cursor += 1;

  const nameStart = cursor;
  if (!/[a-z]/iu.test(source[cursor] ?? '')) return undefined;
  cursor += 1;
  while (/[a-z0-9:-]/iu.test(source[cursor] ?? '')) cursor += 1;
  const sourceName = source.slice(nameStart, cursor);
  const name = sourceName.toLocaleLowerCase('en-US');

  if (closing) {
    while (/\s/u.test(source[cursor] ?? '')) cursor += 1;
    if (cursor !== tagEnd) return undefined;
    return {
      kind: 'close', start, end: tagEnd + 1, raw, name, sourceName,
      attributes: [], selfClosing: false,
    };
  }

  const attributes: HtmlAttribute[] = [];
  let selfClosing = false;
  while (cursor < tagEnd) {
    while (/\s/u.test(source[cursor] ?? '')) cursor += 1;
    if (cursor >= tagEnd) break;
    if (source[cursor] === '/') {
      cursor += 1;
      while (/\s/u.test(source[cursor] ?? '')) cursor += 1;
      if (cursor !== tagEnd) return undefined;
      selfClosing = true;
      break;
    }

    const attributeStart = cursor;
    while (
      cursor < tagEnd &&
      !/[\s=/'"<>]/u.test(source[cursor])
    ) {
      cursor += 1;
    }
    if (cursor === attributeStart) return undefined;
    const attributeName = source.slice(attributeStart, cursor);
    while (/\s/u.test(source[cursor] ?? '')) cursor += 1;

    let value: string | undefined;
    if (source[cursor] === '=') {
      cursor += 1;
      while (/\s/u.test(source[cursor] ?? '')) cursor += 1;
      const quote = source[cursor];
      if (quote === '"' || quote === "'") {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < tagEnd && source[cursor] !== quote) cursor += 1;
        if (cursor >= tagEnd) return undefined;
        value = source.slice(valueStart, cursor);
        cursor += 1;
      } else {
        const valueStart = cursor;
        while (cursor < tagEnd && !/\s/u.test(source[cursor])) cursor += 1;
        if (cursor === valueStart) return undefined;
        value = source.slice(valueStart, cursor);
      }
    }
    attributes.push({ name: attributeName, value });
  }

  return {
    kind: 'open', start, end: tagEnd + 1, raw, name, sourceName,
    attributes, selfClosing,
  };
}

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
  let binary: string;
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

function hasExactAttributes(token: HtmlTagToken, names: readonly string[]): boolean {
  if (token.attributes.length !== names.length) return false;
  const actual = token.attributes.map(({ name }) => name).sort();
  return actual.every((name, index) => name === [...names].sort()[index]);
}

function attribute(token: HtmlTagToken, name: string): string | undefined {
  return token.attributes.find((item) => item.name === name)?.value;
}

function findElementRegion(
  source: string,
  opening: HtmlTagToken,
  collectText: boolean,
): ElementRegion {
  if (opening.kind !== 'open' || opening.selfClosing || VOID_TAGS.has(opening.name)) {
    invalidMarkup();
  }
  const stack = [opening.name];
  const visible: string[] = [];
  let index = opening.end;

  while (index < source.length) {
    const nextTag = source.indexOf('<', index);
    if (nextTag === -1) invalidMarkup();
    if (collectText && nextTag > index) visible.push(source.slice(index, nextTag));
    const token = parseTag(source, nextTag);
    if (token === undefined) invalidMarkup();
    if (token.kind === 'comment') {
      index = token.end;
      continue;
    }
    if (token.kind === 'close') {
      if (stack.at(-1) !== token.name) invalidMarkup();
      stack.pop();
      if (stack.length === 0) {
        return {
          end: token.end,
          raw: source.slice(opening.start, token.end),
          text: visible.join(''),
        };
      }
    } else if (!token.selfClosing && !VOID_TAGS.has(token.name)) {
      stack.push(token.name);
    }
    index = token.end;
  }

  invalidMarkup();
}

function applyReplacement(
  replacements: Replacement[],
  start: number,
  end: number,
  value: string | undefined,
): void {
  if (value !== undefined) replacements.push({ start, end, value });
}

function renderReplacements(source: string, replacements: Replacement[]): string {
  if (replacements.length === 0) return source;
  let result = '';
  let index = 0;
  for (const replacement of replacements) {
    if (replacement.start < index) invalidMarkup();
    result += source.slice(index, replacement.start);
    result += replacement.value;
    index = replacement.end;
  }
  return result + source.slice(index);
}

function protocolKind(token: HtmlTagToken): 'equation' | 'heading' | 'ui' | 'root' | undefined {
  const classValues = token.attributes
    .filter(({ name }) => name.toLocaleLowerCase('en-US') === 'class')
    .map(({ value }) => value ?? '');
  const idValues = token.attributes
    .filter(({ name }) => name.toLocaleLowerCase('en-US') === 'id')
    .map(({ value }) => value ?? '');
  const attributeNames = token.attributes
    .map(({ name }) => name.toLocaleLowerCase('en-US'));

  if (
    attributeNames.some((name) => name.startsWith('data-feishu-equation')) ||
    classValues.some((value) => value.split(/\s+/u).some(
      (className) => className.toLocaleLowerCase('en-US').startsWith('feishu-equation'),
    ))
  ) return 'equation';
  if (
    attributeNames.some((name) => name.startsWith('data-feishu-heading')) ||
    idValues.some((value) => /^feishu-heading(?:-|$)/iu.test(value))
  ) return 'heading';
  if (
    attributeNames.some((name) => name.startsWith('data-feishu-search')) ||
    classValues.some((value) => value.split(/\s+/u).some(
      (className) => className.toLocaleLowerCase('en-US').startsWith('feishu-source-synced__label'),
    ))
  ) return 'ui';
  if (
    classValues.some((value) => value.split(/\s+/u).some(
      (className) => className.toLocaleLowerCase('en-US').startsWith('feishu-document'),
    ))
  ) return 'root';
  return undefined;
}

function processEquation(
  source: string,
  token: HtmlTagToken,
  handlers: FeishuMarkupHandlers,
  replacements: Replacement[],
): number {
  if (
    token.kind !== 'open' || token.sourceName !== 'span' || token.selfClosing ||
    !hasExactAttributes(token, ['class', 'data-feishu-equation-source'])
  ) {
    invalidMarkup();
  }
  const className = attribute(token, 'class');
  const classMatch = /^feishu-equation feishu-equation--(inline|block)$/u.exec(className ?? '');
  const encodedSource = attribute(token, 'data-feishu-equation-source');
  if (classMatch === null || encodedSource === undefined) invalidMarkup();

  let decoded: string;
  try {
    decoded = decodeBase64Url(encodedSource, 'equation source');
  } catch (error) {
    invalidMarkup(error instanceof Error ? error.message : undefined);
  }
  const region = findElementRegion(source, token, false);
  const equationRegion: FeishuEquationRegion = {
    raw: region.raw,
    source: decoded,
    display: classMatch[1] as 'inline' | 'block',
  };
  applyReplacement(
    replacements,
    token.start,
    region.end,
    handlers.equation?.(equationRegion),
  );
  return region.end;
}

function processUi(
  source: string,
  token: HtmlTagToken,
  handlers: FeishuMarkupHandlers,
  replacements: Replacement[],
): number {
  if (
    token.kind !== 'open' || token.sourceName !== 'span' || token.selfClosing ||
    !hasExactAttributes(token, ['class', 'data-feishu-search-ui']) ||
    attribute(token, 'class') !== 'feishu-source-synced__label' ||
    attribute(token, 'data-feishu-search-ui') !== undefined
  ) {
    invalidMarkup();
  }
  const region = findElementRegion(source, token, false);
  applyReplacement(
    replacements,
    token.start,
    region.end,
    handlers.searchUi?.({ raw: region.raw }),
  );
  return region.end;
}

function processHtmlCode(
  source: string,
  token: HtmlTagToken,
  handlers: FeishuMarkupHandlers,
  replacements: Replacement[],
): number {
  const region = findElementRegion(source, token, true);
  const kind: FeishuCodeKind = token.name === 'pre' ? 'html-pre' : 'html-code';
  const codeRegion: FeishuCodeRegion = {
    kind,
    raw: region.raw,
    content: decodeFeishuHtmlEntities(region.text),
  };
  applyReplacement(
    replacements,
    token.start,
    region.end,
    handlers.code?.(codeRegion),
  );
  return region.end;
}

function processHeading(
  token: HtmlTagToken,
  expectedIndex: number,
): ArticleHeading {
  const match = /^h([1-6])$/u.exec(token.sourceName);
  if (
    token.kind !== 'open' || token.selfClosing || match === null ||
    !hasExactAttributes(token, ['data-feishu-heading-text', 'id'])
  ) {
    invalidMarkup();
  }
  const slug = attribute(token, 'id');
  const encodedText = attribute(token, 'data-feishu-heading-text');
  if (slug !== `feishu-heading-${expectedIndex}` || encodedText === undefined) {
    invalidMarkup();
  }
  let text: string;
  try {
    text = decodeBase64Url(encodedText, 'heading text', { allowEmpty: true });
  } catch (error) {
    invalidMarkup(error instanceof Error ? error.message : undefined);
  }
  return { depth: Number(match[1]), slug, text };
}

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function lineEnd(source: string, start: number): number {
  const end = source.indexOf('\n', start);
  return end === -1 ? source.length : end;
}

function markdownFenceAt(
  source: string,
  start: number,
): { end: number; content: string } | undefined {
  if (start !== 0 && source[start - 1] !== '\n') return undefined;
  const openerEnd = lineEnd(source, start);
  const openerLine = source.slice(start, openerEnd).replace(/\r$/u, '');
  const match = /^[ \t]{0,3}(`{3,}|~{3,})/u.exec(openerLine);
  if (match === null) return undefined;
  const delimiter = match[1];
  if (delimiter[0] === '`' && openerLine.slice(match[0].length).includes('`')) {
    return undefined;
  }
  const contentStart = openerEnd < source.length ? openerEnd + 1 : openerEnd;
  let current = contentStart;
  while (current < source.length) {
    const currentEnd = lineEnd(source, current);
    const currentLine = source.slice(current, currentEnd).replace(/\r$/u, '');
    const closeMatch = /^[ \t]{0,3}(`+|~+)[ \t]*$/u.exec(currentLine);
    if (
      closeMatch !== null && closeMatch[1][0] === delimiter[0] &&
      closeMatch[1].length >= delimiter.length
    ) {
      return {
        end: currentEnd < source.length ? currentEnd + 1 : currentEnd,
        content: source.slice(contentStart, current),
      };
    }
    if (currentEnd === source.length) break;
    current = currentEnd + 1;
  }
  return { end: source.length, content: source.slice(contentStart) };
}

function markdownCodeSpanAt(
  source: string,
  start: number,
  runsByLength: ReadonlyMap<number, readonly number[]>,
  runPointers: Map<number, number>,
): { end: number; content: string } | undefined {
  if (source[start] !== '`' || isEscaped(source, start)) return undefined;
  let openerEnd = start;
  while (source[openerEnd] === '`') openerEnd += 1;
  const length = openerEnd - start;
  const runs = runsByLength.get(length);
  if (runs === undefined) return undefined;
  let pointer = runPointers.get(length) ?? 0;
  while (runs[pointer] !== undefined && runs[pointer] < start) pointer += 1;
  runPointers.set(length, pointer);
  if (runs[pointer] !== start || runs[pointer + 1] === undefined) return undefined;
  const closingStart = runs[pointer + 1];
  return {
    end: closingStart + length,
    content: source.slice(openerEnd, closingStart),
  };
}

function collectBacktickRuns(source: string): ReadonlyMap<number, readonly number[]> {
  const runs = new Map<number, number[]>();
  let index = 0;
  while (index < source.length) {
    if (source[index] !== '`') {
      index += 1;
      continue;
    }
    const start = index;
    while (source[index] === '`') index += 1;
    const length = index - start;
    const positions = runs.get(length) ?? [];
    positions.push(start);
    runs.set(length, positions);
  }
  return runs;
}

function scanMarkdown(
  source: string,
  handlers: FeishuMarkupHandlers,
): FeishuMarkupResult {
  const replacements: Replacement[] = [];
  const backtickRuns = collectBacktickRuns(source);
  const backtickRunPointers = new Map<number, number>();
  let index = 0;

  while (index < source.length) {
    const fence = markdownFenceAt(source, index);
    if (fence !== undefined) {
      const region: FeishuCodeRegion = {
        kind: 'markdown-fence',
        raw: source.slice(index, fence.end),
        content: fence.content,
      };
      applyReplacement(replacements, index, fence.end, handlers.code?.(region));
      index = fence.end;
      continue;
    }

    if (source[index] === '`') {
      const codeSpan = markdownCodeSpanAt(
        source,
        index,
        backtickRuns,
        backtickRunPointers,
      );
      if (codeSpan !== undefined) {
        const region: FeishuCodeRegion = {
          kind: 'markdown-code-span',
          raw: source.slice(index, codeSpan.end),
          content: codeSpan.content,
        };
        applyReplacement(replacements, index, codeSpan.end, handlers.code?.(region));
        index = codeSpan.end;
        continue;
      }
      while (source[index] === '`') index += 1;
      continue;
    }

    if (source[index] !== '<') {
      index += 1;
      continue;
    }
    const token = parseTag(source, index);
    if (token === undefined) {
      const boundary = source.indexOf('\n', index);
      const suspect = source.slice(index, boundary === -1 ? source.length : boundary);
      if (MALFORMED_PROTOCOL_TRACE.test(suspect)) invalidMarkup();
      index += 1;
      continue;
    }
    if (token.kind === 'comment') {
      index = token.end;
      continue;
    }
    if (token.kind === 'close') {
      if (protocolKind(token) !== undefined) invalidMarkup();
      index = token.end;
      continue;
    }
    if ((token.name === 'pre' || token.name === 'code') && protocolKind(token) === undefined) {
      index = processHtmlCode(source, token, handlers, replacements);
      continue;
    }
    const kind = protocolKind(token);
    if (kind === 'equation') {
      index = processEquation(source, token, handlers, replacements);
      continue;
    }
    if (kind !== undefined) invalidMarkup();
    index = token.end;
  }

  return {
    value: renderReplacements(source, replacements),
    mode: 'markdown',
    headings: undefined,
  };
}

function scanControlled(
  source: string,
  rootStart: number,
  handlers: FeishuMarkupHandlers,
): FeishuMarkupResult {
  const replacements: Replacement[] = [];
  const headings: ArticleHeading[] = [];
  const stack = ['div'];
  let index = rootStart + CONTROLLED_ROOT.length;
  let closedRoot = false;

  while (index < source.length) {
    const nextTag = source.indexOf('<', index);
    if (nextTag === -1) invalidMarkup();
    index = nextTag;
    const token = parseTag(source, index);
    if (token === undefined) invalidMarkup();
    if (token.kind === 'comment') {
      index = token.end;
      continue;
    }
    if (token.kind === 'close') {
      if (stack.at(-1) !== token.name) invalidMarkup();
      stack.pop();
      index = token.end;
      if (stack.length === 0) {
        closedRoot = true;
        if (/\S/u.test(source.slice(index))) invalidMarkup();
        break;
      }
      continue;
    }

    if ((token.name === 'pre' || token.name === 'code') && protocolKind(token) === undefined) {
      index = processHtmlCode(source, token, handlers, replacements);
      continue;
    }
    const kind = protocolKind(token);
    if (kind === 'equation') {
      index = processEquation(source, token, handlers, replacements);
      continue;
    }
    if (kind === 'ui') {
      index = processUi(source, token, handlers, replacements);
      continue;
    }
    if (kind === 'heading') {
      headings.push(processHeading(token, headings.length + 1));
    } else if (kind !== undefined) {
      invalidMarkup();
    }

    if (!token.selfClosing && !VOID_TAGS.has(token.name)) stack.push(token.name);
    index = token.end;
  }

  if (!closedRoot) invalidMarkup();
  return {
    value: renderReplacements(source, replacements),
    mode: 'controlled-document',
    headings,
  };
}

export function transformFeishuMarkup(
  source: string,
  handlers: FeishuMarkupHandlers = {},
): FeishuMarkupResult {
  const firstContent = source.search(/\S/u);
  if (
    firstContent !== -1 &&
    source.startsWith(CONTROLLED_ROOT, firstContent)
  ) {
    return scanControlled(source, firstContent, handlers);
  }
  return scanMarkdown(source, handlers);
}
