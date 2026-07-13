import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const postsDirectory = fileURLToPath(
  new URL('../src/content/posts/', import.meta.url),
);

async function walkMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return walkMarkdownFiles(entryPath);
      }

      return entry.isFile() && entry.name.toLowerCase().endsWith('.md')
        ? [entryPath]
        : [];
    }),
  );

  return files.flat();
}

function parseFrontmatter(source, filePath) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const relativePath = path.relative(postsDirectory, filePath);

  assert.ok(match, `${relativePath} must start with a frontmatter block`);
  return parse(match[1]);
}

test('all posts have slugs and only the designated post is featured', async () => {
  const featuredSlugs = [];

  for (const filePath of await walkMarkdownFiles(postsDirectory)) {
    const source = await readFile(filePath, 'utf8');
    const frontmatter = parseFrontmatter(source, filePath);
    const relativePath = path.relative(postsDirectory, filePath);

    assert.ok(
      typeof frontmatter?.slug === 'string' && frontmatter.slug.trim().length > 0,
      `${relativePath} must have a non-empty string slug`,
    );

    if (frontmatter.featured === true) {
      featuredSlugs.push(frontmatter.slug);
    }
  }

  assert.deepEqual(featuredSlugs.sort(), ['published-from-feishu']);
});
