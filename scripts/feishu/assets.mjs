import { createHash } from 'node:crypto';

const EXTENSIONS = new Map([
  ['image/avif', 'avif'],
  ['image/bmp', 'bmp'],
  ['image/gif', 'gif'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/svg+xml', 'svg'],
  ['image/webp', 'webp'],
  ['image/x-icon', 'ico'],
  ['image/vnd.microsoft.icon', 'ico'],
]);

function normalizedContentType(value) {
  if (typeof value !== 'string') {
    throw new Error('Media Content-Type must be a string.');
  }
  const contentType = value.split(';', 1)[0].trim().toLowerCase();
  if (!EXTENSIONS.has(contentType)) {
    throw new Error(`Unsupported media Content-Type "${contentType || '<empty>'}".`);
  }
  return contentType;
}

function normalizedBytes(value) {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  throw new Error('Media bytes must be a Uint8Array or ArrayBuffer.');
}

export function contentAddressedMedia({ bytes: input, contentType: inputType } = {}) {
  const bytes = normalizedBytes(input);
  if (bytes.byteLength === 0) {
    throw new Error('Media download is empty.');
  }
  const contentType = normalizedContentType(inputType);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const filename = `${hash}.${EXTENSIONS.get(contentType)}`;

  return Object.freeze({
    hash,
    filename,
    publicPath: `/media/feishu/${filename}`,
    contentType,
    bytes,
  });
}
