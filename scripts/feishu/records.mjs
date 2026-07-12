import { documentIdFromUrl, validateSlug } from './ids.mjs';

const PUBLISHING_STATUSES = new Set(['草稿', '已发布', '已下线']);

function fieldError(recordId, fieldName, detail) {
  return new Error(`record_id=${recordId} 的字段「${fieldName}」${detail}`);
}

function normalizeText(value, recordId, fieldName, { optional = false } = {}) {
  if (value == null && optional) {
    return null;
  }

  let text;
  if (typeof value === 'string') {
    text = value;
  } else if (
    Array.isArray(value) &&
    value.every(
      (part) =>
        part !== null &&
        typeof part === 'object' &&
        part.type === 'text' &&
        typeof part.text === 'string',
    )
  ) {
    text = value.map((part) => part.text).join('');
  } else {
    throw fieldError(recordId, fieldName, '格式无效');
  }

  const normalized = text.trim();
  if (!normalized) {
    if (optional) {
      return null;
    }
    throw fieldError(recordId, fieldName, '不能为空');
  }

  return normalized;
}

function normalizeDocument(value, recordId) {
  const documentUrl =
    typeof value === 'string'
      ? value.trim()
      : value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          typeof value.link === 'string'
        ? value.link.trim()
        : '';

  if (!documentUrl) {
    throw fieldError(recordId, '文档链接', '不能为空或格式无效');
  }

  try {
    return {
      documentUrl,
      documentId: documentIdFromUrl(documentUrl),
    };
  } catch {
    throw fieldError(
      recordId,
      '文档链接',
      '必须是可信的 HTTPS Feishu 或 LarkSuite docx 链接',
    );
  }
}

function normalizeSlug(value, recordId) {
  try {
    return validateSlug(value);
  } catch {
    throw fieldError(recordId, 'Slug', '格式无效');
  }
}

function normalizeTags(value, recordId) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw fieldError(recordId, '标签', '格式无效');
  }

  const tags = value.map((tag) => {
    if (typeof tag === 'string') {
      return tag.trim();
    }
    if (
      tag !== null &&
      typeof tag === 'object' &&
      typeof tag.text === 'string'
    ) {
      return tag.text.trim();
    }
    throw fieldError(recordId, '标签', '格式无效');
  });

  return [...new Set(tags.filter(Boolean))];
}

function normalizeDate(value, recordId) {
  let date;
  if (value instanceof Date) {
    date = new Date(value.getTime());
  } else if (
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.trim())
  ) {
    date = new Date(value);
  } else {
    throw fieldError(recordId, '发布日期', '不能为空或格式无效');
  }

  if (Number.isNaN(date.getTime())) {
    throw fieldError(recordId, '发布日期', '格式无效');
  }

  return date;
}

function normalizeStatus(value, recordId) {
  if (typeof value !== 'string' || !PUBLISHING_STATUSES.has(value)) {
    throw fieldError(recordId, '状态', '不能为空或格式无效');
  }
  return value;
}

function normalizeFeatured(value, recordId) {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw fieldError(recordId, '精选', '必须是布尔值');
  }
  return value;
}

function normalizeCover(value, recordId) {
  if (value == null || (Array.isArray(value) && value.length === 0)) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw fieldError(recordId, '封面', '格式无效');
  }

  const attachment = value[0];
  if (
    attachment === null ||
    typeof attachment !== 'object' ||
    typeof attachment.file_token !== 'string' ||
    !attachment.file_token
  ) {
    throw fieldError(recordId, '封面', '格式无效');
  }

  return {
    file_token: attachment.file_token,
    name: attachment.name,
    type: attachment.type,
    extra: structuredClone(attachment.extra),
    url: attachment.url,
  };
}

export function normalizeRecord(record) {
  const recordId = record?.record_id ?? '<missing>';
  const fields =
    record?.fields !== null && typeof record?.fields === 'object'
      ? record.fields
      : {};
  const { documentUrl, documentId } = normalizeDocument(
    fields.文档链接,
    recordId,
  );

  return {
    recordId,
    title: normalizeText(fields.标题, recordId, '标题', { optional: true }),
    documentUrl,
    documentId,
    slug: normalizeSlug(fields.Slug, recordId),
    description: normalizeText(fields.摘要, recordId, '摘要'),
    tags: normalizeTags(fields.标签, recordId),
    pubDate: normalizeDate(fields.发布日期, recordId),
    status: normalizeStatus(fields.状态, recordId),
    featured: normalizeFeatured(fields.精选, recordId),
    cover: normalizeCover(fields.封面, recordId),
  };
}
