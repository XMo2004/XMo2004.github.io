export const FEISHU_MANIFEST_VERSION = 1;

export function buildFeishuManifest(articles) {
  const records = [...articles]
    .sort(
      (first, second) =>
        first.slug.localeCompare(second.slug, 'en') ||
        first.recordId.localeCompare(second.recordId, 'en'),
    )
    .map((article) => ({
      recordId: article.recordId,
      documentId: article.documentId,
      revisionId: article.revisionId,
      slug: article.slug,
      assets: [...article.assets]
        .sort((first, second) => first.filename.localeCompare(second.filename, 'en'))
        .map(({ hash, filename }) => ({ hash, filename })),
    }));

  return { version: FEISHU_MANIFEST_VERSION, records };
}

export function serializeFeishuManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
