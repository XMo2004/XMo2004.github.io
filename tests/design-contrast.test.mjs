import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MINIMUM_CONTRAST = 4.5;

function readTokens(block) {
  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(
      ([, name, value]) => [name, value.toLowerCase()],
    ),
  );
}

function relativeLuminance(hexColor) {
  const channels = hexColor
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(firstColor, secondColor) {
  const firstLuminance = relativeLuminance(firstColor);
  const secondLuminance = relativeLuminance(secondColor);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

test('semantic accent text tokens meet WCAG AA on every paper surface', async () => {
  const source = await readFile(
    new URL('../src/styles/global.css', import.meta.url),
    'utf8',
  );
  const lightBlock = source.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const darkBlock =
    source.match(/:root\[data-theme=['"]dark['"]\]\s*\{([\s\S]*?)\}/)?.[1] ??
    '';
  const themes = {
    light: readTokens(lightBlock),
    dark: readTokens(darkBlock),
  };
  const expectedAccents = {
    light: {
      'accent-text': '#9f422e',
      'accent-hover': '#566444',
    },
    dark: {
      'accent-text': '#e27a5f',
      'accent-hover': '#a8b98c',
    },
  };

  for (const [themeName, tokens] of Object.entries(themes)) {
    for (const [tokenName, expectedColor] of Object.entries(
      expectedAccents[themeName],
    )) {
      const foreground = tokens[tokenName];

      assert.equal(
        foreground,
        expectedColor,
        `${themeName} --${tokenName} must use the approved semantic color`,
      );

      for (const surfaceName of ['paper', 'paper-raised']) {
        const background = tokens[surfaceName];
        const ratio = contrastRatio(foreground, background);

        assert.ok(
          ratio >= MINIMUM_CONTRAST,
          `${themeName} --${tokenName} contrast on --${surfaceName} is ${ratio.toFixed(2)}:1`,
        );
      }
    }
  }
});
