const CHINESE_CHARACTERS_PER_MINUTE = 450;
const ENGLISH_WORDS_PER_MINUTE = 220;

export function estimateReadingMinutes(content: string): number {
  const chineseCharacterCount = content.match(/\p{Script=Han}/gu)?.length ?? 0;
  const englishWordCount = content.match(/[a-zA-Z0-9]+/g)?.length ?? 0;
  const estimatedMinutes =
    chineseCharacterCount / CHINESE_CHARACTERS_PER_MINUTE +
    englishWordCount / ENGLISH_WORDS_PER_MINUTE;

  return Math.max(1, Math.ceil(estimatedMinutes));
}

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '-');
}

export function sortNewestFirst<T extends { pubDate: Date }>(
  posts: readonly T[],
): T[] {
  return [...posts].sort(
    (firstPost, secondPost) =>
      secondPost.pubDate.getTime() - firstPost.pubDate.getTime(),
  );
}
