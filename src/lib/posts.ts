const CHINESE_CHARACTERS_PER_MINUTE = 450;
const ENGLISH_WORDS_PER_MINUTE = 220;
const TRUSTED_FEISHU_DOMAINS = ['feishu.cn', 'larksuite.com'] as const;
const UTF8_ENCODER = new TextEncoder();

interface PostRouteEntry {
  id: string;
  data: {
    slug?: string;
  };
}

interface NavigablePostEntry extends PostRouteEntry {
  data: PostRouteEntry['data'] & {
    title: string;
    pubDate: Date;
  };
}

interface TaggedPostEntry {
  data: {
    pubDate: Date;
    tags: readonly string[];
  };
}

export interface AdjacentPostLink {
  href: string;
  title: string;
}

export interface PostRouteRecord<T extends NavigablePostEntry> {
  params: {
    id: string;
  };
  props: {
    post: T;
    previous?: AdjacentPostLink;
    next?: AdjacentPostLink;
  };
}

export interface TagIndexEntry<T extends TaggedPostEntry> {
  canonicalTag: string;
  label: string;
  slug: string;
  posts: T[];
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

export function isTrustedFeishuUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      url.protocol === 'https:' &&
      TRUSTED_FEISHU_DOMAINS.some(
        (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
}

function canonicalizeTag(tag: string): string {
  return tag.trim().normalize('NFKC').toLowerCase();
}

function getTagLabel(tag: string): string {
  return tag.trim().normalize('NFKC');
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

export function buildTagIndex<T extends TaggedPostEntry>(
  posts: readonly T[],
): TagIndexEntry<T>[] {
  const tagByCanonicalLabel = new Map<string, TagIndexEntry<T>>();
  const canonicalLabelBySlug = new Map<string, string>();

  for (const post of sortNewestFirst(posts)) {
    const canonicalLabelsInPost = new Set<string>();

    for (const tag of post.data.tags) {
      const canonicalTag = canonicalizeTag(tag);
      const slug = normalizeTag(tag);
      const canonicalLabelForSlug = canonicalLabelBySlug.get(slug);

      if (
        canonicalLabelForSlug !== undefined &&
        canonicalLabelForSlug !== canonicalTag
      ) {
        throw new Error(
          `Tag route collision for slug "${slug}": canonical labels "${canonicalLabelForSlug}" and "${canonicalTag}".`,
        );
      }

      canonicalLabelBySlug.set(slug, canonicalTag);

      let tagEntry = tagByCanonicalLabel.get(canonicalTag);
      if (tagEntry === undefined) {
        tagEntry = {
          canonicalTag,
          label: getTagLabel(tag),
          slug,
          posts: [],
        };
        tagByCanonicalLabel.set(canonicalTag, tagEntry);
      }

      if (!canonicalLabelsInPost.has(canonicalTag)) {
        tagEntry.posts.push(post);
        canonicalLabelsInPost.add(canonicalTag);
      }
    }
  }

  return [...tagByCanonicalLabel.values()].sort((firstTag, secondTag) =>
    firstTag.label.localeCompare(secondTag.label, 'zh-CN'),
  );
}

export function buildPostRouteRecords<T extends NavigablePostEntry>(
  posts: readonly T[],
): PostRouteRecord<T>[] {
  const postIdBySlug = new Map<string, string>();

  for (const post of posts) {
    const slug = getPostSlug(post);
    const firstPostId = postIdBySlug.get(slug);

    if (firstPostId !== undefined) {
      throw new Error(
        `Post route collision for slug "${slug}": entries "${firstPostId}" and "${post.id}" map to the same public URL.`,
      );
    }

    postIdBySlug.set(slug, post.id);
  }

  const sortedPosts = sortNewestFirst(posts);

  return sortedPosts.map((post, index) => {
    const previousPost = sortedPosts[index + 1];
    const nextPost = sortedPosts[index - 1];

    return {
      params: { id: getPostSlug(post) },
      props: {
        post,
        previous:
          previousPost === undefined
            ? undefined
            : {
                href: getPostHref(previousPost),
                title: previousPost.data.title,
              },
        next:
          nextPost === undefined
            ? undefined
            : {
                href: getPostHref(nextPost),
                title: nextPost.data.title,
              },
      },
    };
  });
}

export function serializeJsonLd(value: unknown): string {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new TypeError('JSON-LD value must be JSON serializable.');
  }

  return serialized
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function sortNewestFirst<T extends { data: { pubDate: Date } }>(
  posts: readonly T[],
): T[] {
  return [...posts].sort(
    (firstPost, secondPost) =>
      secondPost.data.pubDate.getTime() - firstPost.data.pubDate.getTime(),
  );
}
