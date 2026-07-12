const TRUSTED_DOCUMENT_HOST = /^(?:[a-z0-9-]+\.)+(?:feishu\.cn|larksuite\.com)$/i;
const DOCUMENT_PATH = /^\/docx\/([A-Za-z0-9]+)\/?$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function documentIdFromUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error('文档 URL 格式无效');
  }

  const pathMatch = DOCUMENT_PATH.exec(url.pathname);
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    !TRUSTED_DOCUMENT_HOST.test(url.hostname) ||
    !pathMatch
  ) {
    throw new Error('文档 URL 必须是可信的 Feishu 或 LarkSuite docx 链接');
  }

  return pathMatch[1];
}

export function validateSlug(value) {
  if (typeof value !== 'string' || !SLUG.test(value)) {
    throw new Error('Slug 必须使用小写字母、数字和单个连字符');
  }

  return value;
}
