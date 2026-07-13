import assert from 'node:assert/strict';
import test from 'node:test';

import {
  coverSchema,
  responsiveCoverSchema,
} from '../src/lib/cover.ts';

function responsiveCover(overrides = {}) {
  return {
    src: '/media/feishu/large.webp',
    width: 960,
    height: 540,
    variants: [
      { src: '/media/feishu/small.webp', width: 320 },
      { src: '/media/feishu/medium.webp', width: 640 },
      { src: '/media/feishu/large.webp', width: 960 },
    ],
    ...overrides,
  };
}

function failureIssues(value) {
  const coverResult = coverSchema.safeParse(value);
  const responsiveResult = responsiveCoverSchema.safeParse(value);

  assert.equal(
    coverResult.success,
    false,
    'expected cover metadata to be rejected by the public union',
  );
  assert.equal(
    responsiveResult.success,
    false,
    'expected cover metadata to be rejected by the responsive branch',
  );
  return responsiveResult.error.issues;
}

function assertIssuePath(value, expectedPath) {
  const issues = failureIssues(value);
  const hasExpectedPath = issues.some((issue) =>
    issue.path.length === expectedPath.length
    && issue.path.every((segment, index) => segment === expectedPath[index]));

  assert.ok(
    hasExpectedPath,
    `expected issue path ${JSON.stringify(expectedPath)}, received ${JSON.stringify(issues)}`,
  );
}

test('cover schema preserves ordinary and empty legacy strings', () => {
  assert.equal(
    coverSchema.parse('/media/feishu/legacy.png'),
    '/media/feishu/legacy.png',
  );
  assert.equal(coverSchema.parse(''), '');
});

test('cover schema accepts one-variant responsive metadata', () => {
  const cover = {
    src: '/media/feishu/only.webp',
    width: 320,
    height: 180,
    variants: [{ src: '/media/feishu/only.webp', width: 320 }],
  };

  assert.deepEqual(coverSchema.parse(cover), cover);
});

test('cover schema accepts full responsive metadata', () => {
  const cover = responsiveCover();

  assert.deepEqual(coverSchema.parse(cover), cover);
});

const unsafePaths = [
  ['HTTPS URL', 'https://example.com/cover.webp'],
  ['protocol-relative URL', '//example.com/cover.webp'],
  ['relative path', 'media/cover.webp'],
  ['backslash', '/media\\cover.webp'],
  ['whitespace', '/media/cover image.webp'],
  ['query', '/media/cover.webp?token=private'],
  ['fragment', '/media/cover.webp#preview'],
];

for (const [description, src] of unsafePaths) {
  test(`cover schema rejects a top-level ${description}`, () => {
    assertIssuePath(responsiveCover({ src }), ['src']);
  });

  test(`cover schema rejects a variant ${description}`, () => {
    const cover = responsiveCover();
    cover.variants[1] = { ...cover.variants[1], src };

    assertIssuePath(cover, ['variants', 1, 'src']);
  });
}

for (const field of ['width', 'height']) {
  for (const value of [0, -1, 1.5]) {
    test(`cover schema rejects top-level ${field} ${value}`, () => {
      assertIssuePath(responsiveCover({ [field]: value }), [field]);
    });
  }
}

for (const width of [0, -1, 1.5]) {
  test(`cover schema rejects variant width ${width}`, () => {
    const cover = responsiveCover();
    cover.variants[1] = { ...cover.variants[1], width };

    assertIssuePath(cover, ['variants', 1, 'width']);
  });
}

test('cover schema rejects an empty variant list', () => {
  assertIssuePath(responsiveCover({ variants: [] }), ['variants']);
});

test('cover schema rejects descending variant widths at the offending index', () => {
  const cover = responsiveCover();
  cover.variants = [...cover.variants].reverse();

  assertIssuePath(cover, ['variants', 1, 'width']);
});

test('cover schema rejects equal variant widths at the offending index', () => {
  const cover = responsiveCover();
  cover.variants[1] = { ...cover.variants[1], width: 320 };

  assertIssuePath(cover, ['variants', 1, 'width']);
});

test('cover schema rejects duplicate variant paths at the offending index', () => {
  const cover = responsiveCover();
  cover.variants[1] = {
    ...cover.variants[1],
    src: cover.variants[0].src,
  };

  assertIssuePath(cover, ['variants', 1, 'src']);
});

test('cover schema allows the top-level path to repeat only as the final variant', () => {
  const cover = responsiveCover();

  assert.deepEqual(coverSchema.parse(cover), cover);
});

test('cover schema rejects a final variant src mismatch at the final src', () => {
  const cover = responsiveCover({ src: '/media/feishu/other.webp' });

  assertIssuePath(cover, ['variants', 2, 'src']);
});

test('cover schema rejects a final variant width mismatch at the final width', () => {
  const cover = responsiveCover({ width: 1440 });

  assertIssuePath(cover, ['variants', 2, 'width']);
});
