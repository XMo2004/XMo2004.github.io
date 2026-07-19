import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MINIMUM_CONTRAST = 4.5;
const fontColors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
const fontBackgrounds = [
  'light-red',
  'light-orange',
  'light-yellow',
  'light-green',
  'light-blue',
  'light-purple',
  'medium-gray',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'gray',
  'light-gray',
];
const calloutBackgrounds = [
  'light-red',
  'light-orange',
  'light-yellow',
  'light-green',
  'light-blue',
  'light-purple',
  'medium-gray',
  'medium-red',
  'medium-orange',
  'medium-yellow',
  'medium-green',
  'medium-blue',
  'medium-purple',
  'gray',
  'light-gray',
];

function readTokens(block) {
  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)].map(
      ([, name, value]) => [
        name,
        value.trim().replace(/\s+/g, ' ').toLowerCase(),
      ],
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

function themeTokens(source) {
  const lightBlock = source.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const darkBlock =
    source.match(/:root\[data-theme=['"]dark['"]\]\s*\{([\s\S]*?)\}/)?.[1] ??
    '';
  return {
    light: readTokens(lightBlock),
    dark: readTokens(darkBlock),
  };
}

function assertContrast(tokens, themeName, foregroundName, backgroundName, context) {
  const foreground = tokens[foregroundName];
  const background = tokens[backgroundName];

  assert.ok(foreground, `${themeName} --${foregroundName} must be defined`);
  assert.ok(background, `${themeName} --${backgroundName} must be defined`);

  const ratio = contrastRatio(foreground, background);
  assert.ok(
    ratio >= MINIMUM_CONTRAST,
    `${context}: ${themeName} --${foregroundName} on --${backgroundName} is ${ratio.toFixed(2)}:1`,
  );
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

test('soft paper hierarchy uses approved colors and meets WCAG AA', async () => {
  const source = await readFile(
    new URL('../src/styles/global.css', import.meta.url),
    'utf8',
  );
  const themes = themeTokens(source);
  const expectedPaperHierarchy = {
    light: {
      'paper-soft': '#f8f4ec',
      'paper-interactive': '#eee8dd',
    },
    dark: {
      'paper-soft': '#1c201c',
      'paper-interactive': '#252a25',
    },
  };

  for (const [themeName, tokens] of Object.entries(themes)) {
    for (const [tokenName, expectedColor] of Object.entries(
      expectedPaperHierarchy[themeName],
    )) {
      assert.equal(
        tokens[tokenName],
        expectedColor,
        `${themeName} --${tokenName} must use the approved paper color`,
      );
    }

    for (const foregroundName of [
      'ink',
      'muted',
      'accent-text',
      'accent-hover',
    ]) {
      for (const backgroundName of ['paper-soft', 'paper-interactive']) {
        assertContrast(
          tokens,
          themeName,
          foregroundName,
          backgroundName,
          'soft paper hierarchy',
        );
      }
    }
  }

  assert.equal(
    themes.light['shadow-header'],
    '0 0.35rem 1rem rgb(29 33 29 / 4%)',
    'light --shadow-header must use the approved subtle shadow',
  );
  assert.equal(
    themes.dark['shadow-header'],
    '0 0.35rem 1rem rgb(0 0 0 / 10%)',
    'dark --shadow-header must use the approved subtle shadow',
  );
});

test('Feishu foreground, background, callout, link, and quote matrices meet WCAG AA', async () => {
  const [globalSource, feishuSource] = await Promise.all([
    readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles/feishu-content.css', import.meta.url), 'utf8').catch(
      () => '',
    ),
  ]);
  const globalThemes = themeTokens(globalSource);
  const feishuThemes = themeTokens(feishuSource);

  for (const themeName of ['light', 'dark']) {
    const tokens = {
      ...globalThemes[themeName],
      ...feishuThemes[themeName],
    };
    const foregroundTokens = fontColors.map((token) => `feishu-fg-${token}`);
    const textBackgroundTokens = fontBackgrounds.map(
      (token) => `feishu-font-bg-${token}`,
    );
    const calloutBackgroundTokens = calloutBackgrounds.map(
      (token) => `feishu-callout-bg-${token}`,
    );

    for (const foregroundName of foregroundTokens) {
      for (const backgroundName of textBackgroundTokens) {
        assertContrast(
          tokens,
          themeName,
          foregroundName,
          backgroundName,
          'explicit Feishu text and background',
        );
        assertContrast(
          tokens,
          themeName,
          foregroundName,
          backgroundName,
          'Callout inline background and inherited link/quote text',
        );
      }

      assertContrast(
        tokens,
        themeName,
        foregroundName,
        'paper',
        'text-color-only body content',
      );

      for (const backgroundName of calloutBackgroundTokens) {
        assertContrast(
          tokens,
          themeName,
          foregroundName,
          backgroundName,
          'explicit Callout text and inherited link',
        );
      }
    }

    for (const backgroundName of textBackgroundTokens) {
      assertContrast(
        tokens,
        themeName,
        'ink',
        backgroundName,
        'background-only inline and inherited link',
      );
      assertContrast(
        tokens,
        themeName,
        'ink',
        backgroundName,
        'ordinary or SourceSynced quote inline background',
      );
    }

    for (const backgroundName of calloutBackgroundTokens) {
      assertContrast(
        tokens,
        themeName,
        'ink',
        backgroundName,
        'default Callout text and inherited link',
      );
    }
  }
});
