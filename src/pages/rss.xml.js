import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

import { SITE } from '../config/site';
import { getPostHref, sortNewestFirst } from '../lib/posts';

export async function GET() {
  const posts = sortNewestFirst(await getCollection('posts'));

  return rss({
    title: SITE.name,
    description: SITE.description,
    site: SITE.canonicalOrigin,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: getPostHref(post),
    })),
    customData: '<language>zh-CN</language>',
  });
}
