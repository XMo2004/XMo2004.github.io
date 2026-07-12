import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

import { sortNewestFirst } from '../lib/posts';
import { buildSearchEntry, serializeSearchIndex } from '../lib/search';

export const GET: APIRoute = async () => {
  const posts = sortNewestFirst(await getCollection('posts'));
  const entries = posts
    .map(buildSearchEntry)
    .sort(
      (first, second) =>
        second.pubDate.localeCompare(first.pubDate, 'en') ||
        first.href.localeCompare(second.href, 'en'),
    );

  return new Response(serializeSearchIndex({ version: 1, entries }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate',
    },
  });
};
