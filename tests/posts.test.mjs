import assert from 'node:assert/strict';
import test from 'node:test';

import * as postHelpers from '../src/lib/posts.ts';

const {
  buildCategoryIndex,
  buildColumnIndex,
  buildPostRouteRecords,
  buildRelatedPosts,
  buildSeriesNavigation,
  buildTagIndex,
  estimateReadingMinutes,
  getCategoryHref,
  getColumnHref,
  getPostHref,
  getPostSlug,
  isTrustedFeishuUrl,
  normalizeTag,
  serializeJsonLd,
  sortNewestFirst,
} = postHelpers;

function freezeDiscoveryPost({
  id,
  title,
  pubDate,
  category,
  tags = [],
  slug,
  column,
  columnOrder,
}) {
  return Object.freeze({
    id,
    data: Object.freeze({
      title,
      description: `${title} description`,
      pubDate: Object.freeze(new Date(pubDate)),
      category,
      tags: Object.freeze([...tags]),
      ...(slug === undefined ? {} : { slug }),
      ...(column === undefined ? {} : { column }),
      ...(columnOrder === undefined ? {} : { columnOrder }),
    }),
  });
}

const discoveryPosts = Object.freeze([
  freezeDiscoveryPost({
    id: 'manual/column-three.md',
    title: 'Column three',
    pubDate: '2026-01-20T00:00:00.000Z',
    category: '随笔',
    column: '博客搭建手记',
    columnOrder: 3,
  }),
  freezeDiscoveryPost({
    id: 'manual/standalone.md',
    title: 'Standalone',
    pubDate: '2026-01-12T00:00:00.000Z',
    category: '随笔',
    tags: ['unrelated'],
  }),
  freezeDiscoveryPost({
    id: 'manual/column-one.md',
    title: 'Column one',
    pubDate: '2026-01-01T00:00:00.000Z',
    category: '随笔',
    column: '博客搭建手记',
    columnOrder: 1,
  }),
  freezeDiscoveryPost({
    id: 'manual/same-category.md',
    title: 'Same category',
    pubDate: '2026-01-09T00:00:00.000Z',
    category: '技术',
    tags: ['other'],
  }),
  freezeDiscoveryPost({
    id: 'manual/column-two.md',
    title: 'Column two',
    pubDate: '2026-01-10T00:00:00.000Z',
    category: '技术',
    tags: ['Astro', 'ＡＳＴＲＯ', '共享'],
    column: '博客搭建手记',
    columnOrder: 2,
  }),
]);

test('buildSeriesNavigation returns ordered public links for a middle article', () => {
  const series = buildSeriesNavigation(
    discoveryPosts,
    'manual/column-two.md',
  );

  assert.deepEqual(series, {
    label: '博客搭建手记',
    href: getColumnHref('博客搭建手记'),
    position: 2,
    total: 3,
    previous: { href: '/posts/column-one/', title: 'Column one' },
    next: { href: '/posts/column-three/', title: 'Column three' },
  });
});

test('series navigation handles both ends, standalone posts, and missing ids', () => {
  assert.deepEqual(
    buildSeriesNavigation(discoveryPosts, 'manual/column-one.md'),
    {
      label: '博客搭建手记',
      href: getColumnHref('博客搭建手记'),
      position: 1,
      total: 3,
      next: { href: '/posts/column-two/', title: 'Column two' },
    },
  );
  assert.deepEqual(
    buildSeriesNavigation(discoveryPosts, 'manual/column-three.md'),
    {
      label: '博客搭建手记',
      href: getColumnHref('博客搭建手记'),
      position: 3,
      total: 3,
      previous: { href: '/posts/column-two/', title: 'Column two' },
    },
  );
  assert.equal(
    buildSeriesNavigation(discoveryPosts, 'manual/standalone.md'),
    undefined,
  );
  assert.equal(buildSeriesNavigation(discoveryPosts, 'missing.md'), undefined);
});

test('series navigation returns one-of-one progress without adjacent links', () => {
  const onlyPost = freezeDiscoveryPost({
    id: 'manual/only.md',
    title: 'Only article',
    pubDate: '2026-01-01T00:00:00.000Z',
    category: '技术',
    column: 'Solo Series',
    columnOrder: 1,
  });

  assert.deepEqual(buildSeriesNavigation(Object.freeze([onlyPost]), onlyPost.id), {
    label: 'Solo Series',
    href: getColumnHref('Solo Series'),
    position: 1,
    total: 1,
  });
});

test('buildSeriesNavigation uses validated column data', () => {
  const duplicateOrderPosts = Object.freeze([
    freezeDiscoveryPost({
      id: 'manual/first.md',
      title: 'First',
      pubDate: '2026-01-01T00:00:00.000Z',
      category: '技术',
      column: 'Series',
      columnOrder: 1,
    }),
    freezeDiscoveryPost({
      id: 'manual/duplicate.md',
      title: 'Duplicate',
      pubDate: '2026-01-02T00:00:00.000Z',
      category: '技术',
      column: 'Series',
      columnOrder: 1,
    }),
  ]);

  assert.throws(
    () => buildSeriesNavigation(duplicateOrderPosts, 'manual/first.md'),
    /duplicate.*order/i,
  );
});

test('buildRelatedPosts excludes public hrefs and returns public metadata only', () => {
  const originalIds = discoveryPosts.map(({ id }) => id);
  const sourceCandidate = discoveryPosts.find(
    ({ id }) => id === 'manual/same-category.md',
  );
  const originalPubDate = sourceCandidate.data.pubDate.getTime();
  const related = buildRelatedPosts(discoveryPosts, 'manual/column-two.md', {
    excludeHrefs: new Set([
      '/posts/column-one/',
      '/posts/column-three/',
    ]),
    limit: 3,
  });

  assert.deepEqual(related, [
    {
      href: '/posts/same-category/',
      title: 'Same category',
      description: 'Same category description',
      pubDate: new Date('2026-01-09T00:00:00.000Z'),
      category: '技术',
      tags: ['other'],
    },
  ]);
  assert.deepEqual(discoveryPosts.map(({ id }) => id), originalIds);
  assert.notStrictEqual(related[0].pubDate, sourceCandidate.data.pubDate);

  related[0].pubDate.setTime(originalPubDate + 1);
  assert.equal(sourceCandidate.data.pubDate.getTime(), originalPubDate);
});

test('related ranking combines canonical column, category, and unique shared tags', () => {
  const posts = Object.freeze([
    freezeDiscoveryPost({
      id: 'manual/current.md',
      title: 'Current',
      pubDate: '2026-01-10T00:00:00.000Z',
      category: 'Tech',
      tags: ['Astro', 'ＡＳＴＲＯ', 'Shared'],
      column: 'Series',
      columnOrder: 1,
    }),
    freezeDiscoveryPost({
      id: 'manual/column-match.md',
      title: 'Column match',
      pubDate: '2025-01-01T00:00:00.000Z',
      category: 'Other',
      column: 'ＳＥＲＩＥＳ',
      columnOrder: 2,
    }),
    freezeDiscoveryPost({
      id: 'manual/category-tag.md',
      title: 'Category and tag',
      pubDate: '2026-01-09T00:00:00.000Z',
      category: 'ＴＥＣＨ',
      tags: ['astro', 'ASTRO'],
    }),
    freezeDiscoveryPost({
      id: 'manual/two-tags.md',
      title: 'Two tags',
      pubDate: '2026-01-10T00:00:00.000Z',
      category: 'Other',
      tags: ['astro', 'shared'],
    }),
  ]);

  assert.deepEqual(
    buildRelatedPosts(posts, 'manual/current.md', { limit: 10 }).map(
      ({ href }) => href,
    ),
    [
      '/posts/column-match/',
      '/posts/category-tag/',
      '/posts/two-tags/',
    ],
  );
});

test('related ranking sorts by score, distance, newest date, then href and omits zero scores', () => {
  const posts = Object.freeze([
    freezeDiscoveryPost({
      id: 'manual/current.md',
      title: 'Current',
      pubDate: '2026-01-10T00:00:00.000Z',
      category: 'Current category',
      tags: ['shared'],
    }),
    freezeDiscoveryPost({
      id: 'manual/high-score.md',
      title: 'High score',
      pubDate: '2026-02-01T00:00:00.000Z',
      category: 'Current category',
      tags: ['shared'],
    }),
    freezeDiscoveryPost({
      id: 'manual/closest.md',
      title: 'Closest',
      pubDate: '2026-01-10T00:00:00.000Z',
      category: 'Other',
      tags: ['shared'],
    }),
    freezeDiscoveryPost({
      id: 'manual/beta.md',
      title: 'Beta',
      pubDate: '2026-01-11T00:00:00.000Z',
      category: 'Other',
      tags: ['shared'],
    }),
    freezeDiscoveryPost({
      id: 'manual/alpha.md',
      title: 'Alpha',
      pubDate: '2026-01-11T00:00:00.000Z',
      category: 'Other',
      tags: ['shared'],
    }),
    freezeDiscoveryPost({
      id: 'manual/older.md',
      title: 'Older',
      pubDate: '2026-01-09T00:00:00.000Z',
      category: 'Other',
      tags: ['shared'],
    }),
    freezeDiscoveryPost({
      id: 'manual/zero.md',
      title: 'Zero',
      pubDate: '2026-01-10T00:00:00.000Z',
      category: 'Other',
      tags: ['unrelated'],
    }),
  ]);

  assert.deepEqual(
    buildRelatedPosts(posts, 'manual/current.md', { limit: 99 }).map(
      ({ href }) => href,
    ),
    [
      '/posts/high-score/',
      '/posts/closest/',
      '/posts/alpha/',
      '/posts/beta/',
      '/posts/older/',
    ],
  );
});

test('related limits default to three and normalize to a nonnegative integer', () => {
  const currentId = 'manual/current.md';
  const posts = Object.freeze([
    freezeDiscoveryPost({
      id: currentId,
      title: 'Current',
      pubDate: '2026-01-10T00:00:00.000Z',
      category: 'Shared',
    }),
    ...Array.from({ length: 5 }, (_, index) =>
      freezeDiscoveryPost({
        id: `manual/candidate-${index}.md`,
        title: `Candidate ${index}`,
        pubDate: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
        category: 'Shared',
      }),
    ),
  ]);

  assert.equal(buildRelatedPosts(posts, currentId).length, 3);
  assert.equal(buildRelatedPosts(posts, currentId, { limit: 1.9 }).length, 1);
  assert.deepEqual(buildRelatedPosts(posts, currentId, { limit: 0 }), []);
  assert.deepEqual(buildRelatedPosts(posts, currentId, { limit: -1 }), []);
  assert.deepEqual(buildRelatedPosts(posts, currentId, { limit: Number.NaN }), []);
});

test('buildRelatedPosts returns an empty list for a missing current id', () => {
  assert.deepEqual(buildRelatedPosts(discoveryPosts, 'missing.md'), []);
});

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

test('buildCategoryIndex sorts directory labels and category posts newest-first without mutating input', () => {
  const olderTechnologyPost = {
    id: 'manual/older-technology.md',
    data: {
      title: 'Older technology',
      pubDate: new Date('2026-01-01'),
      category: '技术',
    },
  };
  const growthPost = {
    id: 'manual/growth.md',
    data: {
      title: 'Growth',
      pubDate: new Date('2026-03-01'),
      category: '成长',
    },
  };
  const newestTechnologyPost = {
    id: 'feishu/newest-technology.md',
    data: {
      title: 'Newest technology',
      pubDate: new Date('2026-06-01'),
      category: '技术',
    },
  };
  const posts = Object.freeze([
    olderTechnologyPost,
    growthPost,
    newestTechnologyPost,
  ]);

  const categoryIndex = buildCategoryIndex(posts);
  const technology = categoryIndex.find((entry) => entry.label === '技术');

  assert.deepEqual(
    categoryIndex.map((entry) => entry.label),
    ['成长', '技术'],
  );
  assert.deepEqual(technology.posts, [
    newestTechnologyPost,
    olderTechnologyPost,
  ]);
  assert.deepEqual(posts, [
    olderTechnologyPost,
    growthPost,
    newestTechnologyPost,
  ]);
});

test('buildColumnIndex sorts directory labels and column posts by positive columnOrder without mutating input', () => {
  const secondPost = {
    id: 'feishu/second.md',
    data: {
      title: 'Second',
      pubDate: new Date('2026-06-01'),
      column: '博客搭建手记',
      columnOrder: 2,
    },
  };
  const otherColumnPost = {
    id: 'manual/other-column.md',
    data: {
      title: 'Other column',
      pubDate: new Date('2026-04-01'),
      column: '成长手记',
      columnOrder: 1,
    },
  };
  const standalonePost = {
    id: 'manual/standalone.md',
    data: {
      title: 'Standalone',
      pubDate: new Date('2026-03-01'),
    },
  };
  const firstPost = {
    id: 'manual/first.md',
    data: {
      title: 'First',
      pubDate: new Date('2026-01-01'),
      column: '博客搭建手记',
      columnOrder: 1,
    },
  };
  const posts = Object.freeze([
    secondPost,
    otherColumnPost,
    standalonePost,
    firstPost,
  ]);

  const columnIndex = buildColumnIndex(posts);
  const blogColumn = columnIndex.find(
    (entry) => entry.label === '博客搭建手记',
  );

  assert.deepEqual(
    columnIndex.map((entry) => entry.label),
    ['博客搭建手记', '成长手记'],
  );
  assert.deepEqual(
    blogColumn.posts.map((post) => post.id),
    ['manual/first.md', 'feishu/second.md'],
  );
  assert.deepEqual(posts, [
    secondPost,
    otherColumnPost,
    standalonePost,
    firstPost,
  ]);
});

test('taxonomy href helpers create stable safe routes for Unicode labels', () => {
  const category = '技术 / 前端';
  const column = '博客搭建手记 #1';
  const categoryHref = getCategoryHref(category);
  const columnHref = getColumnHref(column);

  assert.equal(categoryHref, `/categories/${normalizeTag(category)}/`);
  assert.equal(columnHref, `/columns/${normalizeTag(column)}/`);
  assert.equal(categoryHref, getCategoryHref(category));
  assert.equal(columnHref, getColumnHref(column));
  assert.doesNotMatch(categoryHref.slice('/categories/'.length, -1), /[/#?%\s]/);
  assert.doesNotMatch(columnHref.slice('/columns/'.length, -1), /[/#?%\s]/);
});

test('buildCategoryIndex throws when different canonical labels map to one route slug', () => {
  const posts = [
    {
      id: 'manual/first.md',
      data: {
        title: 'First',
        pubDate: new Date('2026-06-01'),
        category: 'A B',
      },
    },
    {
      id: 'manual/second.md',
      data: {
        title: 'Second',
        pubDate: new Date('2026-01-01'),
        category: 'a-b',
      },
    },
  ];

  assert.throws(
    () => buildCategoryIndex(posts),
    /Category route collision.*a-b.*a b.*a-b/i,
  );
});

test('buildColumnIndex throws when different canonical labels map to one route slug', () => {
  const posts = [
    {
      id: 'manual/first.md',
      data: {
        title: 'First',
        pubDate: new Date('2026-06-01'),
        column: 'A B',
        columnOrder: 1,
      },
    },
    {
      id: 'manual/second.md',
      data: {
        title: 'Second',
        pubDate: new Date('2026-01-01'),
        column: 'a-b',
        columnOrder: 1,
      },
    },
  ];

  assert.throws(
    () => buildColumnIndex(posts),
    /Column route collision.*a-b.*a b.*a-b/i,
  );
});

test('buildColumnIndex rejects missing and non-positive-safe-integer column orders', () => {
  const invalidOrders = [
    undefined,
    0,
    -1,
    1.5,
    '1',
    Number.MAX_SAFE_INTEGER + 1,
  ];

  for (const [index, columnOrder] of invalidOrders.entries()) {
    const post = {
      id: `manual/invalid-${index}.md`,
      data: {
        title: 'Invalid column order',
        pubDate: new Date('2026-01-01'),
        column: '博客搭建手记',
        ...(columnOrder === undefined ? {} : { columnOrder }),
      },
    };

    assert.throws(
      () => buildColumnIndex([post]),
      /Column order.*positive integer.*manual\/invalid/i,
    );
  }
});

test('buildColumnIndex rejects a column order without a column', () => {
  const post = {
    id: 'manual/order-without-column.md',
    data: {
      title: 'Order without column',
      pubDate: new Date('2026-01-01'),
      columnOrder: 1,
    },
  };

  assert.throws(
    () => buildColumnIndex([post]),
    /Column order.*without a column.*manual\/order-without-column/i,
  );
});

test('buildColumnIndex rejects duplicate orders in one column with both post ids', () => {
  const firstPost = {
    id: 'manual/first.md',
    data: {
      title: 'First',
      pubDate: new Date('2026-06-01'),
      column: '博客搭建手记',
      columnOrder: 1,
    },
  };
  const duplicatePost = {
    id: 'feishu/duplicate.md',
    data: {
      title: 'Duplicate',
      pubDate: new Date('2026-01-01'),
      column: '博客搭建手记',
      columnOrder: 1,
    },
  };

  assert.throws(() => buildColumnIndex([firstPost, duplicatePost]), (error) => {
    assert.match(error.message, /duplicate.*order.*1/i);
    assert.match(error.message, /manual\/first\.md/);
    assert.match(error.message, /feishu\/duplicate\.md/);
    return true;
  });
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
