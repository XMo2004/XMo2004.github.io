import { estimateReadingMinutes, getPostHref } from './posts.ts';

const MAX_SEARCH_TEXT_LENGTH = 12_000;

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

function decodeHtmlEntities(value: string): string {
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
    (entity, decimal: string | undefined, hexadecimal: string | undefined, name: string | undefined) => {
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

export function markdownToSearchText(markdown: string): string {
  const preservedSegments: string[] = [];
  const preserve = (segment: string): string => {
    const token = `\uE000${preservedSegments.length}\uE001`;
    preservedSegments.push(segment);
    return ` ${token} `;
  };

  let text = markdown.normalize('NFKC').replace(/\r\n?/gu, '\n');

  text = text.replace(
    /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]{0,3}\1[ \t]*(?=\n|$)/gmu,
    (_match, _fence: string, code: string) => preserve(code),
  );
  text = text.replace(/^[ \t]{0,3}(?:`{3,}|~{3,})[^\n]*(?=\n|$)/gmu, ' ');
  text = text.replace(/(`+)([\s\S]*?)\1/gu, (_match, _ticks: string, code: string) => {
    const singleLineCode = code.replace(/\s*\n\s*/gu, ' ');
    const visibleCode =
      /^\s[\s\S]*\s$/u.test(singleLineCode) && /\S/u.test(singleLineCode)
        ? singleLineCode.slice(1, -1)
        : singleLineCode;

    return preserve(visibleCode);
  });
  text = text.replace(
    /\\([\\`*{}[\]()#+\-.!_>~|])/gu,
    (_match, character: string) => preserve(character),
  );

  text = text.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ');
  text = text.replace(/<!--[\s\S]*?-->/gu, ' ');
  text = text.replace(/^[ \t]{0,3}\[[^\]\n]+\]:[^\n]*(?=\n|$)/gmu, ' ');
  text = replaceInlineLinkTargets(text);
  text = text.replace(/<\/?[a-z][^>]*>/giu, ' ');
  text = text.replace(/<![^>]*>|<\?[^>]*\?>/gu, ' ');
  text = decodeHtmlEntities(text);

  text = text.replace(/^[ \t]{0,3}(?:[-*_][ \t]*){3,}$/gmu, ' ');
  text = text.replace(/^[ \t]{0,3}(?:=+|-+)[ \t]*$/gmu, ' ');
  text = text.replace(/^[ \t]{0,3}#{1,6}(?:[ \t]+|$)/gmu, ' ');
  text = text.replace(/[ \t]+#+[ \t]*$/gmu, ' ');
  text = text.replace(/^[ \t]{0,3}(?:>[ \t]?)+/gmu, ' ');
  text = text.replace(/^[ \t]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/gmu, ' ');
  text = text.replace(/^[ \t]*\[[ xX]\][ \t]+/gmu, ' ');
  text = text.replace(/\\[ \t]*(?=\n|$)/gmu, ' ');
  text = text.replace(/[*_~]+/gu, '');
  text = text.replace(/[\[\]|]/gu, ' ');

  text = text.replace(/\uE000(\d+)\uE001/gu, (_match, segmentIndex: string) => {
    return preservedSegments[Number.parseInt(segmentIndex, 10)] ?? '';
  });

  return text.replace(/\s+/gu, ' ').trim().slice(0, MAX_SEARCH_TEXT_LENGTH);
}

export function buildSearchEntry(post: SearchSourcePost): SearchEntry {
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
    score = Math.max(score, SEARCH_WEIGHTS.taxonomy);
  }

  if (description.includes(term)) {
    score = Math.max(score, SEARCH_WEIGHTS.description);
  }

  if (searchText.includes(term)) {
    score = Math.max(score, SEARCH_WEIGHTS.body);
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

export function serializeSearchIndex(entries: readonly SearchEntry[]): string {
  const replacements: Readonly<Record<string, string>> = {
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  };

  return JSON.stringify(entries).replace(
    /[<>&\u2028\u2029]/gu,
    (character) => replacements[character],
  );
}
