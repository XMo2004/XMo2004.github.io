import sharp from 'sharp';

import { contentAddressedMedia } from './assets.mjs';

export const COVER_WIDTHS = Object.freeze([320, 640, 960, 1440]);
export const MAX_COVER_SOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_COVER_PIXELS = 24_000_000;
export const MAX_COVER_VARIANT_BYTES = 1024 * 1024;

const WEBP_OPTIONS = Object.freeze({
  quality: 78,
  effort: 4,
  smartSubsample: true,
});

function positiveBudget(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}

function orientedDimensions(metadata) {
  const width = metadata.autoOrient?.width ?? metadata.width;
  const height = metadata.autoOrient?.height ?? metadata.height;
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new Error('Cover must expose positive integer dimensions.');
  }
  if (metadata.autoOrient !== undefined) return { width, height };
  return [5, 6, 7, 8].includes(metadata.orientation)
    ? { width: height, height: width }
    : { width, height };
}

async function readCoverMetadata(bytes) {
  try {
    return await sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: MAX_COVER_PIXELS,
      sequentialRead: true,
    }).metadata();
  } catch {
    throw new Error('Cover must be a decodable static image within the 24 MP pixel limit.');
  }
}

export async function createResponsiveCover(
  { bytes } = {},
  { maxVariantBytes = MAX_COVER_VARIANT_BYTES } = {},
) {
  positiveBudget(maxVariantBytes, 'maxVariantBytes');
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('Cover source bytes must be a Uint8Array.');
  }
  if (bytes.byteLength === 0) {
    throw new Error('Cover source must not be empty.');
  }
  if (bytes.byteLength > MAX_COVER_SOURCE_BYTES) {
    throw new Error('Cover exceeds the 5 MiB source limit.');
  }

  const metadata = await readCoverMetadata(bytes);
  if ((metadata.pages ?? 1) !== 1 || metadata.format === 'svg' || metadata.format === 'pdf') {
    throw new Error('Cover must be a static image.');
  }
  const dimensions = orientedDimensions(metadata);
  if (dimensions.width * dimensions.height > MAX_COVER_PIXELS) {
    throw new Error('Cover exceeds the 24 MP pixel limit.');
  }

  const finalWidth = Math.min(dimensions.width, COVER_WIDTHS.at(-1));
  const widths = [...new Set([
    ...COVER_WIDTHS.filter((width) => width < finalWidth),
    finalWidth,
  ])];
  const generated = [];
  let generatedBytes = 0;

  for (const width of widths) {
    let output;
    try {
      output = await sharp(bytes, {
        failOn: 'warning',
        limitInputPixels: MAX_COVER_PIXELS,
        sequentialRead: true,
      })
        .autoOrient()
        .resize({ width, withoutEnlargement: true })
        .webp(WEBP_OPTIONS)
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new Error('Cover WebP conversion failed.');
    }
    if (output.info.format !== 'webp') {
      throw new Error('Cover WebP conversion returned an unexpected format.');
    }
    generatedBytes += output.data.byteLength;
    if (generatedBytes > maxVariantBytes) {
      throw new Error('Cover exceeds the 1 MiB variant limit.');
    }
    const asset = contentAddressedMedia({
      bytes: output.data,
      contentType: 'image/webp',
    });
    generated.push({
      asset,
      width: output.info.width,
      height: output.info.height,
    });
  }

  const largest = generated.at(-1);
  return Object.freeze({
    cover: Object.freeze({
      src: largest.asset.publicPath,
      width: largest.width,
      height: largest.height,
      variants: Object.freeze(
        generated.map(({ asset, width }) => Object.freeze({
          src: asset.publicPath,
          width,
        })),
      ),
    }),
    assets: Object.freeze(generated.map(({ asset }) => asset)),
  });
}
