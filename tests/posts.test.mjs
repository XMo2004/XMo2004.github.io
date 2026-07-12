import assert from 'node:assert/strict';
import test from 'node:test';

import * as postHelpers from '../src/lib/posts.ts';

const {
  buildPostRouteRecords,
  buildTagIndex,
  estimateReadingMinutes,
  getPostHref,
  getPostSlug,
  isTrustedFeishuUrl,
  normalizeTag,
  serializeJsonLd,
  sortNewestFirst,
} = postHelpers;

test('getPostSlug prefers an explicit content slug', () => {
  const post = {
    id: 'manual/file-name.md',
    data: { slug: 'published-route' },
  };

  assert.equal(getPostSlug(post), 'published-route');
});

test('getPostSlug falls back to the extensionless entry id basename', () => {
  const post = {
    id: 'manual/nested/file-name.mdx',
    data: {},
  };

  assert.equal(getPostSlug(post), 'file-name');
});

test('getPostHref encodes a fallback slug as one safe path segment', () => {
  const post = {
    id: 'manual/技术 笔记.md',
    data: {},
  };

  assert.equal(
    getPostHref(post),
    '/posts/%E6%8A%80%E6%9C%AF%20%E7%AC%94%E8%AE%B0/',
  );
});

test('estimateReadingMinutes returns at least one minute for a short paragraph', () => {
  assert.equal(estimateReadingMinutes('这是一个短段落。'), 1);
});

test('estimateReadingMinutes rounds 451 Chinese characters up to two minutes', () => {
  assert.equal(estimateReadingMinutes('汉'.repeat(451)), 2);
});

test('estimateReadingMinutes rounds 221 English words up to two minutes', () => {
  const content = Array.from({ length: 221 }, () => 'word').join(' ');

  assert.equal(estimateReadingMinutes(content), 2);
});

test('estimateReadingMinutes adds Chinese and English reading time', () => {
  const englishContent = Array.from({ length: 110 }, () => 'word').join(' ');
  const content = `${'汉'.repeat(226)} ${englishContent}`;

  assert.equal(estimateReadingMinutes(content), 2);
});

test('normalizeTag trims and replaces consecutive whitespace with a hyphen', () => {
  assert.equal(normalizeTag(' 前端 工程 '), '前端-工程');
});

test('normalizeTag hashes reserved characters into a stable URL-safe suffix', () => {
  const tag = 'Web / CSS #1';
  const slug = normalizeTag(tag);

  assert.equal(slug, normalizeTag(tag));
  assert.equal(slug, 'web-css-1-7b75d515');
  assert.doesNotMatch(slug, /[/#?%]/);
});

test('normalizeTag distinguishes tags whose readable bases collide', () => {
  const cppSlug = normalizeTag('C++');
  const csharpSlug = normalizeTag('C#');

  assert.equal(cppSlug, 'c-4c21a3f0');
  assert.equal(csharpSlug, 'c-9629f5e3');
  assert.notEqual(cppSlug, csharpSlug);
});

test('normalizeTag gives pure symbols and emoji stable fallback slugs', () => {
  const expectedSlugs = new Map([
    ['///', 'tag-1d37d324'],
    ['🤖', 'tag-aa0df0be'],
  ]);

  for (const [tag, expectedSlug] of expectedSlugs) {
    const slug = normalizeTag(tag);

    assert.equal(slug, normalizeTag(tag));
    assert.equal(slug, expectedSlug);
  }
});

test('validateTagSet only reports slug collisions between different canonical tags', () => {
  assert.equal(typeof postHelpers.validateTagSet, 'function');
  assert.deepEqual(postHelpers.validateTagSet(['A B', 'a-b']), [
    {
      slug: 'a-b',
      firstCanonicalTag: 'a b',
      secondCanonicalTag: 'a-b',
    },
  ]);
  assert.deepEqual(
    postHelpers.validateTagSet([' Frontend ', 'ＦＲＯＮＴＥＮＤ']),
    [],
  );
});

test('buildTagIndex merges case and NFKC-equivalent labels without double-counting a post', () => {
  const newestPost = {
    id: 'manual/newest.md',
    data: {
      title: 'Newest',
      pubDate: new Date('2026-06-01'),
      tags: [' Frontend ', 'ＦＲＯＮＴＥＮＤ', 'Astro'],
    },
  };
  const olderPost = {
    id: 'feishu/older.md',
    data: {
      title: 'Older',
      pubDate: new Date('2026-01-01'),
      tags: ['frontend'],
    },
  };

  const tagIndex = buildTagIndex([newestPost, olderPost]);
  const frontend = tagIndex.find((entry) => entry.slug === 'frontend');

  assert.equal(frontend.label, 'Frontend');
  assert.deepEqual(frontend.posts, [newestPost, olderPost]);
  assert.equal(frontend.posts.length, 2);
});

test('buildTagIndex throws when different canonical labels map to one route slug', () => {
  const posts = [
    {
      id: 'manual/first.md',
      data: {
        title: 'First',
        pubDate: new Date('2026-06-01'),
        tags: ['A B'],
      },
    },
    {
      id: 'manual/second.md',
      data: {
        title: 'Second',
        pubDate: new Date('2026-01-01'),
        tags: ['a-b'],
      },
    },
  ];

  assert.throws(
    () => buildTagIndex(posts),
    /Tag route collision.*a-b.*a b.*a-b/i,
  );
});

test('buildPostRouteRecords sorts routes and builds adjacent URLs from public slugs', () => {
  const newestPost = {
    id: 'manual/newest.md',
    data: {
      title: 'Newest',
      pubDate: new Date('2026-06-01'),
      tags: [],
    },
  };
  const middlePost = {
    id: 'feishu/record-id.md',
    data: {
      title: 'Middle',
      slug: 'middle-route',
      pubDate: new Date('2026-03-01'),
      tags: [],
    },
  };
  const oldestPost = {
    id: 'manual/oldest.md',
    data: {
      title: 'Oldest',
      pubDate: new Date('2026-01-01'),
      tags: [],
    },
  };

  const routes = buildPostRouteRecords([oldestPost, newestPost, middlePost]);

  assert.deepEqual(
    routes.map((route) => route.params.id),
    ['newest', 'middle-route', 'oldest'],
  );
  assert.deepEqual(routes[1].props.previous, {
    href: '/posts/oldest/',
    title: 'Oldest',
  });
  assert.deepEqual(routes[1].props.next, {
    href: '/posts/newest/',
    title: 'Newest',
  });
  assert.doesNotMatch(routes[1].props.previous.href, /manual|feishu/);
  assert.doesNotMatch(routes[1].props.next.href, /manual|feishu/);
});

test('buildPostRouteRecords rejects duplicate explicit slugs with both entry ids', () => {
  const firstPost = {
    id: 'manual/first.md',
    data: {
      title: 'First',
      slug: 'shared-route',
      pubDate: new Date('2026-06-01'),
    },
  };
  const secondPost = {
    id: 'feishu/second.md',
    data: {
      title: 'Second',
      slug: 'shared-route',
      pubDate: new Date('2026-01-01'),
    },
  };

  assert.throws(() => buildPostRouteRecords([firstPost, secondPost]), (error) => {
    assert.match(error.message, /shared-route/);
    assert.match(error.message, /manual\/first\.md/);
    assert.match(error.message, /feishu\/second\.md/);
    return true;
  });
});

test('buildPostRouteRecords rejects matching fallback basenames across directories', () => {
  const manualPost = {
    id: 'manual/guide.md',
    data: {
      title: 'Manual guide',
      pubDate: new Date('2026-06-01'),
    },
  };
  const feishuPost = {
    id: 'feishu/guide.mdx',
    data: {
      title: 'Feishu guide',
      pubDate: new Date('2026-01-01'),
    },
  };

  assert.throws(() => buildPostRouteRecords([manualPost, feishuPost]), (error) => {
    assert.match(error.message, /guide/);
    assert.match(error.message, /manual\/guide\.md/);
    assert.match(error.message, /feishu\/guide\.mdx/);
    return true;
  });
});

test('buildPostRouteRecords rejects an explicit slug matching another fallback basename', () => {
  const explicitPost = {
    id: 'manual/published.md',
    data: {
      title: 'Published',
      slug: 'guide',
      pubDate: new Date('2026-06-01'),
    },
  };
  const fallbackPost = {
    id: 'feishu/guide.md',
    data: {
      title: 'Guide',
      pubDate: new Date('2026-01-01'),
    },
  };

  assert.throws(() => buildPostRouteRecords([explicitPost, fallbackPost]), (error) => {
    assert.match(error.message, /guide/);
    assert.match(error.message, /manual\/published\.md/);
    assert.match(error.message, /feishu\/guide\.md/);
    return true;
  });
});

test('isTrustedFeishuUrl accepts HTTPS Feishu and LarkSuite document hosts', () => {
  assert.equal(isTrustedFeishuUrl('https://example.feishu.cn/docx/abc'), true);
  assert.equal(
    isTrustedFeishuUrl('https://example.larksuite.com/docx/abc'),
    true,
  );
});

test('isTrustedFeishuUrl rejects non-HTTPS schemes and deceptive hostnames', () => {
  const rejectedUrls = [
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'mailto:someone@example.com',
    'http://example.feishu.cn/docx/abc',
    'https://feishu.cn.evil.example/',
  ];

  for (const url of rejectedUrls) {
    assert.equal(isTrustedFeishuUrl(url), false, `${url} should be rejected`);
  }
});

test('serializeJsonLd escapes script-closing markup while preserving JSON values', () => {
  const value = {
    '@context': 'https://schema.org',
    headline: '</script><script>alert("unsafe")</script> & \u2028',
  };

  const serialized = serializeJsonLd(value);

  assert.doesNotMatch(serialized, /<|<\/script/i);
  assert.match(serialized, /\\u003c\/script\\u003e/);
  assert.deepEqual(JSON.parse(serialized), value);
});

test('sortNewestFirst orders posts by pubDate descending without mutating input', () => {
  const januaryPost = {
    id: 'january',
    data: { title: 'January', pubDate: new Date('2026-01-01') },
  };
  const junePost = {
    id: 'june',
    data: { title: 'June', pubDate: new Date('2026-06-01') },
  };
  const posts = [januaryPost, junePost];

  const sortedPosts = sortNewestFirst(posts);

  assert.deepEqual(sortedPosts, [junePost, januaryPost]);
  assert.deepEqual(posts, [januaryPost, junePost]);
  assert.notStrictEqual(sortedPosts, posts);
});
