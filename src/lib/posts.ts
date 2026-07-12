const CHINESE_CHARACTERS_PER_MINUTE = 450;
const ENGLISH_WORDS_PER_MINUTE = 220;
const UTF8_ENCODER = new TextEncoder();

interface PostRouteEntry {
  id: string;
  data: {
    slug?: string;
  };
}

export function getPostSlug(entry: PostRouteEntry): string {
  if (entry.data.slug !== undefined) {
    return entry.data.slug;
  }

  const basename = entry.id.split(/[\\/]/).at(-1) ?? entry.id;
  return basename.replace(/\.mdx?$/i, '');
}

export function getPostHref(entry: PostRouteEntry): string {
  return `/posts/${encodeURIComponent(getPostSlug(entry))}/`;
}

function canonicalizeTag(tag: string): string {
  return tag.trim().normalize('NFKC').toLowerCase();
}

function fnv1aHash(value: string): string {
  let hash = 0x811c9dc5;

  for (const byte of UTF8_ENCODER.encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

export function estimateReadingMinutes(content: string): number {
  const chineseCharacterCount = content.match(/\p{Script=Han}/gu)?.length ?? 0;
  const englishWordCount = content.match(/[a-zA-Z0-9]+/g)?.length ?? 0;
  const estimatedMinutes =
    chineseCharacterCount / CHINESE_CHARACTERS_PER_MINUTE +
    englishWordCount / ENGLISH_WORDS_PER_MINUTE;

  return Math.max(1, Math.ceil(estimatedMinutes));
}

export function normalizeTag(tag: string): string {
  const canonicalTag = canonicalizeTag(tag);
  const base = canonicalTag
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const hash = fnv1aHash(canonicalTag);

  if (!base) {
    return `tag-${hash}`;
  }

  if (/[^\p{Letter}\p{Number}\s-]/u.test(canonicalTag)) {
    return `${base}-${hash}`;
  }

  return base;
}

export interface TagSlugCollision {
  slug: string;
  firstCanonicalTag: string;
  secondCanonicalTag: string;
}

export function validateTagSet(tags: readonly string[]): TagSlugCollision[] {
  const canonicalTagBySlug = new Map<string, string>();
  const collisions: TagSlugCollision[] = [];

  for (const tag of tags) {
    const canonicalTag = canonicalizeTag(tag);
    const slug = normalizeTag(tag);
    const firstCanonicalTag = canonicalTagBySlug.get(slug);

    if (firstCanonicalTag === undefined) {
      canonicalTagBySlug.set(slug, canonicalTag);
    } else if (firstCanonicalTag !== canonicalTag) {
      collisions.push({
        slug,
        firstCanonicalTag,
        secondCanonicalTag: canonicalTag,
      });
    }
  }

  return collisions;
}

export function sortNewestFirst<T extends { data: { pubDate: Date } }>(
  posts: readonly T[],
): T[] {
  return [...posts].sort(
    (firstPost, secondPost) =>
      secondPost.data.pubDate.getTime() - firstPost.data.pubDate.getTime(),
  );
}
