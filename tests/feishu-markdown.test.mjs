import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeHTMLStrict } from 'entities';
import katex from 'katex';
import { markdownToHtml } from 'satteri';

import {
  FORMULA_LIMITS,
  renderFeishuDocument,
} from '../scripts/feishu/markdown.mjs';

const PLAIN_STYLE = Object.freeze({
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  inlineCode: false,
  textColor: null,
  backgroundColor: null,
  href: null,
});

function equation(source, display = 'inline', blockId = 'equation') {
  return {
    kind: 'equation',
    blockId,
    source,
    display,
    style: { ...PLAIN_STYLE },
  };
}

function text(value, blockId = 'paragraph') {
  return {
    kind: 'text',
    blockId,
    value,
    style: { ...PLAIN_STYLE },
  };
}

function documentWith(inlines, { warnings = [], mode = 'markdown' } = {}) {
  return {
    kind: 'document',
    mode,
    children: [
      {
        kind: 'paragraph',
        blockId: 'paragraph',
        inlines,
      },
    ],
    warnings,
  };
}

function renderSources(sources, katexRender = () => '<span>x</span>') {
  return renderFeishuDocument(documentWith(sources.map((source, index) =>
    equation(source, 'inline', `equation-${index}`))), { katexRender });
}

function withoutMarkup(value) {
  return decodeHTMLStrict(
    value
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<!--[\s\S]*$/g, '')
      .replaceAll('<!---->', '')
      .replace(/<[^>]*>/g, ''),
  );
}

function annotationSource(markdown) {
  const match = markdown.match(/<annotation\b[^>]*>([\s\S]*?)<\/annotation>/i);
  assert.ok(match, 'expected a MathML annotation');
  return withoutMarkup(match[1]);
}

test('freezes the exact formula budgets', () => {
  assert.deepEqual(FORMULA_LIMITS, {
    count: 200,
    sourceBytes: 8 * 1024,
    renderedBytes: 512 * 1024,
    totalRenderedBytes: 4 * 1024 * 1024,
  });
  assert.equal(Object.isFrozen(FORMULA_LIMITS), true);
});

for (const [display, displayMode] of [
  ['inline', false],
  ['block', true],
]) {
  test(`normalizes, renders, wraps, and context-encodes a ${display} equation`, () => {
    const calls = [];
    const rendered = [
      '<span\n',
      'class="katex|double\r\nvalue" data-single=\'single|\r\nvalue\'>',
      'visual| `literal` *em* _under_ [link](x) \\slash\r\nmath',
      '</span>',
    ].join('');
    const katexRender = (source, options) => {
      calls.push({ source, options });
      return rendered;
    };
    const input = documentWith([
      equation('Ｅ = mc^2', display, `${display}-equation`),
    ]);
    const before = structuredClone(input);

    const result = renderFeishuDocument(input, { katexRender });

    assert.deepEqual(input, before, 'rendering must not mutate semantic input');
    assert.deepEqual(result.issues, []);
    assert.deepEqual(calls, [
      {
        source: 'E = mc^2',
        options: {
          displayMode,
          output: 'htmlAndMathml',
          throwOnError: true,
          trust: false,
          strict: 'error',
          maxSize: 20,
          maxExpand: 1000,
        },
      },
    ]);
    assert.deepEqual(result.conversion.mediaTokens, []);
    assert.deepEqual(result.conversion.mediaReferences, []);
    assert.deepEqual(result.conversion.warnings, []);
    assert.match(
      result.conversion.markdown,
      new RegExp(
        `<span class="feishu-equation feishu-equation--${display}" data-feishu-equation-source="${Buffer.from('E = mc^2').toString('base64url')}">`,
      ),
    );
    assert.doesNotMatch(
      result.conversion.markdown,
      new RegExp(`class="feishu-equation feishu-equation--${display} [^"]+"`),
    );
    const otherDisplay = display === 'inline' ? 'block' : 'inline';
    assert.doesNotMatch(
      result.conversion.markdown,
      new RegExp(`feishu-equation--${otherDisplay}`),
    );
    assert.ok(result.conversion.markdown.includes(
      '<span class="katex&#124;double&#13;&#10;value" data-single=\'single&#124;&#13;&#10;value\'>' +
      'visual&#124; &#96;literal&#96; &#42;em&#42; &#95;under&#95; ' +
      '&#91;link&#93;&#40;x&#41; &#92;slash&#13;&#10;math</span>',
    ));
  });
}

for (const source of [
  String.raw`\includegraphics{private.png}`,
  String.raw`\htmlClass{author-private}{x}`,
  String.raw`\htmlStyle{color:red}{x}`,
  String.raw`\htmlId{author-private}{x}`,
  String.raw`\htmlData{secret=private}{x}`,
  String.raw`\href{https://private.example}{x}`,
]) {
  test(`rejects unsafe KaTeX command ${source.match(/^\\[^<{]+/)[0]}`, () => {
    let calls = 0;
    const realKatexSpy = (...args) => {
      calls += 1;
      return katex.renderToString(...args);
    };
    const result = renderSources([source], realKatexSpy);

    assert.equal(calls, 1);
    assert.equal(result.conversion, null);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].code, 'invalid_equation');
    assert.equal(result.issues[0].blockId, 'equation-0');
    assert.doesNotMatch(result.issues[0].message, /private|KaTeX|HTML|\\/i);
  });
}

for (const [label, source] of [
  ['an escaped percent before href', String.raw`\% \href{x}{y}`],
  ['an odd three-backslash run before href', String.raw`\\\href{x}{y}`],
]) {
  test(`still rejects a real unsafe command after ${label}`, () => {
    let calls = 0;
    const result = renderSources([source], (...args) => {
      calls += 1;
      return katex.renderToString(...args);
    });

    assert.equal(calls, 1);
    assert.equal(result.conversion, null);
    assert.deepEqual(result.issues.map(({ code }) => code), [
      'invalid_equation',
    ]);
  });
}

const URL_WITH_PERCENT_PREFIX = String.raw`\url{https://example.com/100%25}`;
for (const [command, invocation] of [
  ['includegraphics', String.raw`\includegraphics{private.png}`],
  ['htmlClass', String.raw`\htmlClass{private-class}{x}`],
  ['htmlStyle', String.raw`\htmlStyle{color:red}{x}`],
  ['htmlId', String.raw`\htmlId{private-id}{x}`],
  ['htmlData', String.raw`\htmlData{private=secret}{x}`],
  ['href', String.raw`\href{https://private.example}{x}`],
]) {
  test(`rejects trust-gated url combined with unsafe ${command}`, () => {
    let calls = 0;
    const result = renderSources(
      [`${URL_WITH_PERCENT_PREFIX}${invocation}`],
      (...args) => {
        calls += 1;
        return katex.renderToString(...args);
      },
    );

    assert.equal(calls, 1);
    assert.equal(result.conversion, null);
    assert.deepEqual(result.issues.map(({ code }) => code), [
      'invalid_equation',
    ]);
    assert.doesNotMatch(
      result.issues[0].message,
      /example|private|includegraphics|htmlClass|htmlStyle|htmlId|htmlData|href/i,
    );
  });
}

for (const [label, source] of [
  ['a braced argument', String.raw`\url{https://private.example/path}`],
  ['an unbraced argument', String.raw`\url https://private.example/path`],
  ['a percent-bearing argument', URL_WITH_PERCENT_PREFIX],
  [
    'a percent immediately followed by href text',
    String.raw`\url%\href{x}{y}`,
  ],
  [
    'a spaced percent immediately followed by includegraphics text',
    String.raw`\url %\includegraphics{x}`,
  ],
  [
    'a verb brace argument followed by href',
    String.raw`\url{\verb|{|}\href{x}{y}`,
  ],
  [
    'a def macro body',
    String.raw`\def\privateMacro{\url{https://private.example}}\privateMacro`,
  ],
  [
    'a newcommand macro body',
    String.raw`\newcommand{\privateMacro}{\url{https://private.example}}\privateMacro`,
  ],
  [
    'a let macro alias',
    String.raw`\let\privateMacro\url\privateMacro{https://private.example}`,
  ],
]) {
  test(`rejects trust-gated url in ${label}`, () => {
    let calls = 0;
    const result = renderSources([source], (...args) => {
      calls += 1;
      return katex.renderToString(...args);
    });

    assert.equal(calls, 1);
    assert.equal(result.conversion, null);
    assert.deepEqual(result.issues.map(({ code }) => code), [
      'invalid_equation',
    ]);
    assert.doesNotMatch(
      result.issues[0].message,
      /private|example|url|verb|Macro|KaTeX|HTML|\\/i,
    );
  });
}

test('allows ordinary math color without creating author-named attributes', () => {
  const result = renderSources([String.raw`\color{#123456}{x}`], katex.renderToString);

  assert.deepEqual(result.issues, []);
  assert.match(result.conversion.markdown, /#123456/);
  assert.doesNotMatch(
    result.conversion.markdown,
    /(?:class|id|data-author|data-secret)=(?:"|')author-private/i,
  );
});

for (const [label, source] of [
  ['a line comment', 'text % \\href{x}{y}\n+1'],
  ['a paired backslash control symbol', String.raw`\\href`],
  ['a paired backslash inside text', String.raw`\text{\\href}`],
  ['a verb literal', String.raw`\verb|\href|`],
  ['a starred verb literal', String.raw`\verb*|\href|`],
]) {
  test(`does not reject a harmless href spelling inside ${label}`, () => {
    let calls = 0;
    const realKatexSpy = (...args) => {
      calls += 1;
      return katex.renderToString(...args);
    };

    const result = renderSources([source], realKatexSpy);

    assert.equal(calls, 1);
    assert.deepEqual(result.issues, []);
    assert.notEqual(result.conversion, null);
  });
}

for (const [label, source] of [
  ['a line comment', 'text % \\url{https://private.example}\n+1'],
  ['a paired backslash control symbol', String.raw`\\url`],
  ['a paired backslash inside text', String.raw`\text{\\url}`],
  ['a verb literal', String.raw`\verb|\url|`],
  ['a starred verb literal', String.raw`\verb*|\url|`],
]) {
  test(`does not reject harmless url text inside ${label}`, () => {
    let calls = 0;
    const result = renderSources([source], (...args) => {
      calls += 1;
      return katex.renderToString(...args);
    });

    assert.equal(calls, 1);
    assert.deepEqual(result.issues, []);
    assert.notEqual(result.conversion, null);
  });
}

for (const url of [
  'https://visible.example/path',
  'HTTPS://VISIBLE.EXAMPLE/PATH',
]) {
  test(`real KaTeX stays inert in default Markdown mode for ${url}`, () => {
    const source = String.raw`\text{${url}}`;
    const result = renderFeishuDocument(documentWith([equation(source)]), {
      katexRender: katex.renderToString,
    });

    assert.deepEqual(result.issues, []);
    assert.ok(result.conversion.markdown.includes('<!---->'));
    assert.match(result.conversion.markdown, /https?<!---->&#58;/i);
    assert.equal(annotationSource(result.conversion.markdown), source);
    assert.ok(withoutMarkup(result.conversion.markdown).includes(url));

    const html = markdownToHtml(result.conversion.markdown).html;
    assert.doesNotMatch(html, /<a\b/i);
    assert.doesNotMatch(html, /<(?:em|code)\b/i);
    assert.ok(withoutMarkup(html).includes(url));
    assert.ok(withoutMarkup(html).includes(source));
  });
}

test('keeps an email before a trailing period inert through real Satteri', () => {
  const visible = 'Person@Example.com.';
  const source = String.raw`\text{Person@Example.com.}`;
  const result = renderFeishuDocument(documentWith([equation(source)]), {
    katexRender: katex.renderToString,
  });

  assert.deepEqual(result.issues, []);
  assert.match(
    result.conversion.markdown,
    /Person<!---->&#64;Example&#46;com&#46;/,
  );
  assert.equal(annotationSource(result.conversion.markdown), source);
  assert.ok(withoutMarkup(result.conversion.markdown).includes(visible));

  const html = markdownToHtml(result.conversion.markdown).html;
  assert.doesNotMatch(html, /<a\b/i);
  assert.ok(withoutMarkup(html).includes(visible));
  assert.ok(withoutMarkup(html).includes(source));
});

test('breaks all ASCII-case-insensitive autolink forms only in text nodes', () => {
  const visible = [
    'http://one.example',
    'HTTPS://TWO.EXAMPLE',
    'MAILTO:user@example.com',
    'WWW.example.com',
    'Person@Example.com',
    '&#x68;t&#116;p&colon;//entity.example/path',
  ].join(' | ');
  const annotation = String.raw`\text{https://annotation.example HTTPS://ANNOTATION.EXAMPLE}`;
  const raw = [
    '<span\r\n',
    'data-url="HTTPS://attribute.example" data-pipe=\'a|b\'>',
    visible,
    `<math><annotation encoding="application/x-tex">${annotation}</annotation></math>`,
    '</span>',
  ].join('');
  const originalText = decodeHTMLStrict(visible) + annotation;
  const result = renderSources(['x'], () => raw);
  const markdown = result.conversion.markdown;

  assert.deepEqual(result.issues, []);
  assert.ok(markdown.includes('<span data-url="HTTPS://attribute.example"'));
  assert.ok(markdown.includes("data-pipe='a&#124;b'"));
  assert.doesNotMatch(markdown, /data-url="[^"!]*<!---->/);
  assert.match(markdown, /http<!---->&#58;/);
  assert.match(markdown, /HTTPS<!---->&#58;/);
  assert.match(markdown, /MAILTO<!---->&#58;/);
  assert.match(markdown, /WWW<!---->&#46;/);
  assert.match(markdown, /Person<!---->&#64;/);
  assert.match(markdown, /http<!---->&#58;&#47;&#47;entity&#46;example/);
  assert.equal(
    withoutMarkup(markdown).includes(originalText),
    true,
    'decoding tags and comments must preserve visible and annotation text',
  );
  assert.equal(annotationSource(markdown), annotation);

  const html = markdownToHtml(markdown).html;
  assert.doesNotMatch(html, /<a\b/i);
  assert.doesNotMatch(html, /<(?:em|code)\b/i);
  assert.ok(withoutMarkup(html).includes(originalText));
});

test('keeps KaTeX comments inert and resumes complex text-node encoding', () => {
  const hiddenComment = '<!-- quote " > http://hidden.example -->';
  const visible = [
    'https://visible.example/path',
    'HTTPS://VISIBLE.EXAMPLE/PATH',
    '| `literal` *em* _under_ [link](x) \\slash\r\nmath',
  ].join(' ');
  const annotation = String.raw`\text{https://annotation.example/path *literal*}`;
  const raw = [
    '<span\r\n',
    'class="katex|double\r\nvalue" data-single=\'single|\r\nvalue\'>',
    hiddenComment,
    visible,
    `<math><annotation encoding="application/x-tex">${annotation}</annotation></math>`,
    '</span>',
  ].join('');
  const result = renderSources(['x'], () => raw);
  const markdown = result.conversion.markdown;

  assert.deepEqual(result.issues, []);
  assert.ok(markdown.includes(hiddenComment));
  assert.ok(markdown.includes(
    '<span class="katex&#124;double&#13;&#10;value" ' +
    'data-single=\'single&#124;&#13;&#10;value\'>',
  ));
  assert.match(markdown, /https<!---->&#58;&#47;&#47;visible&#46;example/);
  assert.match(markdown, /HTTPS<!---->&#58;&#47;&#47;VISIBLE&#46;EXAMPLE/);
  assert.match(markdown, /&#96;literal&#96; &#42;em&#42; &#95;under&#95;/);
  assert.equal(annotationSource(markdown), annotation);
  assert.ok(withoutMarkup(markdown).includes(visible + annotation));

  const html = markdownToHtml(markdown).html;
  assert.doesNotMatch(html, /<a\b/i);
  assert.doesNotMatch(html, /<(?:em|code)\b/i);
  assert.ok(withoutMarkup(html).includes(visible + annotation));
});

test('treats an unclosed KaTeX HTML comment as inert through end of output', () => {
  const raw = '<!-- quote " > http://hidden.example `code` *em*';
  const result = renderSources(['x'], () => raw);

  assert.deepEqual(result.issues, []);
  assert.ok(result.conversion.markdown.includes(`${raw}-->`));
  assert.doesNotMatch(result.conversion.markdown, /hidden<!---->/);
  const html = markdownToHtml(result.conversion.markdown).html;
  assert.doesNotMatch(html, /<(?:a|em|code)\b/i);
});

test('preserves invalid entity-looking text as visible literal characters', () => {
  const result = renderSources(['x'], () => '<span>&NotARealEntity;</span>');

  assert.deepEqual(result.issues, []);
  assert.match(result.conversion.markdown, /&#38;NotARealEntity&#59;/);
  assert.ok(withoutMarkup(result.conversion.markdown).includes('&NotARealEntity;'));
});

test('allows exactly 200 formulas and rejects 201 before rendering any', () => {
  let calls = 0;
  const spy = () => {
    calls += 1;
    return 'x';
  };

  const accepted = renderSources(Array.from({ length: 200 }, () => 'x'), spy);
  assert.deepEqual(accepted.issues, []);
  assert.equal(calls, 200);

  calls = 0;
  const rejected = renderSources(Array.from({ length: 201 }, () => 'x'), spy);
  assert.equal(rejected.conversion, null);
  assert.ok(rejected.issues.some(({ code }) => code === 'formula_budget_exceeded'));
  assert.equal(calls, 0);
});

test('measures per-formula source bytes after NFKC and fails before rendering', () => {
  let calls = 0;
  const spy = () => {
    calls += 1;
    return 'x';
  };

  const accepted = renderSources(['Ａ'.repeat(FORMULA_LIMITS.sourceBytes)], spy);
  assert.deepEqual(accepted.issues, []);
  assert.equal(calls, 1);

  calls = 0;
  const rejected = renderSources(['Ａ'.repeat(FORMULA_LIMITS.sourceBytes + 1)], spy);
  assert.equal(rejected.conversion, null);
  assert.equal(rejected.issues[0].code, 'formula_budget_exceeded');
  assert.equal(calls, 0);
});

test('enforces the normalized source limit with stable multibyte UTF-8', () => {
  const exactSource = '汉'.repeat(2730) + 'ab';
  const oversizedSource = exactSource + 'c';
  assert.equal(exactSource.normalize('NFKC'), exactSource);
  assert.equal(Buffer.byteLength(exactSource, 'utf8'), FORMULA_LIMITS.sourceBytes);
  assert.equal(
    Buffer.byteLength(oversizedSource, 'utf8'),
    FORMULA_LIMITS.sourceBytes + 1,
  );
  let calls = 0;
  const spy = () => {
    calls += 1;
    return 'x';
  };

  const accepted = renderSources([exactSource], spy);
  assert.deepEqual(accepted.issues, []);
  assert.equal(calls, 1);

  calls = 0;
  const rejected = renderSources([oversizedSource], spy);
  assert.equal(rejected.conversion, null);
  assert.equal(rejected.issues[0].code, 'formula_budget_exceeded');
  assert.equal(calls, 0);
});

test('accepts raw individual KaTeX output at 512 KiB and rejects one byte more', () => {
  const exactRawOutput = '|'.repeat(FORMULA_LIMITS.renderedBytes);
  const oversizedRawOutput = exactRawOutput + '|';
  assert.equal(
    Buffer.byteLength(exactRawOutput, 'utf8'),
    FORMULA_LIMITS.renderedBytes,
  );
  assert.equal(
    Buffer.byteLength(oversizedRawOutput, 'utf8'),
    FORMULA_LIMITS.renderedBytes + 1,
  );

  const accepted = renderSources(['x'], () => exactRawOutput);
  assert.deepEqual(accepted.issues, []);
  assert.ok(
    Buffer.byteLength(accepted.conversion.markdown, 'utf8') >
    FORMULA_LIMITS.renderedBytes,
    'Markdown encoding may expand after the raw output budget passes',
  );

  let calls = 0;
  const rejected = renderSources(['x'], () => {
    calls += 1;
    return oversizedRawOutput;
  });
  assert.equal(rejected.conversion, null);
  assert.equal(rejected.issues[0].code, 'formula_budget_exceeded');
  assert.equal(calls, 1);
});

test('accepts 4 MiB total raw output and rejects one byte more after all renders', () => {
  const chunk = FORMULA_LIMITS.renderedBytes;
  const accepted = renderSources(Array.from({ length: 8 }, () => 'x'), () =>
    'x'.repeat(chunk));
  assert.deepEqual(accepted.issues, []);

  let calls = 0;
  const rejected = renderSources(Array.from({ length: 9 }, () => 'x'), () => {
    calls += 1;
    return calls <= 8 ? 'x'.repeat(chunk) : 'x';
  });
  assert.equal(rejected.conversion, null);
  assert.ok(rejected.issues.some(({ code }) => code === 'formula_budget_exceeded'));
  assert.equal(calls, 9);
});

test('aggregates every invalid equation while keeping public messages redacted', () => {
  const sources = ['private_formula_one', 'private_formula_two'];
  let calls = 0;
  const renderWithRealKatex = (source, options) => {
    calls += 1;
    return katex.renderToString(`${source} \\notARealPrivateCommand`, options);
  };
  const result = renderSources(sources, renderWithRealKatex);

  assert.equal(calls, 2);
  assert.equal(result.conversion, null);
  assert.deepEqual(result.issues.map(({ code }) => code), [
    'invalid_equation',
    'invalid_equation',
  ]);
  for (const issue of result.issues) {
    assert.equal(typeof issue.blockId, 'string');
    assert.doesNotMatch(
      issue.message,
      /private_formula|notARealPrivateCommand|KaTeX|parse|<span|class=/i,
    );
  }
});

test('copies document warnings into the partial conversion', () => {
  const warnings = [{ type: 'code_language_fallback', language: 'private' }];
  const result = renderFeishuDocument(
    documentWith([text('before '), equation('x'), text(' after')], { warnings }),
    { katexRender: () => '<span>x</span>' },
  );

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.conversion.warnings, warnings);
  assert.notEqual(result.conversion.warnings, warnings);
  assert.match(result.conversion.markdown, /^before /);
  assert.match(result.conversion.markdown, / after$/);
});

test('throws an internal task-order error for semantic kinds outside Task 6', () => {
  const unsupported = {
    kind: 'document',
    mode: 'controlled-document',
    children: [{ kind: 'heading', blockId: 'heading', level: 2, inlines: [] }],
    warnings: [],
  };

  assert.throws(
    () => renderFeishuDocument(unsupported, { katexRender: () => 'x' }),
    /Task 6 partial serializer does not support semantic kind: heading/,
  );
});

test('rejects an unsupported block before inspecting or rendering its equations', () => {
  const unsupported = {
    kind: 'document',
    mode: 'controlled-document',
    children: [
      {
        kind: 'heading',
        blockId: 'heading',
        depth: 2,
        inlines: [equation(String.raw`\notARealPrivateCommand`)],
      },
    ],
    warnings: [],
  };
  let calls = 0;

  assert.throws(
    () => renderFeishuDocument(unsupported, {
      katexRender: () => {
        calls += 1;
        throw new Error('private renderer error');
      },
    }),
    /Task 6 partial serializer does not support semantic kind: heading/,
  );
  assert.equal(calls, 0);
});

test('does not treat equation-shaped metadata as semantic content', () => {
  const fakeEquation = {
    kind: 'equation',
    blockId: 'private-metadata',
    source: 'private_metadata_formula',
    display: 'inline',
  };
  const input = documentWith([
    {
      ...text('visible'),
      style: { ...PLAIN_STYLE, privateMetadata: fakeEquation },
    },
  ], {
    warnings: [{ type: 'private_warning', privateMetadata: fakeEquation }],
  });
  let calls = 0;

  const result = renderFeishuDocument(input, {
    katexRender: () => {
      calls += 1;
      return 'x';
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(result.issues, []);
  assert.equal(result.conversion.markdown, 'visible');
});
