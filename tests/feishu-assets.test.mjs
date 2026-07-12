import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_MEDIA_BYTES,
  contentAddressedMedia,
} from '../scripts/feishu/assets.mjs';

test('media assets reject executable SVG content types', () => {
  for (const contentType of ['image/svg+xml', 'IMAGE/SVG+XML; charset=utf-8']) {
    assert.throws(
      () => contentAddressedMedia({ bytes: new Uint8Array([1]), contentType }),
      /unsupported.*content-type/i,
    );
  }
});

test('media assets enforce the single-file byte limit at the boundary', () => {
  assert.doesNotThrow(() =>
    contentAddressedMedia({
      bytes: new Uint8Array(MAX_MEDIA_BYTES),
      contentType: 'image/png',
    }),
  );
  assert.throws(
    () =>
      contentAddressedMedia({
        bytes: new Uint8Array(MAX_MEDIA_BYTES + 1),
        contentType: 'image/png',
      }),
    /media.*10 mib|media.*limit/i,
  );
});
