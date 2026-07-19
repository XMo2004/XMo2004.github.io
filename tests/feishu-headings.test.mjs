import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import { extractFeishuHeadings } from '../src/lib/feishu-headings.ts';

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function heading(depth, index, text, visible = text) {
  return `<h${depth} id="feishu-heading-${index}" data-feishu-heading-text="${encodeBase64Url(text)}">${visible}</h${depth}>`;
}

function equation(source) {
  return `<span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="${encodeBase64Url(source)}"><span class="katex">rendered</span></span>`;
}

function controlled(body) {
  return `<div class="feishu-document">${body}</div>`;
}

function controlledHeadingDocument() {
  return controlled([
    heading(2, 1, '标题 x + y', `标题 ${equation('x + y')}`),
    heading(3, 2, '重复标题'),
  ].join(''));
}

test('returns undefined for ordinary Markdown and controlled headings in order', () => {
  assert.equal(extractFeishuHeadings('## ordinary\n'), undefined);
  assert.deepEqual(extractFeishuHeadings(controlledHeadingDocument()), [
    { depth: 2, slug: 'feishu-heading-1', text: '标题 x + y' },
    { depth: 3, slug: 'feishu-heading-2', text: '重复标题' },
  ]);
});

test('returns an empty list for a controlled document without headings', () => {
  assert.deepEqual(extractFeishuHeadings(controlled('<p>正文</p>')), []);
});

test('preserves ordered duplicate and empty heading metadata', () => {
  const document = controlled([
    heading(2, 1, '相同'),
    heading(3, 2, '相同'),
    heading(4, 3, '', ''),
  ].join(''));

  assert.deepEqual(extractFeishuHeadings(document), [
    { depth: 2, slug: 'feishu-heading-1', text: '相同' },
    { depth: 3, slug: 'feishu-heading-2', text: '相同' },
    { depth: 4, slug: 'feishu-heading-3', text: '' },
  ]);
});

test('rejects malformed controlled heading candidates', () => {
  const cases = [
    '<h2 id="feishu-heading-1" data-feishu-heading-text="@@">标题</h2>',
    heading(2, 2, '跳号'),
    `${heading(2, 1, '一')}${heading(3, 1, '重复编号')}`,
    '<h7 id="feishu-heading-1" data-feishu-heading-text="eA">标题</h7>',
    '<h2 id="feishu-heading-1" data-feishu-heading-text="eA">标题</h3>',
  ];

  for (const markup of cases) {
    assert.throws(
      () => extractFeishuHeadings(controlled(markup)),
      /Invalid controlled Feishu markup/,
      markup,
    );
  }
});

test('rejects malformed heading candidates in ordinary Markdown', () => {
  assert.throws(
    () => extractFeishuHeadings(
      '<h2 id="feishu-heading-1" data-feishu-heading-text="@@">标题</h2>',
    ),
    /Invalid controlled Feishu markup/,
  );
});

test('ignores pseudo headings inside HTML code regions', () => {
  const pseudo = '&lt;h2 id=&quot;feishu-heading-9&quot; data-feishu-heading-text=&quot;@@&quot;&gt;x&lt;/h2&gt;';

  assert.equal(extractFeishuHeadings(`<pre>${pseudo}</pre>`), undefined);
  assert.deepEqual(
    extractFeishuHeadings(controlled(`<pre><code>${pseudo}</code></pre>`)),
    [],
  );
});
