import assert from 'node:assert/strict';
import test from 'node:test';

import * as postHelpers from '../src/lib/posts.ts';

const {
  estimateReadingMinutes,
  getPostHref,
  getPostSlug,
  normalizeTag,
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
