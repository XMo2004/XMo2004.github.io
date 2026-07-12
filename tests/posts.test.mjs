import assert from 'node:assert/strict';
import test from 'node:test';

import {
  estimateReadingMinutes,
  normalizeTag,
  sortNewestFirst,
} from '../src/lib/posts.ts';

test('estimateReadingMinutes returns at least one minute for a short paragraph', () => {
  assert.equal(estimateReadingMinutes('这是一个短段落。'), 1);
});

test('normalizeTag trims and replaces consecutive whitespace with a hyphen', () => {
  assert.equal(normalizeTag(' 前端 工程 '), '前端-工程');
});

test('sortNewestFirst orders posts by pubDate descending without mutating input', () => {
  const januaryPost = { title: 'January', pubDate: new Date('2026-01-01') };
  const junePost = { title: 'June', pubDate: new Date('2026-06-01') };
  const posts = [januaryPost, junePost];

  const sortedPosts = sortNewestFirst(posts);

  assert.deepEqual(sortedPosts, [junePost, januaryPost]);
  assert.deepEqual(posts, [januaryPost, junePost]);
  assert.notStrictEqual(sortedPosts, posts);
});
