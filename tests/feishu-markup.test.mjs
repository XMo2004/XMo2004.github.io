import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeFeishuHtmlEntities,
  transformFeishuMarkup,
} from '../src/lib/feishu-markup.ts';

const encode = (value) => Buffer.from(value, 'utf8').toString('base64url');
const equation = (source = 'x', display = 'inline', body = '<span class="katex"><span>x</span></span>') =>
  `<span class="feishu-equation feishu-equation--${display}" data-feishu-equation-source="${encode(source)}">${body}</span>`;
const heading = (index, depth, text, body = text) =>
  `<h${depth} id="feishu-heading-${index}" data-feishu-heading-text="${encode(text)}">${body}</h${depth}>`;
const ui = (body = '↻ 同步内容') =>
  `<span class="feishu-source-synced__label" data-feishu-search-ui>${body}</span>`;
const controlled = (body, before = '', after = '') =>
  `${before}<div class="feishu-document">${body}</div>${after}`;

function collect(source) {
  const codes = [];
  const equations = [];
  const interfaces = [];
  const result = transformFeishuMarkup(source, {
    code(region) {
      codes.push(region);
      return `[code:${region.kind}:${region.content}]`;
    },
    equation(region) {
      equations.push(region);
      return `[equation:${region.display}:${region.source}]`;
    },
    searchUi(region) {
      interfaces.push(region);
      return '[ui]';
    },
  });
  return { result, codes, equations, interfaces };
}

function assertInvalid(source) {
  assert.throws(
    () => transformFeishuMarkup(source),
    /Invalid controlled Feishu markup/u,
  );
}

test('decodes the existing six named and decimal or hexadecimal entities only', () => {
  assert.equal(
    decodeFeishuHtmlEntities('&amp;&apos;&gt;&lt;&nbsp;&quot; &#124; &#x41; &#X1f600;'),
    `&'>< \" | A 😀`,
  );
  assert.equal(
    decodeFeishuHtmlEntities('&copy; &amp &#x110000; &#not-a-number;'),
    '&copy; &amp &#x110000; &#not-a-number;',
  );
});

test('scans variable Markdown fences, longer closers, EOF fences, and exact code spans', () => {
  const source = [
    'before',
    '````js',
    'const ticks = "```";',
    '`````',
    'middle ``a ` b`` after',
    '~~~txt',
    'unclosed',
  ].join('\n');
  const { result, codes } = collect(source);

  assert.equal(result.mode, 'markdown');
  assert.equal(result.headings, undefined);
  assert.deepEqual(codes.map(({ kind, content }) => [kind, content]), [
    ['markdown-fence', 'const ticks = "```";\n'],
    ['markdown-code-span', 'a ` b'],
    ['markdown-fence', 'unclosed'],
  ]);
  assert.equal(result.value, [
    'before',
    '[code:markdown-fence:const ticks = "```";\n]middle [code:markdown-code-span:a ` b] after',
    '[code:markdown-fence:unclosed]',
  ].join('\n'));
});

test('leaves an unmatched Markdown code-span opener as ordinary text', () => {
  const source = `ordinary \` opener ${equation('after')}`;
  const { result, codes, equations } = collect(source);
  assert.deepEqual(codes, []);
  assert.deepEqual(equations.map(({ source: value }) => value), ['after']);
  assert.match(result.value, /^ordinary ` opener \[equation/u);
});

test('does not pair an unmatched code-span opener with a tick inside a fenced block', () => {
  const source = [
    '` ordinary opener',
    '```txt',
    'fenced ` delimiter',
    '```',
    equation('after fence'),
  ].join('\n');
  const { result, codes, equations } = collect(source);

  assert.match(result.value, /^` ordinary opener\n/u);
  assert.deepEqual(codes.map(({ kind }) => kind), ['markdown-fence']);
  assert.deepEqual(equations.map(({ source: value }) => value), ['after fence']);
});

test('does not pair an unmatched code-span opener with a tick inside HTML code', () => {
  const source = `\` ordinary opener <code>HTML \` delimiter</code>${equation('after HTML code')}`;
  const { result, codes, equations } = collect(source);

  assert.match(result.value, /^` ordinary opener /u);
  assert.deepEqual(codes.map(({ kind }) => kind), ['html-code']);
  assert.deepEqual(equations.map(({ source: value }) => value), ['after HTML code']);
});

test('does not pair an unmatched code-span opener with a tick inside an equation subtree', () => {
  const formula = equation(
    'soft opaque equation',
    'inline',
    '<span class="katex">body ` tick</span>',
  );
  const source = `\` ordinary opener ${formula}`;
  const { result, codes, equations } = collect(source);

  assert.match(result.value, /^` ordinary opener \[equation/u);
  assert.deepEqual(codes, []);
  assert.deepEqual(equations.map(({ source: value }) => value), ['soft opaque equation']);
});

test('keeps a complete equation literal when a real code span encloses it', () => {
  const formula = equation(
    'literal equation',
    'inline',
    '<span class="katex">body ` tick</span>',
  );
  const { result, codes, equations } = collect(`\`${formula}\``);

  assert.equal(result.mode, 'markdown');
  assert.deepEqual(codes.map(({ kind, raw }) => [kind, raw]), [
    ['markdown-code-span', `\`${formula}\``],
  ]);
  assert.deepEqual(equations, []);
});

test('prefers a Markdown code span that contains an incomplete or complete HTML code tag', () => {
  const cases = [
    '`<code>`',
    '`<code>x</code>`',
    '`<code>x ` internal tick</code>`',
  ];
  for (const source of cases) {
    const { codes, equations } = collect(source);
    assert.deepEqual(codes.map(({ kind, raw }) => [kind, raw]), [
      ['markdown-code-span', source],
    ]);
    assert.deepEqual(equations, []);
  }
});

test('scans controlled HTML code, pre/code once, void tags, quoted greater-than, formula, UI, and headings', () => {
  const source = controlled([
    '<p title="1 > 0">before<img src="x"><hr></p>',
    '<pre><code class="language-html">&lt;x&gt;&amp;&#124;&#x41;&copy; https<!---->&#58;&#47;&#47;private.example/path</code></pre>',
    '<code>&lt;standalone&gt;</code>',
    heading(1, 2, '', `${equation('title formula')}空`),
    heading(2, 3, '第二节'),
    equation('E = mc²', 'block'),
    ui(),
  ].join(''), ' \n', '\t');
  const { result, codes, equations, interfaces } = collect(source);

  assert.equal(result.mode, 'controlled-document');
  assert.deepEqual(result.headings, [
    { depth: 2, slug: 'feishu-heading-1', text: '' },
    { depth: 3, slug: 'feishu-heading-2', text: '第二节' },
  ]);
  assert.deepEqual(codes.map(({ kind, content }) => [kind, content]), [
    ['html-pre', '<x>&|A&copy; https://private.example/path'],
    ['html-code', '<standalone>'],
  ]);
  assert.deepEqual(equations.map(({ source: value, display }) => [value, display]), [
    ['title formula', 'inline'],
    ['E = mc²', 'block'],
  ]);
  assert.equal(interfaces.length, 1);
  assert.equal(interfaces[0].raw, ui());
  assert.match(result.value, /^ \n<div class="feishu-document">/u);
  assert.match(result.value, /\[code:html-pre:<x>&\|A&copy; https:\/\/private\.example\/path\]/u);
  assert.match(result.value, /\[ui\]<\/div>\t$/u);
});

test('returns controlled empty heading metadata and preserves source without handlers', () => {
  const source = controlled('<p>无标题</p>');
  assert.deepEqual(transformFeishuMarkup(source), {
    value: source,
    mode: 'controlled-document',
    headings: [],
  });
});

test('accepts ordinary controlled classes and protocol words in unrelated attributes', () => {
  const source = controlled(
    '<section class="feishu-source-synced"><a href="https://example.com/feishu-equation">x</a></section>',
  );
  assert.equal(transformFeishuMarkup(source).value, source);
});

test('uses empty handler replacements rather than retaining raw regions', () => {
  const source = `${equation('x')}<code>code</code>`;
  const result = transformFeishuMarkup(source, {
    equation: () => '',
    code: () => '',
  });
  assert.equal(result.value, '');
});

test('lets an HTML code handler delete a reconstructed private URL completely', () => {
  const source = controlled(
    '<code>before https<!---->&#58;&#47;&#47;private.example/path after</code>',
  );
  const result = transformFeishuMarkup(source, {
    code: ({ content }) => content.replace('https://private.example/path', ''),
  });
  assert.equal(
    result.value,
    controlled('before  after'),
  );
  assert.doesNotMatch(result.value, /https|private|example|path/u);
});

test('ignores all protocol-shaped tags inside each of the four code region kinds', () => {
  const pseudo = [
    '<span data-feishu-equation-source="QQ">x</span>',
    '<h2 id="feishu-heading-9" data-feishu-heading-text="@@">x</h2>',
    '<span data-feishu-search-ui>同步内容</span>',
  ].join('');
  const realEquation = equation('real');
  const markdownCases = [
    `\`\`\`\n${pseudo}\n\`\`\`\n${realEquation}`,
    `\`${pseudo}\` ${realEquation}`,
  ];
  const htmlCases = [
    controlled(`<pre><code>${pseudo}</code></pre>${heading(1, 2, '真标题')}${realEquation}`),
    controlled(`<code>${pseudo}</code>${heading(1, 2, '真标题')}${realEquation}`),
  ];

  for (const source of [...markdownCases, ...htmlCases]) {
    const { result, codes, equations, interfaces } = collect(source);
    assert.equal(codes.length, 1, source);
    assert.deepEqual(equations.map(({ source: value }) => value), ['real'], source);
    assert.equal(interfaces.length, 0, source);
    if (result.mode === 'controlled-document') {
      assert.deepEqual(result.headings?.map(({ text }) => text), ['真标题']);
    } else {
      assert.equal(result.headings, undefined);
    }
  }
});

test('controlled HTML treats ordinary backticks and tilde fence text as text', () => {
  const source = controlled(`<p>\` unmatched\n~~~\nplain</p>${equation('after')}`);
  const { codes, equations } = collect(source);
  assert.deepEqual(codes, []);
  assert.deepEqual(equations.map(({ source: value }) => value), ['after']);
});

test('formula wrapper skips its entire nested KaTeX subtree', () => {
  const nestedPseudo = `${equation('inner')} ${heading(99, 2, 'fake')} ${ui('fake')}`;
  const outer = equation('outer', 'inline', `<span><span>${nestedPseudo}</span></span>`);
  const { equations, interfaces, result } = collect(controlled(outer));
  assert.deepEqual(equations.map(({ source: value }) => value), ['outer']);
  assert.equal(interfaces.length, 0);
  assert.deepEqual(result.headings, []);
});

test('formula and UI handlers receive complete raw regions', () => {
  const formula = equation('raw', 'inline', '<span><em>x</em></span>');
  const interfaceMarkup = ui('<strong>同步</strong>');
  const { equations, interfaces } = collect(controlled(`${formula}${interfaceMarkup}`));
  assert.equal(equations[0].raw, formula);
  assert.equal(interfaces[0].raw, interfaceMarkup);
});

test('rejects invalid formula Base64URL forms, UTF-8, attributes, and closure', () => {
  const invalid = [
    '<span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="@@">x</span>',
    '<span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="eA==">x</span>',
    '<span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="Zh">x</span>',
    '<span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="_w">x</span>',
    '<span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="">x</span>',
    '<span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="eA" data-feishu-equation-source="eQ">x</span>',
    '<span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="eA">x',
  ];
  for (const markup of invalid) {
    assertInvalid(markup);
    assertInvalid(controlled(markup));
  }
});

test('rejects partial and near-protocol tags outside code in both modes', () => {
  const invalid = [
    '<div data-feishu-equation-source="eA">x</div>',
    '<span class="feishu-equation" data-feishu-equation-source="eA">x</span>',
    '<span class="feishu-equation feishu-equation--wide" data-feishu-equation-source="eA">x</span>',
    '<span class="feishu-equation feishu-equation--inline extra" data-feishu-equation-source="eA">x</span>',
    '<span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="eA" title="x">x</span>',
    '<h2 id="feishu-heading-1">标题</h2>',
    '<h2 data-feishu-heading-text="5qCH6aKY">标题</h2>',
    '<div id="feishu-heading-1" data-feishu-heading-text="5qCH6aKY">标题</div>',
    '<div class="feishu-source-synced__label" data-feishu-search-ui>同步内容</div>',
    '<span class="extra" data-feishu-search-ui>同步内容</span>',
    '<span class="feishu-source-synced__label" data-feishu-search-ui title="x">同步内容</span>',
  ];
  for (const markup of invalid) {
    assertInvalid(markup);
    assertInvalid(controlled(markup));
  }
});

test('allows every near-protocol sample as literal content inside all four code kinds', () => {
  const protocolSamples = [
    equation('exact equation'),
    heading(1, 2, 'exact heading'),
    ui('exact UI'),
    '<div data-feishu-equation-source="eA">x</div>',
    '<span class="feishu-equation" data-feishu-equation-source="eA">x</span>',
    '<span class="feishu-equation feishu-equation--wide" data-feishu-equation-source="eA">x</span>',
    '<span class="feishu-equation feishu-equation--inline extra" data-feishu-equation-source="eA">x</span>',
    '<span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="eA" title="x">x</span>',
    '<h2 id="feishu-heading-1">标题</h2>',
    '<h2 data-feishu-heading-text="5qCH6aKY">标题</h2>',
    '<div id="feishu-heading-1" data-feishu-heading-text="5qCH6aKY">标题</div>',
    '<div class="feishu-source-synced__label" data-feishu-search-ui>同步内容</div>',
    '<span class="extra" data-feishu-search-ui>同步内容</span>',
    '<span class="feishu-source-synced__label" data-feishu-search-ui title="x">同步内容</span>',
  ].join('');
  const cases = [
    `\`\`\`\n${protocolSamples}\n\`\`\``,
    `\`${protocolSamples}\``,
    controlled(`<pre><code>${protocolSamples}</code></pre>`),
    controlled(`<code>${protocolSamples}</code>`),
  ];
  for (const source of cases) {
    const { result, codes, equations, interfaces } = collect(source);
    assert.equal(codes.length, 1, source);
    assert.match(codes[0].raw, /feishu-equation--inline/u, source);
    assert.match(codes[0].raw, /feishu-heading-1/u, source);
    assert.match(codes[0].raw, /data-feishu-search-ui/u, source);
    assert.deepEqual(equations, [], source);
    assert.deepEqual(interfaces, [], source);
    assert.deepEqual(result.headings, result.mode === 'markdown' ? undefined : [], source);
  }
});

test('keeps a multiline unterminated protocol candidate literal inside code', () => {
  const malformed = '<span\n class="feishu-equation feishu-equation--inline"\n data-feishu-equation-source="eA"';
  const { codes } = collect(`\`\`\`\n${malformed}\n\`\`\``);
  assert.equal(codes.length, 1);
  assert.match(codes[0].content, /data-feishu-equation-source/u);
});

test('rejects heading sequence, duplication, tag-depth mismatch, and malformed Base64URL', () => {
  const invalidBodies = [
    heading(2, 2, '跳号'),
    '<h2 id="feishu-heading-0" data-feishu-heading-text="eA">x</h2>',
    '<h2 id="feishu-heading-01" data-feishu-heading-text="eA">x</h2>',
    `${heading(1, 2, '一')}${heading(1, 3, '重复')}`,
    '<h3 id="feishu-heading-1" data-feishu-heading-text="eA">x</h2>',
    '<h2 id="feishu-heading-1" data-feishu-heading-text="eA==">x</h2>',
    '<h2 id="feishu-heading-1" data-feishu-heading-text="_w">x</h2>',
    '<h2 id="feishu-heading-1" data-feishu-heading-text="eA" title="x">x</h2>',
  ];
  for (const body of invalidBodies) assertInvalid(controlled(body));
});

test('rejects valid heading protocol outside controlled-document mode', () => {
  assertInvalid(heading(1, 2, '标题'));
});

test('rejects whitespace immediately after an opening or closing angle bracket', () => {
  const spacedOpeners = [
    '< span class="feishu-equation feishu-equation--inline" data-feishu-equation-source="eA">x</span>',
    '< span class="feishu-source-synced__label" data-feishu-search-ui>x</span>',
    '< h2 id="feishu-heading-1" data-feishu-heading-text="eA">x</h2>',
  ];
  for (const markup of spacedOpeners) {
    assertInvalid(markup);
    assertInvalid(controlled(markup));
  }

  for (const markup of [
    equation('x').replace('</span>', '</ span>'),
    ui().replace('</span>', '</ span>'),
    heading(1, 2, 'x').replace('</h2>', '</ h2>'),
    '<div class="feishu-document"><p>x</p></ div>',
  ]) assertInvalid(markup.startsWith('<div class="feishu-document">') ? markup : controlled(markup));
});

test('rejects a multiline unterminated protocol candidate in Markdown prose', () => {
  assertInvalid(
    '<span\n class="feishu-equation feishu-equation--inline"\n data-feishu-equation-source="eA"',
  );
});

test('keeps protocol words in ordinary less-than prose literal', () => {
  for (const source of [
    '1 < 2 and feishu-equation is prose',
    '<not-a-tag\nplain feishu-document prose',
  ]) {
    assert.deepEqual(transformFeishuMarkup(source), {
      value: source,
      mode: 'markdown',
      headings: undefined,
    });
  }
});

test('rejects repeated or nested roots and non-whitespace outside the root', () => {
  const root = controlled('<p>x</p>');
  assertInvalid(`${root}${root}`);
  assertInvalid(controlled(controlled('<p>x</p>')));
  assertInvalid(`${root}tail`);
  assertInvalid(`lead${root}`);
  assert.doesNotThrow(() => transformFeishuMarkup(` \n${root}\t`));
});

test('rejects malformed controlled tag stacks and unclosed HTML code or pre', () => {
  const invalid = [
    controlled('<p><em>x</p></em>'),
    controlled('<code>x'),
    controlled('<pre><code>x</code>'),
    controlled('<p title="unterminated>x</p>'),
    '<code>x',
    '<pre><code>x</code>',
  ];
  for (const source of invalid) assertInvalid(source);
});

test('does not misread void img or hr as unclosed controlled elements', () => {
  assert.doesNotThrow(() => transformFeishuMarkup(controlled('<p>a<img src="x">b<br>c<hr></p>')));
});

test('rejects UI protocol outside controlled mode and accepts only its exact boolean form', () => {
  assertInvalid(ui());
  for (const body of [
    '<span class="feishu-source-synced__label" data-feishu-search-ui="">x</span>',
    '<span data-feishu-search-ui class="feishu-source-synced__label" title="x">x</span>',
  ]) {
    assertInvalid(controlled(body));
  }
});
