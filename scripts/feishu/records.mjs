import { documentIdFromUrl, validateSlug } from './ids.mjs';

const PUBLISHING_STATUSES = new Set(['草稿', '已发布', '已下线']);
const FILE_TOKEN = /^[A-Za-z0-9_-]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PUBLIC_RECORD_FIELDS = new Set([
  '标题',
  '文档链接',
  '精选',
  '状态',
  '标签',
  '分类',
  '专栏序号',
  '专栏',
  '摘要',
  'Slug',
  '封面',
  '发布日期',
]);
const publicFieldByError = new WeakMap();

function fieldError(recordId, fieldName, detail) {
  const error = new Error(`record_id=${recordId} 的字段「${fieldName}」${detail}`);
  if (PUBLIC_RECORD_FIELDS.has(fieldName)) {
    publicFieldByError.set(error, fieldName);
  }
  return error;
}

export function getPublicRecordFieldName(error) {
  return error instanceof Error ? publicFieldByError.get(error) : undefined;
}

function requireRecordId(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('record_id 必须是非空字符串');
  }
  return value;
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

function normalizeSingleSelect(
  value,
  recordId,
  fieldName,
  { optional = false } = {},
) {
  if (value == null && optional) {
    return null;
  }
  if (typeof value !== 'string') {
    throw fieldError(recordId, fieldName, '不能为空且必须是单选文本');
  }

  const normalized = value.trim();
  if (!normalized) {
    if (optional) {
      return null;
    }
    throw fieldError(recordId, fieldName, '不能为空');
  }
  return normalized;
}

function normalizeColumnOrder(value, recordId) {
  if (value == null) {
    return null;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw fieldError(recordId, '专栏序号', '必须是正安全整数');
  }
  return value;
}

function normalizeDate(value, recordId) {
  let date;
  if (value instanceof Date) {
    date = new Date(value.getTime());
  } else if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value)
  ) {
    date = new Date(value);
  } else if (typeof value === 'string' && ISO_DATE.test(value)) {
    date = new Date(`${value}T00:00:00.000Z`);
    if (
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) !== value
    ) {
      throw fieldError(recordId, '发布日期', '格式无效');
    }
  } else if (typeof value === 'string' && ISO_TIMESTAMP.test(value)) {
    date = new Date(value);
    if (!Number.isNaN(date.getTime()) && date.toISOString() !== value) {
      throw fieldError(recordId, '发布日期', '格式无效');
    }
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
  const fileToken = attachment?.file_token;
  if (
    attachment === null ||
    typeof attachment !== 'object' ||
    typeof fileToken !== 'string' ||
    fileToken !== fileToken.trim() ||
    !FILE_TOKEN.test(fileToken)
  ) {
    throw fieldError(recordId, '封面', '格式无效');
  }

  return {
    file_token: fileToken,
    name: attachment.name,
    type: attachment.type,
    extra: structuredClone(attachment.extra),
    url: attachment.url,
  };
}

export function normalizeRecord(record) {
  const recordId = requireRecordId(record?.record_id);
  const fields =
    record?.fields !== null && typeof record?.fields === 'object'
      ? record.fields
      : {};
  const { documentUrl, documentId } = normalizeDocument(
    fields.文档链接,
    recordId,
  );
  const category = normalizeSingleSelect(fields.分类, recordId, '分类');
  const column = normalizeSingleSelect(fields.专栏, recordId, '专栏', {
    optional: true,
  });
  const columnOrder = normalizeColumnOrder(fields.专栏序号, recordId);

  if (column !== null && columnOrder === null) {
    throw fieldError(recordId, '专栏序号', '必须与「专栏」同时填写');
  }
  if (column === null && columnOrder !== null) {
    throw fieldError(recordId, '专栏', '必须与「专栏序号」同时填写');
  }

  return {
    recordId,
    title: normalizeText(fields.标题, recordId, '标题', { optional: true }),
    documentUrl,
    documentId,
    slug: normalizeSlug(fields.Slug, recordId),
    description: normalizeText(fields.摘要, recordId, '摘要'),
    tags: normalizeTags(fields.标签, recordId),
    category,
    column,
    columnOrder,
    pubDate: normalizeDate(fields.发布日期, recordId),
    status: normalizeStatus(fields.状态, recordId),
    featured: normalizeFeatured(fields.精选, recordId),
    cover: normalizeCover(fields.封面, recordId),
  };
}
