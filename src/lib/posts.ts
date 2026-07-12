import {
  canonicalizeTaxonomyLabel,
  getTaxonomyLabel,
  normalizeTaxonomySlug,
  validateCategoryEntries,
  validateColumnEntries,
} from './taxonomy.mjs';

const CHINESE_CHARACTERS_PER_MINUTE = 450;
const ENGLISH_WORDS_PER_MINUTE = 220;
const TRUSTED_FEISHU_DOMAINS = ['feishu.cn', 'larksuite.com'] as const;

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

export interface CategorizedPostEntry {
  id: string;
  data: {
    category: string;
    pubDate: Date;
  };
}

export interface ColumnPostEntry {
  id: string;
  data: {
    column?: string;
    columnOrder?: number;
  };
}

export type OrderedColumnPostEntry<T extends ColumnPostEntry> = T & {
  data: T['data'] & {
    column: string;
    columnOrder: number;
  };
};

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

export interface CategoryIndexEntry<T extends CategorizedPostEntry> {
  canonicalCategory: string;
  label: string;
  slug: string;
  posts: T[];
}

export interface ColumnIndexEntry<T extends ColumnPostEntry> {
  canonicalColumn: string;
  label: string;
  slug: string;
  posts: OrderedColumnPostEntry<T>[];
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

export function getCategoryHref(category: string): string {
  return `/categories/${normalizeTag(category)}/`;
}

export function getColumnHref(column: string): string {
  return `/columns/${normalizeTag(column)}/`;
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

const canonicalizeTag = canonicalizeTaxonomyLabel;
const getTagLabel = getTaxonomyLabel;

export function estimateReadingMinutes(content: string): number {
  const chineseCharacterCount = content.match(/\p{Script=Han}/gu)?.length ?? 0;
  const englishWordCount = content.match(/[a-zA-Z0-9]+/g)?.length ?? 0;
  const estimatedMinutes =
    chineseCharacterCount / CHINESE_CHARACTERS_PER_MINUTE +
    englishWordCount / ENGLISH_WORDS_PER_MINUTE;

  return Math.max(1, Math.ceil(estimatedMinutes));
}

export function normalizeTag(tag: string): string {
  return normalizeTaxonomySlug(tag);
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

export function buildCategoryIndex<T extends CategorizedPostEntry>(
  posts: readonly T[],
): CategoryIndexEntry<T>[] {
  validateCategoryEntries(
    posts.map((post) => ({
      id: post.id,
      category: post.data.category,
    })),
  );
  const categoryByCanonicalLabel = new Map<string, CategoryIndexEntry<T>>();

  for (const post of sortNewestFirst(posts)) {
    const category = post.data.category;
    const canonicalCategory = canonicalizeTag(category);
    const slug = normalizeTag(category);

    let categoryEntry = categoryByCanonicalLabel.get(canonicalCategory);
    if (categoryEntry === undefined) {
      categoryEntry = {
        canonicalCategory,
        label: getTagLabel(category),
        slug,
        posts: [],
      };
      categoryByCanonicalLabel.set(canonicalCategory, categoryEntry);
    }

    categoryEntry.posts.push(post);
  }

  return [...categoryByCanonicalLabel.values()].sort(
    (firstCategory, secondCategory) =>
      firstCategory.label.localeCompare(secondCategory.label, 'zh-CN'),
  );
}

export function buildColumnIndex<T extends ColumnPostEntry>(
  posts: readonly T[],
): ColumnIndexEntry<T>[] {
  validateColumnEntries(
    posts.map((post) => ({
      id: post.id,
      column: post.data.column,
      columnOrder: post.data.columnOrder,
    })),
  );
  const columnByCanonicalLabel = new Map<string, ColumnIndexEntry<T>>();

  for (const post of posts) {
    const { column } = post.data;

    if (column === undefined) {
      continue;
    }

    const canonicalColumn = canonicalizeTag(column);
    const slug = normalizeTag(column);

    let columnEntry = columnByCanonicalLabel.get(canonicalColumn);
    if (columnEntry === undefined) {
      columnEntry = {
        canonicalColumn,
        label: getTagLabel(column),
        slug,
        posts: [],
      };
      columnByCanonicalLabel.set(canonicalColumn, columnEntry);
    }

    columnEntry.posts.push(post as OrderedColumnPostEntry<T>);
  }

  return [...columnByCanonicalLabel.values()]
    .map((columnEntry) => ({
      ...columnEntry,
      posts: [...columnEntry.posts].sort(
        (firstPost, secondPost) =>
          firstPost.data.columnOrder - secondPost.data.columnOrder,
      ),
    }))
    .sort((firstColumn, secondColumn) =>
      firstColumn.label.localeCompare(secondColumn.label, 'zh-CN'),
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
