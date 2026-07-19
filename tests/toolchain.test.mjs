import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SITE } from '../src/config/site.ts';

test('test script explicitly enables TypeScript stripping on the minimum Node version', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );

  assert.equal(packageJson.engines.node, '>=22.12.0');
  assert.equal(
    packageJson.scripts.test,
    'node --experimental-strip-types --test tests/*.test.mjs',
  );
});

test('Astro is configured as a static site at the GitHub Pages origin', async () => {
  const { default: config } = await import(new URL('../astro.config.mjs', import.meta.url));
  const expectedSite = new URL(SITE.canonicalOrigin);

  if (config.site instanceof URL) {
    assert.equal(config.site.href, expectedSite.href);
  } else {
    assert.equal(config.site, expectedSite.origin);
  }

  assert.equal(config.output, 'static');
});

test('KaTeX is an exact production dependency in package and lock files', async () => {
  const [packageJson, packageLock] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../package-lock.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);

  assert.equal(packageJson.dependencies.katex, '0.17.0');
  assert.equal(packageJson.devDependencies?.katex, undefined);
  assert.equal(packageLock.packages[''].dependencies.katex, '0.17.0');
  assert.equal(packageLock.packages['node_modules/katex'].version, '0.17.0');
});
