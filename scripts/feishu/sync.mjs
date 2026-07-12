import { randomUUID } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import {
  validateCategoryEntries,
  validateColumnEntries,
} from '../../src/lib/taxonomy.mjs';
import { contentAddressedMedia } from './assets.mjs';
import { blocksToMarkdown } from './blocks.mjs';
import { createFeishuClientFromEnv } from './client.mjs';
import {
  buildFeishuManifest,
  serializeFeishuManifest,
} from './manifest.mjs';
import {
  getPublicRecordFieldName,
  getPublicRecordRule,
  normalizeRecord,
} from './records.mjs';

const POSTS_RELATIVE_PATH = 'src/content/posts/feishu';
const MEDIA_RELATIVE_PATH = 'public/media/feishu';
const MANIFEST_RELATIVE_PATH = '.feishu-manifest.json';
const TRANSACTION_PREFIX = '.feishu-sync-';
const TRANSACTION_JOURNAL = 'journal.json';
const TRANSACTION_COMMITTED = 'committed';
const TRANSACTION_VERSION = 1;
const REQUIRED_ENVIRONMENT = [
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_BITABLE_APP_TOKEN',
  'FEISHU_BITABLE_TABLE_ID',
];
const SHANGHAI_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export const MAX_MEDIA_PER_ARTICLE = 30;
export const MAX_MEDIA_PER_SYNC = 500;
export const MAX_MEDIA_BYTES_PER_SYNC = 250 * 1024 * 1024;
export const PUBLIC_SYNC_FAILURE_PHASES = Object.freeze({
  'records-read': '多维表格读取',
  'records-validate': '发布字段校验',
  preflight: '手动文章与分类预检',
  build: '文档与素材生成',
  stage: '暂存文件写入',
  replace: '发布文件替换',
});
const syncFailurePhase = new WeakMap();
const recordValidationFields = new WeakMap();
const recordValidationRules = new WeakMap();

async function inSyncPhase(phase, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error) {
      syncFailurePhase.set(error, phase);
    }
    throw error;
  }
}

export function createMediaBudget({
  maxDistinct = MAX_MEDIA_PER_SYNC,
  maxBytes = MAX_MEDIA_BYTES_PER_SYNC,
} = {}) {
  if (!Number.isSafeInteger(maxDistinct) || maxDistinct < 1) {
    throw new Error('maxDistinct must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('maxBytes must be a positive safe integer.');
  }

  let distinct = 0;
  let bytes = 0;
  return Object.freeze({
    reserveDownload() {
      if (distinct >= maxDistinct) {
        throw new Error(`A sync may download at most ${maxDistinct} distinct media assets.`);
      }
      distinct += 1;
    },
    accountBytes(value) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('Downloaded media byte count must be a non-negative safe integer.');
      }
      if (bytes + value > maxBytes) {
        throw new Error(`A sync may download at most ${maxBytes} bytes of media.`);
      }
      bytes += value;
    },
  });
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

export function validateSyncEnvironment(env = process.env) {
  const missing = REQUIRED_ENVIRONMENT.filter(
    (name) => typeof env[name] !== 'string' || env[name].trim().length === 0,
  );
  if (missing.length > 0) {
    throw new Error(`Missing required Feishu environment variables: ${missing.join(', ')}.`);
  }
  return {
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
    appToken: env.FEISHU_BITABLE_APP_TOKEN,
    tableId: env.FEISHU_BITABLE_TABLE_ID,
  };
}

export function publicSyncFailureMessage(error) {
  const candidate =
    error instanceof Error ? syncFailurePhase.get(error) : undefined;
  const phase =
    typeof candidate === 'string' &&
    Object.hasOwn(PUBLIC_SYNC_FAILURE_PHASES, candidate)
      ? candidate
      : undefined;
  if (phase !== undefined) {
    const fields =
      phase === 'records-validate' && error instanceof Error
        ? recordValidationFields.get(error)
        : undefined;
    const fieldDetail =
      Array.isArray(fields) && fields.length > 0
        ? `; field: ${fields.join(',')}`
        : '';
    const rules =
      phase === 'records-validate' && error instanceof Error
        ? recordValidationRules.get(error)
        : undefined;
    const rule =
      Array.isArray(fields) && fields.length === 1 && rules instanceof Map
        ? rules.get(fields[0])
        : undefined;
    const ruleDetail = typeof rule === 'string' ? `; rule: ${rule}` : '';
    return `飞书同步失败 [${phase}: ${PUBLIC_SYNC_FAILURE_PHASES[phase]}${fieldDetail}${ruleDetail}]：错误详情已脱敏，请重试。`;
  }
  return '飞书同步失败：错误详情已脱敏。请检查飞书应用权限、博客文章字段和文档内容后重试。';
}

function normalizePublishedRecords(items) {
  if (!Array.isArray(items)) {
    throw new Error('Feishu published records response must be an array.');
  }

  const records = [];
  const issues = [];
  const publicFields = new Set();
  const publicRules = new Map();
  for (const [index, item] of items.entries()) {
    try {
      const record = normalizeRecord(item);
      if (record.status !== '已发布') {
        throw new Error(
          `record_id=${record.recordId} 的状态不是「已发布」，拒绝意外发布`,
        );
      }
      records.push(record);
    } catch (error) {
      const publicField = getPublicRecordFieldName(error);
      if (publicField !== undefined) {
        publicFields.add(publicField);
        const publicRule = getPublicRecordRule(error);
        if (publicRule !== undefined) {
          publicRules.set(publicField, publicRule);
        }
      }
      const recordId =
        typeof item?.record_id === 'string' && item.record_id.length > 0
          ? item.record_id
          : `index ${index}`;
      const message = error instanceof Error ? error.message : String(error);
      issues.push(message.includes(recordId) ? message : `${recordId}: ${message}`);
    }
  }

  const recordById = new Map();
  const recordBySlug = new Map();
  for (const record of records) {
    const duplicateId = recordById.get(record.recordId);
    if (duplicateId !== undefined) {
      issues.push(`Duplicate record id "${record.recordId}".`);
    } else {
      recordById.set(record.recordId, record);
    }

    const duplicateSlug = recordBySlug.get(record.slug);
    if (duplicateSlug !== undefined) {
      issues.push(
        `Duplicate slug "${record.slug}" for records "${duplicateSlug.recordId}" and "${record.recordId}".`,
      );
    } else {
      recordBySlug.set(record.slug, record);
    }
  }

  if (issues.length > 0) {
    const error = new Error(`Invalid Feishu publishing records:\n${issues.map((item) => `- ${item}`).join('\n')}`);
    if (publicFields.size > 0) {
      recordValidationFields.set(error, [...publicFields]);
    }
    if (publicRules.size > 0) {
      recordValidationRules.set(error, publicRules);
    }
    throw error;
  }
  return records.sort(
    (first, second) =>
      first.slug.localeCompare(second.slug, 'en') ||
      first.recordId.localeCompare(second.recordId, 'en'),
  );
}

async function markdownFiles(directory) {
  const files = [];

  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
        files.push(path);
      }
    }
  }

  await visit(directory);
  return files.sort((first, second) => first.localeCompare(second, 'en'));
}

async function manualPostMetadata(root) {
  const postsRoot = join(root, 'src/content/posts');
  const generatedRoot = join(postsRoot, 'feishu');
  const posts = [];

  for (const file of await markdownFiles(postsRoot)) {
    if (file === generatedRoot || file.startsWith(`${generatedRoot}${sep}`)) {
      continue;
    }
    const source = await readFile(file, 'utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
    const id = relative(postsRoot, file).split(sep).join('/');
    let metadata = {};
    if (frontmatter !== null) {
      let parsed;
      try {
        parsed = parseYaml(frontmatter[1]);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Manual post "${id}" has invalid YAML frontmatter: ${detail}`,
        );
      }
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        throw new Error(
          `Manual post "${id}" frontmatter must be a YAML mapping.`,
        );
      }
      metadata = parsed;
    }

    let explicitSlug;
    if (
      typeof metadata.slug === 'string' &&
      metadata.slug.length > 0
    ) {
      explicitSlug = metadata.slug;
    }
    const fallback = basename(file, extname(file));
    posts.push({
      id,
      file: relative(root, file),
      slug: explicitSlug ?? fallback,
      category: metadata.category,
      column: metadata.column,
      columnOrder: metadata.columnOrder,
    });
  }
  return posts;
}

function rejectManualSlugCollisions(manualPosts, records) {
  const manualPostBySlug = new Map(
    manualPosts.map((post) => [post.slug, post]),
  );
  const issues = [];
  for (const record of records) {
    const manualPost = manualPostBySlug.get(record.slug);
    if (manualPost !== undefined) {
      issues.push(
        `Generated slug "${record.slug}" for record "${record.recordId}" collides with manual post "${manualPost.file}".`,
      );
    }
  }
  if (issues.length > 0) {
    throw new Error(`Manual post route collisions:\n${issues.map((item) => `- ${item}`).join('\n')}`);
  }
}

function validateNextTaxonomy(manualPosts, records) {
  const entries = [
    ...manualPosts.map(({ id, category, column, columnOrder }) => ({
      id,
      category,
      column,
      columnOrder,
    })),
    ...records.map((record) => ({
      id: `feishu/${record.slug}.md`,
      category: record.category,
      column: record.column ?? undefined,
      columnOrder: record.columnOrder ?? undefined,
    })),
  ];

  validateCategoryEntries(entries);
  validateColumnEntries(entries);
}

function validateDocumentMetadata(document, record) {
  if (
    document === null ||
    typeof document !== 'object' ||
    !Number.isInteger(document.revision_id) ||
    document.revision_id < 1 ||
    typeof document.title !== 'string'
  ) {
    throw new Error(
      `record_id=${record.recordId} document "${record.documentId}" returned invalid metadata.`,
    );
  }
  if (
    document.document_id !== undefined &&
    document.document_id !== record.documentId
  ) {
    throw new Error(
      `record_id=${record.recordId} requested document "${record.documentId}" but received "${String(document.document_id)}".`,
    );
  }
  return document;
}

async function readStableDocument(client, record) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = validateDocumentMetadata(
      await client.getDocument(record.documentId),
      record,
    );
    const blocks = await client.listDocumentBlocks(record.documentId, -1);
    const after = validateDocumentMetadata(
      await client.getDocument(record.documentId),
      record,
    );
    if (before.revision_id === after.revision_id) {
      return { document: after, blocks, revisionId: after.revision_id };
    }
  }
  throw new Error(
    `Document "${record.documentId}" for record "${record.recordId}" changed twice during synchronization.`,
  );
}

function dateInShanghai(date) {
  const parts = Object.fromEntries(
    SHANGHAI_DATE.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function coverExtra(record) {
  const extra = record.cover?.extra;
  if (extra === undefined || extra === null) return undefined;
  if (typeof extra === 'string') return extra;
  if (typeof extra === 'object' && !Array.isArray(extra)) {
    return JSON.stringify(extra);
  }
  throw new Error(`record_id=${record.recordId} 的封面 extra 格式无效`);
}

function addAsset(assets, asset) {
  const existing = assets.get(asset.filename);
  if (
    existing !== undefined &&
    !Buffer.from(existing.bytes).equals(Buffer.from(asset.bytes))
  ) {
    throw new Error(`SHA-256 media filename collision for "${asset.filename}".`);
  }
  assets.set(asset.filename, asset);
}

function postFrontmatter(article) {
  return {
    title: article.title,
    description: article.description,
    pubDate: dateInShanghai(article.pubDate),
    tags: article.tags,
    category: article.category,
    ...(article.column === null
      ? {}
      : { column: article.column, columnOrder: article.columnOrder }),
    featured: article.featured,
    ...(article.cover === undefined ? {} : { cover: article.cover }),
    slug: article.slug,
  };
}

function renderPost(article) {
  const yaml = stringifyYaml(postFrontmatter(article), { lineWidth: 0 });
  return `---\n${yaml}---\n\n${article.markdown}`;
}

async function buildNextState(client, records) {
  const articles = [];
  const assets = new Map();
  const downloadCache = new Map();
  const warnings = [];
  const mediaBudget = createMediaBudget();

  async function download(fileToken, extra) {
    const cacheKey = `${fileToken}\u0000${extra ?? ''}`;
    let pending = downloadCache.get(cacheKey);
    if (pending === undefined) {
      mediaBudget.reserveDownload();
      pending = client
        .downloadMedia(fileToken, extra)
        .then((value) => contentAddressedMedia(value))
        .then((asset) => {
          mediaBudget.accountBytes(asset.bytes.byteLength);
          return asset;
        });
      downloadCache.set(cacheKey, pending);
    }
    return pending;
  }

  for (const record of records) {
    const stable = await readStableDocument(client, record);
    const converted = blocksToMarkdown(stable.blocks);
    let markdown = converted.markdown;
    const articleAssets = new Map();
    const articleMediaKeys = new Set(
      converted.mediaReferences.map(({ token }) => `${token}\u0000`),
    );
    const preparedCoverExtra =
      record.cover === null ? undefined : coverExtra(record);
    if (record.cover !== null) {
      articleMediaKeys.add(
        `${record.cover.file_token}\u0000${preparedCoverExtra ?? ''}`,
      );
    }
    if (articleMediaKeys.size > MAX_MEDIA_PER_ARTICLE) {
      throw new Error(
        `Article "${record.slug}" may reference at most ${MAX_MEDIA_PER_ARTICLE} distinct media assets.`,
      );
    }
    for (const reference of converted.mediaReferences) {
      const asset = await download(reference.token);
      addAsset(assets, asset);
      articleAssets.set(asset.filename, asset);
      markdown = markdown.replaceAll(reference.placeholder, asset.publicPath);
    }
    if (
      converted.mediaReferences.some(({ placeholder }) =>
        markdown.includes(placeholder),
      )
    ) {
      throw new Error(
        `record_id=${record.recordId} contains an unresolved Feishu media marker.`,
      );
    }

    let cover;
    if (record.cover !== null) {
      const asset = await download(
        record.cover.file_token,
        preparedCoverExtra,
      );
      addAsset(assets, asset);
      articleAssets.set(asset.filename, asset);
      cover = asset.publicPath;
    }

    const title = record.title ?? stable.document.title.trim();
    if (title.length === 0) {
      throw new Error(
        `record_id=${record.recordId} has no title in Bitable or document metadata.`,
      );
    }
    warnings.push(
      ...converted.warnings.map(({ type, language }) => ({
        slug: record.slug,
        type,
        ...(language === undefined ? {} : { language }),
      })),
    );
    articles.push({
      ...record,
      title,
      revisionId: stable.revisionId,
      markdown,
      cover,
      assets: [...articleAssets.values()],
    });
  }

  return { articles, assets, warnings };
}

async function writeStage({ articles, assets, manifest }) {
  const stageRoot = await mkdtemp(join(tmpdir(), 'feishu-blog-stage-'));
  const posts = join(stageRoot, 'posts');
  const media = join(stageRoot, 'media');
  const manifestPath = join(stageRoot, 'manifest.json');
  try {
    await mkdir(posts, { recursive: true });
    await mkdir(media, { recursive: true });

    if (articles.length === 0) {
      await writeFile(join(posts, '.gitkeep'), '');
    } else {
      for (const article of articles) {
        await writeFile(join(posts, `${article.slug}.md`), renderPost(article));
      }
    }

    if (assets.size === 0) {
      await writeFile(join(media, '.gitkeep'), '');
    } else {
      for (const [filename, asset] of [...assets.entries()].sort(
        ([first], [second]) => first.localeCompare(second, 'en'),
      )) {
        await writeFile(join(media, filename), asset.bytes);
      }
    }
    await writeFile(manifestPath, serializeFeishuManifest(manifest));
    return { stageRoot, posts, media, manifestPath };
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

async function fileMap(directory) {
  const files = new Map();

  let rootInfo;
  try {
    rootInfo = await lstat(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  if (!rootInfo.isDirectory()) {
    files.set('', { type: 'other' });
    return files;
  }
  files.set('', { type: 'directory' });

  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      const name = relative(directory, path);
      if (entry.isDirectory()) {
        files.set(name, { type: 'directory' });
        await visit(path);
      } else if (entry.isFile()) {
        files.set(name, { type: 'file', bytes: await readFile(path) });
      } else {
        files.set(name, { type: 'other' });
      }
    }
  }

  await visit(directory);
  return files;
}

function mapsEqual(first, second) {
  if (first === undefined || second === undefined || first.size !== second.size) {
    return false;
  }
  for (const [name, entry] of first) {
    const other = second.get(name);
    if (other === undefined || entry.type !== other.type) {
      return false;
    }
    if (
      entry.type === 'file' &&
      !Buffer.from(entry.bytes).equals(Buffer.from(other.bytes))
    ) {
      return false;
    }
  }
  return true;
}

async function fileEquals(first, second) {
  try {
    const [firstBytes, secondBytes] = await Promise.all([
      readFile(first),
      readFile(second),
    ]);
    return Buffer.from(firstBytes).equals(Buffer.from(secondBytes));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function outputsEqual(root, stage) {
  const [currentPosts, stagedPosts, currentMedia, stagedMedia, manifestEqual] =
    await Promise.all([
      fileMap(join(root, POSTS_RELATIVE_PATH)),
      fileMap(stage.posts),
      fileMap(join(root, MEDIA_RELATIVE_PATH)),
      fileMap(stage.media),
      fileEquals(join(root, MANIFEST_RELATIVE_PATH), stage.manifestPath),
    ]);
  return (
    mapsEqual(currentPosts, stagedPosts) &&
    mapsEqual(currentMedia, stagedMedia) &&
    manifestEqual
  );
}

function transactionOperations(overrides = {}) {
  const operations = {
    lstat,
    readFile,
    rename,
    rm,
    writeFile,
    ...overrides,
  };
  for (const name of ['lstat', 'readFile', 'rename', 'rm', 'writeFile']) {
    if (typeof operations[name] !== 'function') {
      throw new Error(`transactionOperations.${name} must be a function.`);
    }
  }
  return operations;
}

async function pathExists(path, operations) {
  try {
    await operations.lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function replacementEntries(root, transaction, stage) {
  return [
    {
      name: 'posts',
      target: join(root, POSTS_RELATIVE_PATH),
      incoming: join(transaction, 'next-posts'),
      backup: join(transaction, 'previous-posts'),
      source: stage?.posts,
    },
    {
      name: 'media',
      target: join(root, MEDIA_RELATIVE_PATH),
      incoming: join(transaction, 'next-media'),
      backup: join(transaction, 'previous-media'),
      source: stage?.media,
    },
    {
      name: 'manifest',
      target: join(root, MANIFEST_RELATIVE_PATH),
      incoming: join(transaction, 'next-manifest.json'),
      backup: join(transaction, 'previous-manifest.json'),
      source: stage?.manifestPath,
    },
  ];
}

async function readTransactionJournal(transaction, operations) {
  const path = join(transaction, TRANSACTION_JOURNAL);
  let source;
  try {
    source = await operations.readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  let journal;
  try {
    journal = JSON.parse(source);
  } catch {
    throw new Error(`Interrupted Feishu transaction "${transaction}" has an invalid journal.`);
  }
  if (
    journal?.version !== TRANSACTION_VERSION ||
    journal.hadPrevious === null ||
    typeof journal.hadPrevious !== 'object' ||
    !['posts', 'media', 'manifest'].every(
      (name) => typeof journal.hadPrevious[name] === 'boolean',
    )
  ) {
    throw new Error(`Interrupted Feishu transaction "${transaction}" has an invalid journal.`);
  }
  return journal;
}

async function recoverTransaction(root, transaction, operations) {
  if (
    await pathExists(join(transaction, TRANSACTION_COMMITTED), operations)
  ) {
    await operations.rm(transaction, { recursive: true, force: true });
    return;
  }

  const journal = await readTransactionJournal(transaction, operations);
  if (journal === undefined) {
    await operations.rm(transaction, { recursive: true, force: true });
    return;
  }

  for (const entry of replacementEntries(root, transaction).reverse()) {
    if (await pathExists(entry.backup, operations)) {
      await operations.rm(entry.target, { recursive: true, force: true });
      await operations.rename(entry.backup, entry.target);
    } else if (!journal.hadPrevious[entry.name]) {
      await operations.rm(entry.target, { recursive: true, force: true });
    }
  }
  await operations.rm(transaction, { recursive: true, force: true });
}

export async function recoverInterruptedTransactions(
  root,
  { transactionOperations: overrides } = {},
) {
  const workspaceRoot = resolve(requiredString(root, 'root'));
  const operations = transactionOperations(overrides);
  const entries = await readdir(workspaceRoot, { withFileTypes: true });
  const transactions = entries
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith(TRANSACTION_PREFIX),
    )
    .map((entry) => join(workspaceRoot, entry.name))
    .sort((first, second) => first.localeCompare(second, 'en'));
  for (const transaction of transactions) {
    await recoverTransaction(workspaceRoot, transaction, operations);
  }
}

async function replaceOutputs(root, stage, operations) {
  const transaction = join(root, `${TRANSACTION_PREFIX}${randomUUID()}`);
  await mkdir(transaction, { recursive: false });
  const entries = replacementEntries(root, transaction, stage);
  let journalPrepared = false;
  let committed = false;

  try {
    await cp(entries[0].source, entries[0].incoming, { recursive: true });
    await cp(entries[1].source, entries[1].incoming, { recursive: true });
    await cp(entries[2].source, entries[2].incoming);
    for (const entry of entries) {
      await mkdir(dirname(entry.target), { recursive: true });
    }

    const hadPrevious = Object.fromEntries(
      await Promise.all(
        entries.map(async (entry) => [
          entry.name,
          await pathExists(entry.target, operations),
        ]),
      ),
    );
    await operations.writeFile(
      join(transaction, TRANSACTION_JOURNAL),
      `${JSON.stringify({ version: TRANSACTION_VERSION, hadPrevious }, null, 2)}\n`,
    );
    journalPrepared = true;

    for (const entry of entries) {
      if (hadPrevious[entry.name]) {
        await operations.rename(entry.target, entry.backup);
      }
      await operations.rename(entry.incoming, entry.target);
    }
    await operations.writeFile(join(transaction, TRANSACTION_COMMITTED), '');
    committed = true;
    await operations.rm(transaction, { recursive: true, force: true });
  } catch (error) {
    try {
      if (committed) {
        await operations.rm(transaction, { recursive: true, force: true });
        return;
      }
      if (journalPrepared) {
        await recoverTransaction(root, transaction, operations);
      } else {
        await operations.rm(transaction, { recursive: true, force: true });
      }
    } catch (recoveryError) {
      throw new AggregateError(
        [error, recoveryError],
        `Feishu output replacement failed and recovery data was preserved at "${transaction}".`,
      );
    }
    throw error;
  }
}

export async function syncFeishu({
  root,
  client,
  appToken,
  tableId,
  transactionOperations: operationOverrides,
} = {}) {
  const workspaceRoot = resolve(requiredString(root, 'root'));
  requiredString(appToken, 'appToken');
  requiredString(tableId, 'tableId');
  for (const method of [
    'listPublishedRecords',
    'getDocument',
    'listDocumentBlocks',
    'downloadMedia',
  ]) {
    if (typeof client?.[method] !== 'function') {
      throw new Error(`client.${method} must be a function.`);
    }
  }

  const operations = transactionOperations(operationOverrides);
  await inSyncPhase('replace', () =>
    recoverInterruptedTransactions(workspaceRoot, {
      transactionOperations: operations,
    }),
  );

  const rawRecords = await inSyncPhase('records-read', () =>
    client.listPublishedRecords(appToken, tableId),
  );
  const records = await inSyncPhase('records-validate', async () =>
    normalizePublishedRecords(rawRecords),
  );
  await inSyncPhase('preflight', async () => {
    const manualPosts = await manualPostMetadata(workspaceRoot);
    rejectManualSlugCollisions(manualPosts, records);
    validateNextTaxonomy(manualPosts, records);
  });
  const next = await inSyncPhase('build', () =>
    buildNextState(client, records),
  );
  const stage = await inSyncPhase('stage', async () => {
    const manifest = buildFeishuManifest(next.articles);
    return writeStage({ ...next, manifest });
  });

  try {
    const changed = !(await inSyncPhase('stage', () =>
      outputsEqual(workspaceRoot, stage),
    ));
    if (changed) {
      await inSyncPhase('replace', () =>
        replaceOutputs(workspaceRoot, stage, operations),
      );
    }
    return {
      changed,
      postCount: next.articles.length,
      assetCount: next.assets.size,
      warnings: next.warnings,
    };
  } finally {
    await inSyncPhase('stage', () =>
      rm(stage.stageRoot, { recursive: true, force: true }),
    );
  }
}

export async function runSyncFromEnv({
  env = process.env,
  root = process.cwd(),
  ...clientOptions
} = {}) {
  const configuration = validateSyncEnvironment(env);
  const client = createFeishuClientFromEnv({ env, ...clientOptions });
  return syncFeishu({
    root,
    client,
    appToken: configuration.appToken,
    tableId: configuration.tableId,
  });
}

const invokedPath = process.argv[1];
if (
  typeof invokedPath === 'string' &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  try {
    const result = await runSyncFromEnv();
    console.log(
      result.changed
        ? `飞书同步完成：${result.postCount} 篇文章，${result.assetCount} 个素材。`
        : `飞书内容无变化：${result.postCount} 篇文章。`,
    );
    for (const warning of result.warnings) {
      console.warn(`飞书转换提示：${JSON.stringify(warning)}`);
    }
  } catch (error) {
    console.error(publicSyncFailureMessage(error));
    process.exitCode = 1;
  }
}
