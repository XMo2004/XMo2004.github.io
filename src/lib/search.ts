import { estimateReadingMinutes, getPostHref } from './posts.ts';
import {
  decodeFeishuHtmlEntities,
  transformFeishuMarkup,
} from './feishu-markup.ts';

const MAX_SEARCH_TEXT_LENGTH = 12_000;
const URL_SCHEMES = ['https://', 'http://', 'mailto:'] as const;
const URL_TERMINATORS = new Set([
  '<',
  '>',
  '"',
  "'",
  '`',
  '，',
  '。',
  '！',
  '？',
  '；',
  '：',
  '、',
]);

const PRESERVATION_MARKER_RANGE = [0xe000, 0xf8ff] as const;

const SEARCH_WEIGHTS = {
  titleExact: 120,
  titlePrefix: 80,
  titleContains: 60,
  taxonomy: 35,
  description: 15,
  body: 5,
} as const;

export interface SearchSourcePost {
  id: string;
  filePath?: string;
  body?: string;
  data: {
    slug?: string;
    title: string;
    description: string;
    pubDate: Date;
    category: string;
    column?: string;
    columnOrder?: number;
    tags: readonly string[];
  };
}

export interface SearchEntry {
  href: string;
  title: string;
  description: string;
  pubDate: string;
  category: string;
  column?: string;
  columnOrder?: number;
  tags: string[];
  readingMinutes: number;
  searchText: string;
}

interface ScoredSearchEntry {
  entry: SearchEntry;
  score: number;
}

function getUrlSchemeLength(value: string, start: number): number {
  for (const scheme of URL_SCHEMES) {
    if (value.slice(start, start + scheme.length).toLowerCase() === scheme) {
      return scheme.length;
    }
  }

  return 0;
}

function findBareUrlEnd(
  value: string,
  start: number,
  schemeLength: number,
  preservationMarker: string,
  preservedSegmentCount: number,
): number {
  let parenthesisDepth = 0;
  let index = start + schemeLength;

  while (index < value.length) {
    const character = value[index];

    if (
      /\s/u.test(character) ||
      URL_TERMINATORS.has(character) ||
      isPreservationTokenAt(
        value,
        index,
        preservationMarker,
        preservedSegmentCount,
      )
    ) {
      break;
    }

    if (character === '(') {
      parenthesisDepth += 1;
    } else if (character === ')') {
      if (parenthesisDepth === 0) {
        break;
      }

      parenthesisDepth -= 1;
    }

    index += 1;
  }

  return index;
}

function isPreservationTokenAt(
  value: string,
  start: number,
  marker: string,
  preservedSegmentCount: number,
): boolean {
  if (!value.startsWith(marker, start)) return false;
  let index = start + marker.length;
  const digitsStart = index;
  while (/[0-9]/u.test(value[index] ?? '')) index += 1;
  if (index === digitsStart || !value.startsWith(marker, index)) return false;
  return preservationTokenIndex(
    value.slice(digitsStart, index),
    preservedSegmentCount,
  ) !== undefined;
}

function preservationTokenIndex(
  digits: string,
  preservedSegmentCount: number,
): number | undefined {
  const index = Number.parseInt(digits, 10);
  return (
    Number.isSafeInteger(index) &&
    index >= 0 &&
    index < preservedSegmentCount &&
    String(index) === digits
  )
    ? index
    : undefined;
}

function removeUrls(
  value: string,
  preservationMarker: string,
  preservedSegmentCount: number,
): string {
  let result = '';
  let index = 0;

  while (index < value.length) {
    if (value[index] === '<') {
      const schemeLength = getUrlSchemeLength(value, index + 1);

      if (schemeLength > 0) {
        const urlEnd = findBareUrlEnd(
          value,
          index + 1,
          schemeLength,
          preservationMarker,
          preservedSegmentCount,
        );

        if (value[urlEnd] === '>') {
          result += ' ';
          index = urlEnd + 1;
          continue;
        }
      }
    }

    const schemeLength = getUrlSchemeLength(value, index);
    const previousCharacter = value[index - 1] ?? '';

    if (schemeLength > 0 && !/[a-z0-9_]/iu.test(previousCharacter)) {
      result += ' ';
      index = findBareUrlEnd(
        value,
        index,
        schemeLength,
        preservationMarker,
        preservedSegmentCount,
      );
      continue;
    }

    result += value[index];
    index += 1;
  }

  return result;
}

function findHtmlTagEnd(value: string, start: number): number {
  let quote: '"' | "'" | undefined;

  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];

    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      }

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

function findClosingRawElement(
  lowerCaseValue: string,
  tagName: string,
  start: number,
): number {
  const closingPrefix = `</${tagName}`;
  let index = lowerCaseValue.indexOf(closingPrefix, start);

  while (index !== -1) {
    const characterAfterName = lowerCaseValue[index + closingPrefix.length];

    if (
      characterAfterName === undefined ||
      /[\s>]/u.test(characterAfterName)
    ) {
      return index;
    }

    index = lowerCaseValue.indexOf(closingPrefix, index + closingPrefix.length);
  }

  return -1;
}

function removeHtmlMarkup(value: string): string {
  const rawElementNames = new Set(['script', 'style', 'template']);
  const phrasingElementNames = new Set([
    'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'data', 'del', 'dfn', 'em', 'i',
    'kbd', 'mark', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span',
    'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
  ]);
  const lowerCaseValue = value.toLowerCase();
  let result = '';
  let index = 0;

  while (index < value.length) {
    if (value.startsWith('<!--', index)) {
      const commentEnd = value.indexOf('-->', index + 4);
      if (commentEnd === -1) {
        result += ' ';
        index = value.length;
        continue;
      }

      const comment = value.slice(index, commentEnd + 3);
      if (comment !== '<!---->') result += ' ';
      index = commentEnd + 3;
      continue;
    }

    if (value[index] !== '<') {
      result += value[index];
      index += 1;
      continue;
    }

    const tagEnd = findHtmlTagEnd(value, index);

    if (tagEnd === -1) {
      result += value[index];
      index += 1;
      continue;
    }

    const tagSource = value.slice(index + 1, tagEnd).trim();
    const tagNameMatch = /^\/?\s*([a-z][a-z0-9:-]*)/iu.exec(tagSource);
    const isDeclaration = tagSource.startsWith('!') || tagSource.startsWith('?');

    if (tagNameMatch === null && !isDeclaration) {
      result += value[index];
      index += 1;
      continue;
    }

    const tagName = tagNameMatch?.[1].toLowerCase();
    const isClosing = tagSource.startsWith('/');
    const isSelfClosing = /\/\s*$/u.test(tagSource);

    if (
      tagName !== undefined &&
      rawElementNames.has(tagName) &&
      !isClosing &&
      !isSelfClosing
    ) {
      const closingStart = findClosingRawElement(
        lowerCaseValue,
        tagName,
        tagEnd + 1,
      );

      if (closingStart === -1) {
        result += ' ';
        break;
      }

      const closingEnd = findHtmlTagEnd(value, closingStart);
      index = closingEnd === -1 ? value.length : closingEnd + 1;
      result += ' ';
      continue;
    }

    if (tagName === undefined || !phrasingElementNames.has(tagName)) {
      result += ' ';
    }
    index = tagEnd + 1;
  }

  return result;
}

function isReferenceTitleLine(line: string): boolean {
  const firstCharacter = line.trimStart()[0];
  return firstCharacter === '"' || firstCharacter === "'" || firstCharacter === '(';
}

function removeReferenceDefinitions(value: string): string {
  const lines = value.split('\n');
  const visibleLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const definition = /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*(.*)$/u.exec(lines[index]);

    if (definition === null) {
      visibleLines.push(lines[index]);
      continue;
    }

    if (
      definition[1].trim() === '' &&
      lines[index + 1] !== undefined &&
      lines[index + 1].trim() !== ''
    ) {
      index += 1;
    }

    while (
      lines[index + 1] !== undefined &&
      lines[index + 1].trim() !== '' &&
      (/^[ \t]+/u.test(lines[index + 1]) ||
        isReferenceTitleLine(lines[index + 1]))
    ) {
      index += 1;
    }

    visibleLines.push('');
  }

  return visibleLines.join('\n');
}

function replaceInlineLinkTargets(markdown: string): string {
  let result = '';
  let index = 0;

  while (index < markdown.length) {
    const isImage = markdown[index] === '!' && markdown[index + 1] === '[';
    const isLink = markdown[index] === '[';

    if (!isImage && !isLink) {
      result += markdown[index];
      index += 1;
      continue;
    }

    const labelStart = index + (isImage ? 2 : 1);
    const labelEnd = findClosingDelimiter(markdown, labelStart, '[', ']');

    if (labelEnd === -1) {
      result += markdown[index];
      index += 1;
      continue;
    }

    let targetStart = labelEnd + 1;

    while (/\s/u.test(markdown[targetStart] ?? '')) {
      targetStart += 1;
    }

    let targetEnd = -1;

    if (markdown[targetStart] === '(') {
      targetEnd = findClosingDelimiter(markdown, targetStart + 1, '(', ')');
    } else if (markdown[targetStart] === '[') {
      targetEnd = findClosingDelimiter(markdown, targetStart + 1, '[', ']');
    }

    if (targetEnd === -1) {
      result += markdown[index];
      index += 1;
      continue;
    }

    const visibleLabel = markdown.slice(labelStart, labelEnd);
    result += ` ${replaceInlineLinkTargets(visibleLabel)} `;
    index = targetEnd + 1;
  }

  return result;
}

function findClosingDelimiter(
  value: string,
  start: number,
  opening: string,
  closing: string,
): number {
  let depth = 1;

  for (let index = start; index < value.length; index += 1) {
    if (value[index] === '\\') {
      index += 1;
      continue;
    }

    if (value[index] === opening) {
      depth += 1;
    } else if (value[index] === closing) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

type PreservedPhase = 'literal' | 'final';

interface PreserveOptions {
  padded?: boolean;
  phase?: PreservedPhase;
}

type PreserveText = (value: string, options?: PreserveOptions) => string;

function isAsciiPunctuation(value: string): boolean {
  if (value.length !== 1) return false;
  const codePoint = value.codePointAt(0) ?? -1;
  return (
    (codePoint >= 0x21 && codePoint <= 0x2f) ||
    (codePoint >= 0x3a && codePoint <= 0x40) ||
    (codePoint >= 0x5b && codePoint <= 0x60) ||
    (codePoint >= 0x7b && codePoint <= 0x7e)
  );
}

function protectLiteralHtmlEntities(
  value: string,
  preserve: PreserveText,
): string {
  return value.replace(
    /&(?:#\d+|#x[\da-f]+|[a-z]+);/giu,
    (entity) => {
      const decoded = decodeFeishuHtmlEntities(entity);
      return decoded !== entity && isAsciiPunctuation(decoded)
        ? preserve(decoded, { padded: false, phase: 'literal' })
        : entity;
    },
  );
}

function normalizeMarkdownCodeSpanContent(content: string): string {
  const singleLineCode = content.replace(/\s*\n\s*/gu, ' ');
  return /^\s[\s\S]*\s$/u.test(singleLineCode) && /\S/u.test(singleLineCode)
    ? singleLineCode.slice(1, -1)
    : singleLineCode;
}

function selectPreservationMarker(normalized: string): string {
  const usedCodePoints = new Set<number>();
  const authorDerivedValues = [
    normalized,
    decodeFeishuHtmlEntities(normalized),
    decodeFeishuHtmlEntities(removeHtmlMarkup(normalized)),
  ];

  for (const value of authorDerivedValues) {
    for (const character of value) {
      const codePoint = character.codePointAt(0);
      if (codePoint !== undefined) usedCodePoints.add(codePoint);
    }
  }

  const [start, end] = PRESERVATION_MARKER_RANGE;
  for (let codePoint = start; codePoint <= end; codePoint += 1) {
    if (!usedCodePoints.has(codePoint)) return String.fromCodePoint(codePoint);
  }

  throw new Error('Search preservation token marker space exhausted.');
}

export function markdownToSearchText(markdown: string): string {
  const preservedSegments: Array<{
    value: string;
    phase: PreservedPhase;
  }> = [];
  const normalized = markdown.normalize('NFKC').replace(/\r\n?/gu, '\n');
  const preservationMarker = selectPreservationMarker(normalized);
  const preserve: PreserveText = (
    value,
    { padded = true, phase = 'final' } = {},
  ) => {
    const token = `${preservationMarker}${preservedSegments.length}${preservationMarker}`;
    preservedSegments.push({ value, phase });
    return padded ? ` ${token} ` : token;
  };

  const transformed = transformFeishuMarkup(normalized, {
    code: ({ kind, content }) => {
      const visibleCode = kind === 'markdown-code-span'
        ? normalizeMarkdownCodeSpanContent(content)
        : content;
      return preserve(removeUrls(
        visibleCode,
        preservationMarker,
        preservedSegments.length,
      ));
    },
    equation: ({ source }) => preserve(source.normalize('NFKC')),
    searchUi: () => ' ',
  });
  let text = transformed.value;
  text = text.replace(
    /\\([\\`*{}[\]()#+\-.!_>~|])/gu,
    (_match, character: string) => preserve(character),
  );
  text = removeUrls(text, preservationMarker, preservedSegments.length);

  text = removeReferenceDefinitions(text);
  text = replaceInlineLinkTargets(text);
  text = removeHtmlMarkup(text);
  text = protectLiteralHtmlEntities(text, preserve);
  text = decodeFeishuHtmlEntities(text);

  text = text.replace(/^[ \t]{0,3}(?:[-*_][ \t]*){3,}$/gmu, ' ');
  text = text.replace(/^[ \t]{0,3}(?:=+|-+)[ \t]*$/gmu, ' ');
  text = text.replace(/^[ \t]{0,3}#{1,6}(?:[ \t]+|$)/gmu, ' ');
  text = text.replace(/[ \t]+#+[ \t]*$/gmu, ' ');
  text = text.replace(/^[ \t]{0,3}(?:>[ \t]?)+/gmu, ' ');
  text = text.replace(/^[ \t]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/gmu, ' ');
  text = text.replace(/^[ \t]*\[[ xX]\][ \t]+/gmu, ' ');
  text = text.replace(/\\[ \t]*(?=\n|$)/gmu, ' ');
  text = text.replace(/[*~]+/gu, '');
  text = text.replace(
    /_+/gu,
    (underscores, offset: number, source: string) => {
      const previousCharacter = source[offset - 1] ?? '';
      const nextCharacter = source[offset + underscores.length] ?? '';
      const isInsideIdentifier =
        /[\p{L}\p{N}]/u.test(previousCharacter) &&
        /[\p{L}\p{N}]/u.test(nextCharacter);

      return isInsideIdentifier ? underscores : '';
    },
  );
  text = text.replace(/[\[\]|]/gu, ' ');

  const restorePhase = (value: string, phase: PreservedPhase): string =>
    value.replaceAll(
      new RegExp(`${preservationMarker}(\\d+)${preservationMarker}`, 'gu'),
      (token, segmentIndex: string) => {
        const index = preservationTokenIndex(
          segmentIndex,
          preservedSegments.length,
        );
        const segment = index === undefined ? undefined : preservedSegments[index];
        return segment?.phase === phase ? segment.value : token;
      },
    );

  text = restorePhase(text, 'literal');
  text = removeUrls(text, preservationMarker, preservedSegments.length);
  text = restorePhase(text, 'final');

  return text.replace(/\s+/gu, ' ').trim().slice(0, MAX_SEARCH_TEXT_LENGTH);
}

export function buildSearchEntry(post: SearchSourcePost): SearchEntry {
  if (/\.mdx$/iu.test(post.filePath ?? post.id)) {
    throw new Error(
      `Post "${post.id}" uses MDX, whose non-visible code cannot be included in the public search index.`,
    );
  }

  if (typeof post.body !== 'string') {
    throw new Error(`Post "${post.id}" does not expose its Markdown body.`);
  }

  const entry: SearchEntry = {
    href: getPostHref(post),
    title: post.data.title,
    description: post.data.description,
    pubDate: post.data.pubDate.toISOString().slice(0, 10),
    category: post.data.category,
    tags: [...post.data.tags],
    readingMinutes: estimateReadingMinutes(post.body),
    searchText: markdownToSearchText(post.body),
  };

  if (post.data.column !== undefined) {
    entry.column = post.data.column;
  }

  if (post.data.columnOrder !== undefined) {
    entry.columnOrder = post.data.columnOrder;
  }

  return entry;
}

export function normalizeSearchQuery(query: string): string {
  return query
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/gu, ' ')
    .trim();
}

function scoreEntryForTerm(entry: SearchEntry, term: string): number {
  const title = normalizeSearchQuery(entry.title);
  const description = normalizeSearchQuery(entry.description);
  const searchText = normalizeSearchQuery(entry.searchText);
  const taxonomyFields = [entry.category, entry.column ?? '', ...entry.tags].map(
    normalizeSearchQuery,
  );

  let score = 0;

  if (title === term) {
    score = SEARCH_WEIGHTS.titleExact;
  } else if (title.startsWith(term)) {
    score = SEARCH_WEIGHTS.titlePrefix;
  } else if (title.includes(term)) {
    score = SEARCH_WEIGHTS.titleContains;
  }

  if (taxonomyFields.some((field) => field.includes(term))) {
    score += SEARCH_WEIGHTS.taxonomy;
  }

  if (description.includes(term)) {
    score += SEARCH_WEIGHTS.description;
  }

  if (searchText.includes(term)) {
    score += SEARCH_WEIGHTS.body;
  }

  return score;
}

function compareNewestThenHref(left: SearchEntry, right: SearchEntry): number {
  if (left.pubDate !== right.pubDate) {
    return left.pubDate < right.pubDate ? 1 : -1;
  }

  if (left.href === right.href) {
    return 0;
  }

  return left.href < right.href ? -1 : 1;
}

export function searchEntries(
  entries: readonly SearchEntry[],
  query: string,
  limit = 8,
): SearchEntry[] {
  const normalizedQuery = normalizeSearchQuery(query);
  const normalizedLimit = Math.max(0, Math.trunc(limit));

  if (normalizedQuery === '') {
    return [...entries].sort(compareNewestThenHref).slice(0, normalizedLimit);
  }

  const terms = normalizedQuery.split(' ');
  const scoredEntries: ScoredSearchEntry[] = [];

  for (const entry of entries) {
    let totalScore = 0;
    let matchesEveryTerm = true;

    for (const term of terms) {
      const termScore = scoreEntryForTerm(entry, term);

      if (termScore === 0) {
        matchesEveryTerm = false;
        break;
      }

      totalScore += termScore;
    }

    if (matchesEveryTerm) {
      scoredEntries.push({ entry, score: totalScore });
    }
  }

  return scoredEntries
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      return compareNewestThenHref(left.entry, right.entry);
    })
    .slice(0, normalizedLimit)
    .map(({ entry }) => entry);
}

export function serializeSearchIndex(value: unknown): string {
  const replacements: Readonly<Record<string, string>> = {
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  };
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new TypeError('Search index value must be JSON-compatible.');
  }

  return serialized.replace(
    /[<>&\u2028\u2029]/gu,
    (character) => replacements[character],
  );
}
