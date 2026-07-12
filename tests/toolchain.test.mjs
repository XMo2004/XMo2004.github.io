import assert from 'node:assert/strict';
import test from 'node:test';

test('Astro is configured as a static site at the GitHub Pages origin', async () => {
  const { default: config } = await import(new URL('../astro.config.mjs', import.meta.url));
  const expectedSite = new URL('https://xmo2004.github.io');

  if (config.site instanceof URL) {
    assert.equal(config.site.href, expectedSite.href);
  } else {
    assert.equal(config.site, expectedSite.origin);
  }

  assert.equal(config.output, 'static');
});
