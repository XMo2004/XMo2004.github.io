import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Astro is configured as a static site at the GitHub Pages origin', async () => {
  const config = await readFile(new URL('../astro.config.mjs', import.meta.url), 'utf8');

  assert.match(config, /site:\s*['"]https:\/\/xmo2004\.github\.io['"]/);
  assert.match(config, /output:\s*['"]static['"]/);
});
