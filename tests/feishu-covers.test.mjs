import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import sharp from 'sharp';

import {
  COVER_WIDTHS,
  MAX_COVER_PIXELS,
  MAX_COVER_SOURCE_BYTES,
  MAX_COVER_VARIANT_BYTES,
  createResponsiveCover,
} from '../scripts/feishu/covers.mjs';

const ANIMATED_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAExpcf8AACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgAAACwAAAAAAQABAAACAkwBACH5BAUKAAAALAAAAAABAAEAgExpcQAA/wICTAEAOw==',
  'base64',
);
const VECTOR_IMAGE = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="8" height="4"/></svg>',
);

function source(bytes, contentType = 'image/png') {
  return Object.freeze({ bytes: new Uint8Array(bytes), contentType });
}

async function solidPng(width, height) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 180, g: 90, b: 50 },
    },
  }).png().toBuffer();
}

async function stripedPng(width, height, stripeWidth) {
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.floor(x / stripeWidth) % 2 === 0 ? 0 : 255;
      const offset = (y * width + x) * 3;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
    }
  }
  return sharp(pixels, {
    raw: { width, height, channels: 3 },
  }).png().toBuffer();
}

test('responsive cover emits deterministic content-addressed WebP widths', async () => {
  assert.deepEqual(COVER_WIDTHS, [320, 640, 960, 1440]);
  assert.equal(MAX_COVER_SOURCE_BYTES, 5 * 1024 * 1024);
  assert.equal(MAX_COVER_PIXELS, 24_000_000);
  assert.equal(MAX_COVER_VARIANT_BYTES, 1024 * 1024);

  const input = source(await solidPng(1672, 941));
  const first = await createResponsiveCover(input);
  const second = await createResponsiveCover(input);

  assert.deepEqual(first.cover.variants.map(({ width }) => width), [320, 640, 960, 1440]);
  assert.equal(first.cover.width, 1440);
  assert.equal(first.cover.height, 810);
  assert.equal(first.cover.src, first.cover.variants.at(-1).src);
  assert.ok(first.assets.every((asset) => asset.contentType === 'image/webp'));
  assert.ok(first.assets.every((asset) => /^\/[a-z/]+\/[a-f0-9]{64}\.webp$/.test(asset.publicPath)));
  assert.deepEqual(
    first.assets.map(({ filename, bytes }) => [filename, Buffer.from(bytes).toString('hex')]),
    second.assets.map(({ filename, bytes }) => [filename, Buffer.from(bytes).toString('hex')]),
  );
  assert.deepEqual(
    first.assets.map(({ publicPath }) => publicPath),
    second.assets.map(({ publicPath }) => publicPath),
  );
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.cover));
  assert.ok(Object.isFrozen(first.cover.variants));
  assert.ok(first.cover.variants.every(Object.isFrozen));
  assert.ok(Object.isFrozen(first.assets));
});

test('responsive cover never enlarges or duplicates small and exact widths', async () => {
  const cases = [
    [200, [200]],
    [320, [320]],
    [500, [320, 500]],
    [640, [320, 640]],
    [1000, [320, 640, 960, 1000]],
  ];

  for (const [inputWidth, expectedWidths] of cases) {
    const result = await createResponsiveCover(
      source(await solidPng(inputWidth, Math.max(1, Math.floor(inputWidth / 2)))),
    );
    assert.deepEqual(
      result.cover.variants.map(({ width }) => width),
      expectedWidths,
    );
    assert.equal(result.cover.width, expectedWidths.at(-1));
    assert.equal(new Set(result.cover.variants.map(({ width }) => width)).size, expectedWidths.length);
  }
});

test('responsive cover applies EXIF orientation before sizing', async () => {
  const jpeg = await sharp({
    create: {
      width: 10,
      height: 20,
      channels: 3,
      background: { r: 40, g: 80, b: 120 },
    },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await createResponsiveCover(source(jpeg, 'image/jpeg'));

  assert.equal(result.cover.width, 20);
  assert.equal(result.cover.height, 10);
  const metadata = await sharp(result.assets[0].bytes).metadata();
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
});

test('responsive cover rejects invalid source, pixel, animation, decode and output budgets', async () => {
  const overPixelBudget = await solidPng(5000, 5000);
  const tiny = await solidPng(8, 4);

  await assert.rejects(createResponsiveCover(), /Uint8Array/);
  await assert.rejects(
    createResponsiveCover({ bytes: new Uint8Array() }),
    /must not be empty/,
  );
  await assert.rejects(
    createResponsiveCover(source(new Uint8Array(MAX_COVER_SOURCE_BYTES + 1))),
    /5 MiB source limit/,
  );
  await assert.rejects(
    createResponsiveCover(source(overPixelBudget)),
    /24 MP pixel limit/,
  );
  await assert.rejects(
    createResponsiveCover(source(ANIMATED_GIF, 'image/gif')),
    /static image/,
  );
  await assert.rejects(
    createResponsiveCover(source(VECTOR_IMAGE, 'image/svg+xml')),
    /static image/,
  );
  await assert.rejects(
    createResponsiveCover(source(new TextEncoder().encode('not an image'))),
    /decodable static image/,
  );
  await assert.rejects(
    createResponsiveCover(source(tiny), { maxVariantBytes: 1 }),
    /1 MiB variant limit/,
  );
});

test('responsive cover test budget cannot bypass the hard output limit', async () => {
  const input = source(await solidPng(8, 4));

  await assert.rejects(
    createResponsiveCover(input, {
      maxVariantBytes: MAX_COVER_VARIANT_BYTES + 1,
    }),
    /maxVariantBytes.*1 MiB variant limit/,
  );
});

test('responsive cover applies the output budget to cumulative variant bytes', async () => {
  const input = source(await stripedPng(500, 1, 11));
  const baseline = await createResponsiveCover(input);
  assert.equal(baseline.assets.length, 2);

  const firstVariantBytes = baseline.assets[0].bytes.byteLength;
  assert.ok(
    baseline.assets.every(({ bytes }) => bytes.byteLength <= firstVariantBytes),
    'fixture must keep every individual variant within the first-variant budget',
  );
  await assert.rejects(
    createResponsiveCover(input, { maxVariantBytes: firstVariantBytes }),
    /1 MiB variant limit/,
  );
});

test('responsive cover filenames hash the emitted WebP bytes', async () => {
  const result = await createResponsiveCover(source(await solidPng(1600, 900)));

  for (const asset of result.assets) {
    const expectedHash = createHash('sha256').update(asset.bytes).digest('hex');
    assert.equal(asset.hash, expectedHash);
    assert.equal(asset.filename, `${expectedHash}.webp`);
    const metadata = await sharp(asset.bytes).metadata();
    assert.equal(metadata.format, 'webp');
  }
});
