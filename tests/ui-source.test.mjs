import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

function assertNoNestedAnchors(source, label) {
  let anchorDepth = 0;

  for (const match of source.matchAll(/<\/?a\b[^>]*>/g)) {
    if (match[0].startsWith('</')) {
      anchorDepth -= 1;
      assert.ok(anchorDepth >= 0, `${label} should close only open links`);
    } else {
      assert.equal(anchorDepth, 0, `${label} should not nest interactive links`);
      anchorDepth += 1;
    }
  }

  assert.equal(anchorDepth, 0, `${label} should close every link`);
}

function splitCssTopLevel(source, separator) {
  const parts = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== undefined) {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      parentheses += 1;
    } else if (character === ')') {
      parentheses -= 1;
    } else if (character === '[') {
      brackets += 1;
    } else if (character === ']') {
      brackets -= 1;
    } else if (
      character === separator &&
      parentheses === 0 &&
      brackets === 0
    ) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(source.slice(start));
  return parts;
}

function findCssBlockEnd(source, openingBrace) {
  let depth = 1;
  let quote;

  for (let index = openingBrace + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== undefined) {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error('Unclosed CSS block in style contract fixture.');
}

function parseCssDeclarations(body) {
  return splitCssTopLevel(body, ';').flatMap((entry, index) => {
    const colon = entry.indexOf(':');
    if (colon < 0) return [];

    const property = entry.slice(0, colon).trim().toLowerCase();
    const rawValue = entry.slice(colon + 1).trim();
    if (property === '' || rawValue === '') return [];

    const important = /\s*!important\s*$/i.test(rawValue);
    const value = rawValue
      .replace(/\s*!important\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return [{ property, value, important, index }];
  });
}

function parseCssCascade(source) {
  const rules = [];
  const state = { order: 0 };
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');

  function visit(segment, mediaQueries = []) {
    let cursor = 0;
    while (cursor < segment.length) {
      const openingBrace = segment.indexOf('{', cursor);
      if (openingBrace < 0) return;

      const prelude = segment.slice(cursor, openingBrace).trim();
      const closingBrace = findCssBlockEnd(segment, openingBrace);
      const body = segment.slice(openingBrace + 1, closingBrace);

      if (/^@media\b/i.test(prelude)) {
        visit(body, [
          ...mediaQueries,
          prelude.replace(/^@media\b/i, '').trim(),
        ]);
      } else if (!prelude.startsWith('@')) {
        const declarations = parseCssDeclarations(body);
        const order = state.order;
        state.order += 1;
        for (const selector of splitCssTopLevel(prelude, ',')) {
          const normalizedSelector = selector.trim().replace(/\s+/g, ' ');
          if (normalizedSelector !== '' && declarations.length > 0) {
            rules.push({
              selector: normalizedSelector,
              declarations,
              mediaQueries,
              order,
            });
          }
        }
      }

      cursor = closingBrace + 1;
    }
  }

  visit(withoutComments);
  return rules;
}

function cssLengthToPixels(value) {
  const match = /^(-?\d+(?:\.\d+)?)(px|rem)$/i.exec(value?.trim() ?? '');
  if (!match) return Number.NaN;
  const amount = Number(match[1]);
  return match[2].toLowerCase() === 'rem' ? amount * 16 : amount;
}

function mediaQueryMatches(query, environment) {
  return splitCssTopLevel(query, ',').some((branch) => {
    const features = [
      ...branch.matchAll(/\(\s*([a-z-]+)\s*:\s*([^)]+)\)/gi),
    ];
    if (features.length === 0) return false;

    return features.every(([, name, rawValue]) => {
      const value = rawValue.trim().toLowerCase();
      if (name.toLowerCase() === 'max-width') {
        return environment.viewportWidth <= cssLengthToPixels(value);
      }
      if (name.toLowerCase() === 'min-width') {
        return environment.viewportWidth >= cssLengthToPixels(value);
      }
      if (name.toLowerCase() === 'prefers-reduced-motion') {
        return value === 'reduce'
          ? environment.reducedMotion
          : !environment.reducedMotion;
      }
      return false;
    });
  });
}

function cssSpecificity(selector) {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
  const withoutPseudoElements = selector.replace(/::[\w-]+/g, '');
  const classes = withoutPseudoElements.match(/\.[\w-]+/g)?.length ?? 0;
  const attributes = withoutPseudoElements.match(/\[[^\]]+\]/g)?.length ?? 0;
  const pseudoClasses =
    withoutPseudoElements.match(/:(?!:)[\w-]+(?:\([^)]*\))?/g)?.length ?? 0;
  const elementSource = withoutPseudoElements
    .replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g, ' ')
    .replace(/[>+~*]/g, ' ');
  const elements = elementSource
    .trim()
    .split(/\s+/)
    .filter((token) => /^[a-z][\w-]*$/i.test(token)).length;
  return [ids, classes + attributes + pseudoClasses, elements];
}

function selectorAppliesToTarget(selector, target) {
  if (selector === target) return true;
  if (selector === ':focus-visible') return target.endsWith(':focus-visible');

  const targetWithoutState = target
    .replace(/\[[^\]]+\]/g, '')
    .replace(/:focus-visible\b/g, '')
    .trim();
  return selector === targetWithoutState;
}

function compareSpecificity(first, second) {
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return first[index] - second[index];
  }
  return 0;
}

function effectiveCssDeclarations(rules, target, environment) {
  const winners = new Map();

  for (const rule of rules) {
    if (
      !selectorAppliesToTarget(rule.selector, target) ||
      !rule.mediaQueries.every((query) => mediaQueryMatches(query, environment))
    ) {
      continue;
    }

    const specificity = cssSpecificity(rule.selector);
    for (const declaration of rule.declarations) {
      const current = winners.get(declaration.property);
      const wins =
        current === undefined ||
        Number(declaration.important) > Number(current.important) ||
        (declaration.important === current.important &&
          (compareSpecificity(specificity, current.specificity) > 0 ||
            (compareSpecificity(specificity, current.specificity) === 0 &&
              (rule.order > current.order ||
                (rule.order === current.order &&
                  declaration.index >= current.declarationIndex)))));

      if (wins) {
        winners.set(declaration.property, {
          value: declaration.value,
          important: declaration.important,
          specificity,
          order: rule.order,
          declarationIndex: declaration.index,
        });
      }
    }
  }

  return Object.fromEntries(
    [...winners].map(([property, winner]) => [property, winner.value]),
  );
}

function assertMinimumCssLength(declarations, property, label) {
  const value = declarations[property];
  assert.ok(
    cssLengthToPixels(value) >= 44,
    `${label} ${property} must remain at least 2.75rem at 320px; received ${value ?? 'unset'}`,
  );
}

function assertEffectiveSearchStyleCascade(styles) {
  const rules = parseCssCascade(styles);
  const compactEnvironment = {
    viewportWidth: 320,
    reducedMotion: false,
  };
  const reducedMotionEnvironment = {
    viewportWidth: 320,
    reducedMotion: true,
  };
  const compact = (target) =>
    effectiveCssDeclarations(rules, target, compactEnvironment);

  const toggle = compact('.search-toggle');
  assertMinimumCssLength(toggle, 'min-width', 'search-toggle');
  assertMinimumCssLength(toggle, 'min-height', 'search-toggle');

  const close = compact('.search-dialog__close');
  assertMinimumCssLength(close, 'min-width', 'search-dialog__close');
  assertMinimumCssLength(close, 'min-height', 'search-dialog__close');
  assertMinimumCssLength(
    compact('.search-dialog__input'),
    'min-height',
    'search-dialog__input',
  );
  assertMinimumCssLength(
    compact('.search-dialog__result a'),
    'min-height',
    'search-dialog__result a',
  );

  assert.equal(
    compact('.search-dialog__results')['overflow-y'],
    'auto',
    'search-dialog__results overflow-y must remain auto at 320px',
  );
  assert.equal(
    compact('.search-toggle kbd').display,
    'none',
    'search-toggle kbd display must remain none at 320px',
  );

  const dialog = compact('.search-dialog');
  assert.equal(
    dialog.width,
    'calc(100vw - 1rem)',
    'search-dialog mobile width must preserve the viewport inset',
  );
  assert.equal(
    dialog['max-height'],
    'calc(100dvh - 1rem)',
    'search-dialog mobile max-height must preserve the viewport inset',
  );

  for (const [label, target] of [
    ['search-dialog', '.search-dialog[open]'],
    ['search-dialog__result', '.search-dialog__result'],
  ]) {
    const declarations = effectiveCssDeclarations(
      rules,
      target,
      reducedMotionEnvironment,
    );
    for (const [property, expected] of [
      ['animation', 'none'],
      ['transition', 'none'],
      ['opacity', '1'],
      ['transform', 'none'],
    ]) {
      assert.equal(
        declarations[property],
        expected,
        `reduced-motion ${label} ${property} must resolve to ${expected}`,
      );
    }
  }

  for (const target of [
    '.search-toggle:focus-visible',
    '.search-dialog__close:focus-visible',
    '.search-dialog__input:focus-visible',
    '.search-dialog__result a:focus-visible',
  ]) {
    const declarations = compact(target);
    const outline = declarations.outline;
    assert.ok(
      outline !== undefined &&
        !/\bnone\b/i.test(outline) &&
        !/^0(?:[a-z%]+)?(?:\s|$)/i.test(outline) &&
        declarations['outline-style'] !== 'none',
      `${target} focus-visible outline must remain visible; received ${outline ?? 'unset'}`,
    );
  }
}

test('BaseLayout provides Chinese document metadata and an accessible page shell', async () => {
  const [source, footerSource] = await Promise.all([
    readSource('src/layouts/BaseLayout.astro'),
    readSource('src/components/SiteFooter.astro'),
  ]);

  assert.match(source, /<html\s+lang=["']zh-CN["']/);
  assert.match(source, /跳到正文/);
  assert.match(source, /rel=["']canonical["']/);
  assert.match(source, /<main\s+id=["']main-content["']/);
  assert.match(
    source,
    /<main\s+(?=[^>]*id=["']main-content["'])(?=[^>]*tabindex=["']-1["'])[^>]*>/,
  );
  assert.match(source, /SiteHeader/);
  assert.match(source, /SiteFooter/);
  assert.match(footerSource, /new Date\(\)\.getFullYear\(\)/);
  assert.doesNotMatch(footerSource, /©\s*2026/);
});

test('BaseLayout emits site metadata without inventing a social preview image', async () => {
  const source = await readSource('src/layouts/BaseLayout.astro');

  assert.match(source, /SITE/);
  assert.match(source, /property=["']og:title["']/);
  assert.match(source, /property=["']og:description["']/);
  assert.match(source, /name=["']twitter:card["']/);
  assert.match(source, /name=["']theme-color["']/);
  assert.doesNotMatch(source, /og:image|twitter:image/);
});

test('BaseLayout starts the saved or system theme before paint', async () => {
  const source = await readSource('src/layouts/BaseLayout.astro');

  assert.match(source, /localStorage\.getItem\(["']xmo-theme["']\)/);
  assert.match(source, /matchMedia\(["']\(prefers-color-scheme: dark\)["']\)/);
  assert.match(source, /dataset\.theme/);
});

test('global styles define the editorial tokens and accessibility safeguards', async () => {
  const [source, homeSource, archiveSource, aboutSource, notFoundSource] =
    await Promise.all([
      readSource('src/styles/global.css'),
      readSource('src/pages/index.astro'),
      readSource('src/pages/posts/index.astro'),
      readSource('src/pages/about.astro'),
      readSource('src/pages/404.astro'),
    ]);

  assert.match(source, /--paper:\s*#f4f0e7/i);
  assert.match(source, /--terracotta:\s*#b84f35/i);
  assert.match(source, /\[data-theme=["']dark["']\]/);
  assert.match(source, /:focus-visible/);
  assert.match(source, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(source, /@media\s*\(max-width:/);
  assert.match(source, /text-wrap:\s*pretty/);
  assert.match(source, /--accent-text:\s*#9f422e/i);
  assert.match(source, /--accent-hover:\s*#566444/i);
  assert.match(
    source,
    /(?:^|\n)a\s*\{[^}]*color:\s*var\(--accent-text\);[^}]*\}/s,
  );
  assert.match(
    source,
    /a:hover\s*\{[^}]*color:\s*var\(--accent-hover\);[^}]*\}/s,
  );
  assert.match(
    source,
    /\.eyebrow\s*\{[^}]*color:\s*var\(--accent-text\);[^}]*\}/s,
  );
  assert.match(
    source,
    /\.button\s*\{(?=[^}]*background:\s*var\(--accent-text\);)(?=[^}]*color:\s*var\(--surface\);)[^}]*\}/s,
  );
  assert.match(
    source,
    /\.button:hover\s*\{(?=[^}]*background:\s*var\(--accent-hover\);)(?=[^}]*color:\s*var\(--surface\);)[^}]*\}/s,
  );
  assert.doesNotMatch(
    source,
    /(?:^|[\s;{])color:\s*var\(--(?:terracotta|sage|moss)\)/,
  );
  assert.match(
    source,
    /\.tag-list a\s*\{[^}]*min-height:\s*2\.75rem;[^}]*\}/s,
  );
  assert.match(
    source,
    /\.tag-list--compact a\s*\{[^}]*min-height:\s*2\.75rem;[^}]*\}/s,
  );
  assert.match(
    source,
    /\.wordmark\s*\{(?=[^}]*min-height:\s*2\.75rem;)(?=[^}]*display:\s*inline-flex;)[^}]*\}/s,
  );
  assert.match(
    source,
    /\.site-footer__inner a\s*\{(?=[^}]*min-height:\s*2\.75rem;)(?=[^}]*display:\s*inline-flex;)[^}]*\}/s,
  );
  assert.match(
    source,
    /\.text-link\s*\{[^}]*min-height:\s*2\.75rem;[^}]*\}/s,
  );
  assert.match(
    source,
    /\.standalone-action\s*\{(?=[^}]*min-height:\s*2\.75rem;)(?=[^}]*display:\s*inline-flex;)[^}]*\}/s,
  );

  for (const pageSource of [
    homeSource,
    archiveSource,
    aboutSource,
    notFoundSource,
  ]) {
    assert.match(pageSource, /class=["']standalone-action["']/);
  }
});

test('SiteHeader keeps all primary destinations available and marks the current one', async () => {
  const source = await readSource('src/components/SiteHeader.astro');

  for (const label of ['首页', '文章', '分类', '专栏', '标签', '关于']) {
    assert.match(source, new RegExp(label));
  }

  assert.match(source, /href:\s*['"]\/categories\/['"]/);
  assert.match(source, /normalizedPath\.startsWith\(['"]\/categories\/['"]\)/);
  assert.match(source, /href:\s*['"]\/columns\/['"]/);
  assert.match(source, /normalizedPath\.startsWith\(['"]\/columns\/['"]\)/);
  assert.match(source, /aria-current/);
  assert.match(source, /ThemeToggle/);
});

test('search shell is progressively mounted once with an accessible opener', async () => {
  const [header, base, toggle] = await Promise.all([
    readSource('src/components/SiteHeader.astro'),
    readSource('src/layouts/BaseLayout.astro'),
    readSource('src/components/SearchToggle.astro'),
  ]);

  assert.match(header, /import\s+SearchToggle\s+from\s+['"]\.\/SearchToggle\.astro['"]/);
  assert.match(
    header,
    /<div\s+class=["']site-header__utilities["'][^>]*>[\s\S]*?<SearchToggle\s*\/>[\s\S]*?<ThemeToggle\s*\/>[\s\S]*?<\/div>/,
  );
  assert.match(base, /import\s+SearchDialog\s+from\s+['"]\.\.\/components\/SearchDialog\.astro['"]/);
  assert.match(base, /<SiteHeader\s*\/>\s*<SearchDialog\s*\/>\s*<main/);
  assert.equal(base.match(/<SearchDialog\s*\/>/g)?.length, 1);
  assert.match(
    toggle,
    /<button\s+(?=[^>]*type=["']button["'])(?=[^>]*aria-label=["']搜索文章["'])(?=[^>]*data-search-open)(?=[^>]*hidden(?:\s|>|=))[^>]*>/,
  );
});

test('search dialog exposes native labels, state hooks and an archive fallback', async () => {
  const dialog = await readSource('src/components/SearchDialog.astro');

  assert.match(
    dialog,
    /<dialog\s+(?=[^>]*id=["']site-search["'])(?=[^>]*aria-labelledby=["']site-search-title["'])(?=[^>]*aria-describedby=["']site-search-description["'])[^>]*>/,
  );
  assert.match(dialog, /id=["']site-search-title["']/);
  assert.match(dialog, /id=["']site-search-description["']/);
  assert.match(
    dialog,
    /<input\s+(?=[^>]*type=["']search["'])(?=[^>]*data-search-input)(?=[^>]*aria-label=["']搜索文章["'])[^>]*>/,
  );
  assert.match(dialog, /<button[^>]*data-search-close[^>]*>/);
  assert.match(
    dialog,
    /<[^>]+(?=[^>]*data-search-status)(?=[^>]*aria-live=["']polite["'])[^>]*>/,
  );
  assert.match(dialog, /<ol[^>]*data-search-results[^>]*>/);
  assert.match(dialog, /data-search-loading/);
  assert.match(dialog, /data-search-empty/);
  assert.match(dialog, /data-search-error/);
  assert.match(dialog, /href=["']\/posts\/["'][^>]*>[^<]*文章归档/);
  assert.match(dialog, /<script>[\s\S]*?import\s+['"]\.\.\/scripts\/search-dialog['"];?[\s\S]*?<\/script>/);
});

test('search client requires its shell before revealing every opener', async () => {
  const script = await readSource('src/scripts/search-dialog.ts');

  for (const selector of [
    '#site-search',
    '[data-search-open]',
    '[data-search-input]',
    '[data-search-results]',
    '[data-search-status]',
  ]) {
    assert.match(script, new RegExp(selector.replaceAll('[', '\\[').replaceAll(']', '\\]')));
  }
  assert.match(script, /querySelectorAll<[^>]+>\(['"]\[data-search-open\]['"]\)/);
  assert.match(script, /if\s*\([^)]*(?:!dialog|dialog\s*===\s*null)[\s\S]*?\)\s*\{?\s*return;/);
  assert.match(script, /openers\.forEach\([\s\S]*?opener\.hidden\s*=\s*false/);
  assert.ok(
    script.indexOf('return;') < script.indexOf('opener.hidden = false'),
    'openers must be revealed only after required-node validation',
  );
});

test('search client caches and validates one same-origin index request', async () => {
  const script = await readSource('src/scripts/search-dialog.ts');

  assert.equal(script.match(/fetch\(/g)?.length, 1);
  assert.match(
    script,
    /fetch\(['"]\/search-index\.json['"],\s*\{\s*headers:\s*\{\s*accept:\s*['"]application\/json['"]\s*\}\s*\}\)/s,
  );
  assert.match(script, /(?:\?\?=|if\s*\(\s*[^)]*Promise[^)]*===\s*undefined\s*\))/);
  assert.match(script, /!response\.ok/);
  assert.match(script, /payload\.version\s*!==\s*1/);
  assert.match(script, /!Array\.isArray\(payload\.entries\)/);
  assert.doesNotMatch(script, /https?:\/\//);
});

test('search client supports safe rendering and the complete keyboard flow', async () => {
  const script = await readSource('src/scripts/search-dialog.ts');

  assert.match(script, /searchEntries\([^)]*,[^)]*,\s*8\s*\)/);
  assert.match(script, /document\.createElement/);
  assert.match(script, /\.textContent\s*=/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(script, /metaKey/);
  assert.match(script, /ctrlKey/);
  assert.match(script, /key\s*===\s*['"]\/['"]/);
  for (const editable of ['input', 'textarea', 'select', '[contenteditable]']) {
    assert.match(script, new RegExp(editable.replaceAll('[', '\\[').replaceAll(']', '\\]'), 'i'));
  }
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
    assert.match(script, new RegExp(key));
  }
  assert.match(
    script,
    /if\s*\(\s*event\.key\s*===\s*['"]Escape['"]\s*\)\s*\{(?=[^}]*event\.preventDefault\(\);)(?=[^}]*dialog\.close\(\);)[^}]*\}/,
  );
  assert.match(
    script,
    /if\s*\(\s*event\.target\s*!==\s*input\s*\)\s*\{\s*return;\s*\}\s*if\s*\(\s*event\.key\s*===\s*['"]ArrowDown['"]\s*\)/,
  );
  assert.match(script, /aria-current/);
  assert.match(script, /\.click\(\)/);
  assert.match(script, /event\.target\s*===\s*dialog[\s\S]*?dialog\.close\(\)/);
  assert.match(script, /最近更新/);
  assert.match(script, /搜索暂不可用/);
});

test('search responsive styles preserve header utilities and touch targets', async () => {
  const styles = await readSource('src/styles/global.css');

  assert.match(
    styles,
    /\.site-header__utilities\s*\{(?=[^}]*display:\s*flex;)(?=[^}]*align-items:\s*center;)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.search-toggle\s*\{(?=[^}]*min-width:\s*2\.75rem;)(?=[^}]*min-height:\s*2\.75rem;)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.search-dialog__close\s*\{(?=[^}]*min-width:\s*2\.75rem;)(?=[^}]*min-height:\s*2\.75rem;)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.search-dialog__input\s*\{[^}]*min-height:\s*2\.75rem;[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.search-dialog__result\s+a\s*\{[^}]*min-height:\s*2\.75rem;[^}]*\}/s,
  );
});

test('search responsive dialog inherits editorial tokens and keeps content scrollable', async () => {
  const styles = await readSource('src/styles/global.css');

  assert.match(
    styles,
    /\.search-dialog\s*\{(?=[^}]*width:\s*min\(46rem,\s*calc\(100vw\s*-\s*1\.5rem\)\);)(?=[^}]*max-height:\s*min\(44rem,\s*calc\(100dvh\s*-\s*1\.5rem\)\);)(?=[^}]*border:[^;}]*var\(--line\);)(?=[^}]*background:\s*var\(--surface\);)(?=[^}]*color:\s*var\(--ink\);)(?=[^}]*box-shadow:\s*var\(--shadow-soft\);)[^}]*\}/s,
  );
  assert.match(styles, /\.search-dialog::backdrop\s*\{[^}]*background:/s);
  assert.match(
    styles,
    /\.search-dialog__panel\s*\{(?=[^}]*grid-template-rows:\s*auto\s+auto\s+auto\s+minmax\(0,\s*1fr\)\s+auto;)(?=[^}]*max-height:\s*inherit;)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.search-dialog__results\s*\{(?=[^}]*min-width:\s*0;)(?=[^}]*overflow-y:\s*auto;)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.search-dialog__result-title\s*\{[^}]*font-family:\s*var\(--font-serif\);[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.search-dialog__result-description,\s*\.search-dialog__result-meta\s*\{[^}]*color:\s*var\(--muted\);[^}]*\}/s,
  );
  assert.doesNotMatch(
    styles,
    /\.search-dialog(?:__[\w-]+)?[^,{]*\{[^}]*(?:white-space:\s*nowrap|text-overflow:\s*ellipsis|-webkit-line-clamp)/s,
  );
});

test('search responsive states expose focus, selection, and archive recovery', async () => {
  const styles = await readSource('src/styles/global.css');

  assert.match(
    styles,
    /\.search-toggle:focus-visible,\s*\.search-dialog__close:focus-visible,\s*\.search-dialog__input:focus-visible,\s*\.search-dialog__result\s+a:focus-visible\s*\{/s,
  );
  assert.match(
    styles,
    /\.search-dialog__result\s+a\[aria-current=["']true["']\]\s*\{(?=[^}]*background:\s*var\(--paper\);)(?=[^}]*outline:[^;}]*var\(--accent-text\);)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.search-dialog__fallback\s*\{(?=[^}]*min-height:\s*2\.75rem;)(?=[^}]*display:\s*inline-flex;)[^}]*\}/s,
  );
});

test('search responsive behavior fits narrow screens and reduced motion', async () => {
  const styles = await readSource('src/styles/global.css');

  assert.match(
    styles,
    /@media\s*\(max-width:\s*48rem\)\s*\{[\s\S]*?\.search-toggle\s+kbd\s*\{[^}]*display:\s*none;[^}]*\}[\s\S]*?\.search-dialog\s*\{(?=[^}]*width:\s*calc\(100vw\s*-\s*1rem\);)(?=[^}]*max-height:\s*calc\(100dvh\s*-\s*1rem\);)[^}]*\}/,
  );
  assert.match(
    styles,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.search-dialog,\s*\.search-dialog__result\s*\{(?=[^}]*animation:\s*none;)(?=[^}]*transition:\s*none;)(?=[^}]*opacity:\s*1;)(?=[^}]*transform:\s*none;)[^}]*\}/,
  );
});

test('effective search style cascade rejects late destructive overrides', async () => {
  const styles = await readSource('src/styles/global.css');
  const lateTouchTargetOverride = `${styles}
    @media (max-width: 48rem) {
      .search-toggle { min-width: 1rem; min-height: 1rem; }
    }
  `;
  const lateOverflowOverride = `${styles}
    @media (max-width: 48rem) {
      .search-dialog__results { overflow-y: hidden; }
    }
  `;
  const outOfRangeOverride = `${styles}
    @media (min-width: 60rem) {
      .search-toggle { min-width: 1rem; min-height: 1rem; }
      .search-dialog__results { overflow-y: hidden; }
    }
  `;
  const lateMotionOverride = `${styles}
    @media (prefers-reduced-motion: reduce) {
      .search-dialog[open], .search-dialog__result {
        animation: search-result-enter 1s;
        transition: opacity 1s;
        opacity: 0;
        transform: translateY(1rem);
      }
    }
  `;
  const lateFocusOverride = `${styles}
    .search-toggle:focus-visible,
    .search-dialog__close:focus-visible,
    .search-dialog__input:focus-visible,
    .search-dialog__result a:focus-visible { outline: none; }
  `;

  assert.doesNotThrow(() => assertEffectiveSearchStyleCascade(styles));
  assert.doesNotThrow(() => assertEffectiveSearchStyleCascade(outOfRangeOverride));
  assert.throws(
    () => assertEffectiveSearchStyleCascade(lateTouchTargetOverride),
    /search-toggle min-width/,
  );
  assert.throws(
    () => assertEffectiveSearchStyleCascade(lateOverflowOverride),
    /search-dialog__results overflow-y/,
  );
  assert.throws(
    () => assertEffectiveSearchStyleCascade(lateMotionOverride),
    /reduced-motion search-dialog animation/,
  );
  assert.throws(
    () => assertEffectiveSearchStyleCascade(lateFocusOverride),
    /focus-visible outline/,
  );
});

test('ThemeToggle exposes state and persists the selected theme', async () => {
  const source = await readSource('src/components/ThemeToggle.astro');

  assert.match(source, /aria-pressed/);
  assert.match(source, /aria-label=["']深色模式["']/);
  assert.doesNotMatch(source, /setAttribute\(["']aria-label["']/);
  assert.doesNotMatch(source, /切换到(?:浅色|深色)模式/);
  assert.match(source, /localStorage\.setItem\(["']xmo-theme["']/);
  assert.match(source, /dataset\.theme/);
});

test('ThemeToggle uses a hollow borderless sun and moon phase control', async () => {
  const [toggleSource, styles] = await Promise.all([
    readSource('src/components/ThemeToggle.astro'),
    readSource('src/styles/global.css'),
  ]);

  assert.match(
    toggleSource,
    /<span\s+class=["']theme-toggle__glyph["'][^>]*>[\s\S]*?<span\s+class=["']theme-toggle__phase["'][^>]*><\/span>[\s\S]*?<\/span>/,
  );
  assert.match(
    styles,
    /\.theme-toggle\s*\{(?=[^}]*width:\s*2\.75rem;)(?=[^}]*height:\s*2\.75rem;)(?=[^}]*border:\s*0;)(?=[^}]*border-radius:\s*50%;)(?=[^}]*background:\s*transparent;)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.theme-toggle__glyph\s*\{(?=[^}]*border:[^;}]*solid\s+currentColor;)(?=[^}]*border-radius:\s*50%;)(?=[^}]*background:\s*transparent;)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.theme-toggle__phase\s*\{(?=[^}]*border-radius:\s*50%;)(?=[^}]*transition:[^;}]*transform)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\[data-theme=['"]dark['"]\]\s+\.theme-toggle__phase\s*\{[^}]*transform:\s*translate3d\([^)]+\)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.theme-toggle:hover\s+\.theme-toggle__glyph\s*\{[^}]*transform:\s*rotate\([^)]+\)[^}]*\}/s,
  );
});

test('footer is a compact branded taxonomy band with progressive reveal', async () => {
  const [footerSource, styles] = await Promise.all([
    readSource('src/components/SiteFooter.astro'),
    readSource('src/styles/global.css'),
  ]);

  assert.match(footerSource, /<footer[^>]*data-footer-reveal/);
  assert.match(
    footerSource,
    /<svg[^>]*class=["']site-footer__mark["'][^>]*>[\s\S]*?fill=["']none["'][\s\S]*?<\/svg>/,
  );
  assert.match(
    footerSource,
    /site-footer__brand-name[\s\S]*?<span>X<\/span>\s*<span>M<\/span>\s*<span>O<\/span>/,
  );
  assert.match(
    footerSource,
    /site-footer__brand-notes[\s\S]*?<span>N<\/span>\s*<span>O<\/span>\s*<span>T<\/span>\s*<span>E<\/span>\s*<span>S<\/span>/,
  );
  assert.match(
    footerSource,
    /site-footer__tagline[\s\S]*?>缓慢记录<\/span>[\s\S]*?>长期整理<\/span>/,
  );
  for (const [href, label] of [
    ['/categories/', '分类'],
    ['/columns/', '专栏'],
    ['/rss.xml', 'RSS'],
  ]) {
    assert.match(
      footerSource,
      new RegExp(`href=["']${href.replaceAll('/', '\\/')}["'][^>]*>${label}<\\/a>`),
    );
  }
  assert.match(footerSource, /['"]IntersectionObserver['"]\s+in\s+window/);
  assert.match(footerSource, /footer\.dataset\.revealReady\s*=\s*['"]true['"]/);
  assert.match(footerSource, /footer\.dataset\.revealVisible\s*=\s*['"]true['"]/);
  assert.match(footerSource, /observer\.observe\(footer\)/);
  assert.match(footerSource, /observer\.disconnect\(\)/);
  assert.match(
    styles,
    /\.site-footer__brand-name\s*>\s*span,[\s\S]*?\{(?=[^}]*opacity:\s*1;)(?=[^}]*transform:\s*none;)[^}]*\}/,
  );
  assert.match(
    styles,
    /\[data-footer-reveal\]\[data-reveal-ready=['"]true['"]\]:not\(\[data-reveal-visible=['"]true['"]\]\)[\s\S]*?\{(?=[^}]*opacity:\s*0;)(?=[^}]*transform:\s*translate3d\()[^}]*\}/,
  );
});

test('post components use safe post and taxonomy routes', async () => {
  const [cardSource, rowSource, tagListSource] = await Promise.all([
    readSource('src/components/PostCard.astro'),
    readSource('src/components/PostRow.astro'),
    readSource('src/components/TagList.astro'),
  ]);

  assert.match(cardSource, /normalizeTag/);
  assert.match(cardSource, /data\.slug\s*\?\?/);
  assert.match(cardSource, /headingLevel\?:\s*'h2'\s*\|\s*'h3'/);
  assert.match(cardSource, /headingLevel\s*=\s*'h2'/);
  assert.match(cardSource, /<Heading>/);
  assert.match(cardSource, /<article/);
  assert.match(cardSource, /<time/);
  assert.match(rowSource, /CollectionEntry<'posts'>/);
  assert.match(rowSource, /headingLevel\?:\s*'h2'\s*\|\s*'h3'/);
  assert.match(rowSource, /entry\.body/);
  assert.match(rowSource, /estimateReadingMinutes/);
  assert.match(rowSource, /getPostHref/);
  assert.match(rowSource, /getCategoryHref/);
  assert.match(rowSource, /getColumnHref/);
  assert.match(rowSource, /normalizeTag/);
  assert.match(rowSource, /columnOrder/);
  assert.match(rowSource, /padStart\(2,\s*['"]0['"]\)/);
  assert.match(rowSource, /post-row__stretched-link/);
  assert.match(rowSource, /post-row__taxonomy-link/);
  assert.match(
    rowSource,
    /\.post-row__stretched-link::after\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*\}/s,
  );
  assert.match(
    rowSource,
    /\.post-row__taxonomy-link\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;[^}]*\}/s,
  );
  assert.match(rowSource, /cover\s*&&/);
  assert.match(rowSource, /<article/);
  assert.match(rowSource, /<time/);
  assert.match(tagListSource, /normalizeTag/);
  assert.match(tagListSource, /<ul/);
  assert.match(tagListSource, /\/tags\//);
});

test('cover contract uses one responsive image without changing card or row layout', async () => {
  const [coverSource, cardSource, rowSource, homeSource, styles] =
    await Promise.all([
      readSource('src/components/CoverImage.astro'),
      readSource('src/components/PostCard.astro'),
      readSource('src/components/PostRow.astro'),
      readSource('src/pages/index.astro'),
      readSource('src/styles/global.css'),
    ]);
  const frontmatterEnd = coverSource.indexOf('\n---', 3);
  const coverTemplate = coverSource.slice(frontmatterEnd + 4).trim();

  assert.match(
    coverSource,
    /import\s+type\s+\{\s*Cover\s*\}\s+from\s+['"]\.\.\/lib\/cover['"];?/,
  );
  assert.match(
    coverSource,
    /interface\s+Props\s*\{(?=[^}]*cover:\s*Cover;)(?=[^}]*sizes:\s*string;)(?=[^}]*priority\?:\s*boolean;)[^}]*\}/s,
  );
  assert.match(
    coverSource,
    /\{\s*cover,\s*sizes,\s*priority\s*=\s*false\s*\}\s*=\s*Astro\.props/,
  );
  assert.match(
    coverSource,
    /const\s+src\s*=\s*typeof\s+cover\s*===\s*['"]string['"]\s*\?\s*cover\s*:\s*cover\.src/,
  );
  assert.match(
    coverSource,
    /const\s+responsiveCover\s*=\s*typeof\s+cover\s*===\s*['"]string['"]\s*\?\s*undefined\s*:\s*cover/,
  );
  assert.match(
    coverSource,
    /const\s+srcset\s*=\s*responsiveCover\?\.variants\s*\.map\(\(variant\)\s*=>\s*`\$\{variant\.src\}\s+\$\{variant\.width\}w`\)\s*\.join\(['"],\s*['"]\)/s,
  );
  assert.match(
    coverSource,
    /const\s+responsiveSizes\s*=\s*responsiveCover\s*===\s*undefined\s*\?\s*undefined\s*:\s*sizes/,
  );
  assert.match(coverSource, /const\s+width\s*=\s*responsiveCover\?\.width/);
  assert.match(coverSource, /const\s+height\s*=\s*responsiveCover\?\.height/);
  assert.match(
    coverSource,
    /const\s+loading\s*=\s*priority\s*\?\s*['"]eager['"]\s*:\s*['"]lazy['"]/,
  );
  assert.match(
    coverSource,
    /const\s+fetchpriority\s*=\s*priority\s*\?\s*['"]high['"]\s*:\s*undefined/,
  );
  assert.doesNotMatch(coverSource, /\.(?:sort|toSorted)\(|new\s+Set\s*\(/);

  assert.match(coverTemplate, /^<img\b[\s\S]*\/>$/);
  assert.equal(coverTemplate.match(/<img\b/g)?.length, 1);
  assert.doesNotMatch(coverTemplate, /<(?:picture|div|style|Image)\b/);
  assert.match(coverTemplate, /\bsrc=\{src\}/);
  assert.match(coverTemplate, /\bsrcset=\{srcset\}/);
  assert.match(coverTemplate, /\bsizes=\{responsiveSizes\}/);
  assert.match(coverTemplate, /\bwidth=\{width\}/);
  assert.match(coverTemplate, /\bheight=\{height\}/);
  assert.match(coverTemplate, /\balt=["']["']/);
  assert.match(coverTemplate, /\bdecoding=["']async["']/);
  assert.match(coverTemplate, /\bloading=\{loading\}/);
  assert.match(coverTemplate, /\bfetchpriority=\{fetchpriority\}/);

  assert.match(
    cardSource,
    /import\s+CoverImage\s+from\s+['"]\.\/CoverImage\.astro['"];?/,
  );
  assert.match(cardSource, /priority\?:\s*boolean/);
  assert.match(
    cardSource,
    /\{\s*entry,\s*headingLevel\s*=\s*['"]h2['"],\s*priority\s*=\s*false\s*\}\s*=\s*Astro\.props/,
  );
  assert.match(cardSource, /\{cover\s*\?\s*\(/);
  assert.match(
    cardSource,
    /<CoverImage\s+(?=[^>]*cover=\{cover\})(?=[^>]*sizes=["']\(max-width: 48rem\) calc\(100vw - 2rem\), 30rem["'])(?=[^>]*priority=\{priority\})[^>]*\/>/s,
  );
  assert.match(
    homeSource,
    /<PostCard\s+entry=\{featured\}\s+headingLevel=["']h3["']\s+priority\s*\/>/,
  );

  assert.match(
    rowSource,
    /import\s+CoverImage\s+from\s+['"]\.\/CoverImage\.astro['"];?/,
  );
  assert.match(rowSource, /\{cover\s*&&\s*\(/);
  assert.match(rowSource, /['"]post-row--with-cover['"]:\s*cover\s*!==\s*undefined/);
  assert.match(
    rowSource,
    /<CoverImage\s+(?=[^>]*cover=\{cover\})(?=[^>]*sizes=["']\(max-width: 30rem\) 1px, \(max-width: 48rem\) 5\.25rem, 7rem["'])[^>]*\/>/s,
  );
  assert.doesNotMatch(rowSource, /\b(?:loading|fetchpriority|priority)\s*=/);

  assert.match(
    styles,
    /\.post-card__cover\s+img\s*\{(?=[^}]*width:\s*100%;)(?=[^}]*height:\s*100%;)(?=[^}]*object-fit:\s*cover;)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.post-row--with-cover\s*\{[^}]*grid-template-columns:\s*7rem\s+minmax\(0,\s*1fr\);[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.post-row__cover\s*\{(?=[^}]*width:\s*7rem;)(?=[^}]*height:\s*6\.25rem;)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.post-row__cover\s+img\s*\{(?=[^}]*width:\s*100%;)(?=[^}]*height:\s*100%;)(?=[^}]*object-fit:\s*cover;)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.post-row:hover\s+\.post-row__cover\s+img\s*\{[^}]*transform:\s*scale\(1\.015\);[^}]*\}/s,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*48rem\)\s*\{[\s\S]*?\.post-row--with-cover\s*\{[^}]*grid-template-columns:\s*5\.25rem\s+minmax\(0,\s*1fr\);[^}]*\}[\s\S]*?\.post-row__cover\s*\{(?=[^}]*width:\s*5\.25rem;)(?=[^}]*height:\s*5\.75rem;)[^}]*\}/,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*30rem\)\s*\{[\s\S]*?\.post-row--with-cover\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*\}[\s\S]*?\.post-row__cover\s*\{[^}]*display:\s*none;[^}]*\}/,
  );
});

test('homepage and archive pages use dense real-content indexes and rows', async () => {
  const [homeSource, postsSource, tagSource] = await Promise.all([
    readSource('src/pages/index.astro'),
    readSource('src/pages/posts/index.astro'),
    readSource('src/pages/tags/[tag].astro'),
  ]);

  assert.match(homeSource, /getCollection\(["']posts["']\)/);
  assert.match(homeSource, /sortNewestFirst/);
  assert.match(homeSource, /buildCategoryIndex/);
  assert.match(homeSource, /buildColumnIndex/);
  assert.match(homeSource, /const\s+categoryIndex\s*=\s*buildCategoryIndex\(posts\)/);
  assert.match(homeSource, /const\s+columnIndex\s*=\s*buildColumnIndex\(posts\)/);
  assert.match(homeSource, /const\s+featured\s*=\s*posts\.find/);
  assert.match(homeSource, /post\s*!==\s*featured/);
  assert.match(homeSource, /slice\(0,\s*4\)/);
  assert.match(
    homeSource,
    /<PostCard\s+entry=\{featured\}\s+headingLevel=["']h3["']\s+priority/,
  );
  assert.match(homeSource, /<PostRow\s+entry=\{post\}\s+headingLevel=["']h3["']/);
  assert.match(homeSource, /aria-label=["']xmo 的博客["']/i);
  assert.match(homeSource, /aria-hidden=["']true["']/);
  assert.match(homeSource, /<svg/);
  assert.doesNotMatch(homeSource, /关于技术、成长与日常的长期笔记。/);
  assert.doesNotMatch(homeSource, /home-hero__actions|editorial-note/);
  assert.match(postsSource, /getCollection\(["']posts["']\)/);
  assert.match(postsSource, /sortNewestFirst/);
  assert.match(postsSource, /<PostRow\s+entry=\{post\}\s+headingLevel=["']h2["']/);
  assert.match(tagSource, /<PostRow\s+entry=\{post\}\s+headingLevel=["']h2["']/);
  assert.doesNotMatch(`${postsSource}\n${tagSource}`, /<PostCard/);
});

test('homepage brand enters like type and a drawn hollow mark', async () => {
  const [homeSource, styles] = await Promise.all([
    readSource('src/pages/index.astro'),
    readSource('src/styles/global.css'),
  ]);

  assert.match(
    homeSource,
    /home-title__xmo[\s\S]*?<span>x<\/span><span>m<\/span><span>o<\/span>/,
  );
  assert.match(homeSource, /class=["']home-title__suffix["']/);
  assert.match(homeSource, /<svg[^>]*class=["']home-brand-mark["']/);
  assert.match(
    styles,
    /\.home-title__xmo\s*>\s*span\s*\{[^}]*animation:\s*home-letter-settle[^;}]*;[^}]*\}/s,
  );
  assert.match(styles, /@keyframes\s+home-letter-settle\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?transform:\s*translate3d\([\s\S]*?\}/);
  assert.match(
    styles,
    /\.home-title__suffix\s*\{[^}]*animation:\s*home-suffix-reveal[^;}]*;[^}]*\}/s,
  );
  assert.match(styles, /@keyframes\s+home-suffix-reveal\s*\{[\s\S]*?clip-path:\s*inset\([^)]+\)[\s\S]*?\}/);
  assert.match(
    styles,
    /\.home-brand-mark\s+:is\(path,\s*ellipse\)\s*\{(?=[^}]*stroke-dasharray:)(?=[^}]*stroke-dashoffset:)(?=[^}]*animation:\s*home-mark-draw)[^}]*\}/s,
  );
  assert.match(styles, /@keyframes\s+home-mark-draw\s*\{[\s\S]*?stroke-dashoffset:\s*0;[\s\S]*?\}/);
  assert.doesNotMatch(
    styles,
    /\.(?:editorial-note|home-hero__intro|home-hero__actions)(?:\b|\s|,)/,
  );
});

test('global layout keeps dense editorial scanning without shrinking reading text', async () => {
  const [styles, rowSource] = await Promise.all([
    readSource('src/styles/global.css'),
    readSource('src/components/PostRow.astro'),
  ]);

  assert.match(styles, /\.site-header__inner\s*\{[^}]*min-height:\s*3\.5rem;[^}]*\}/s);
  assert.match(styles, /\.site-main\s*\{[^}]*padding-block:\s*2rem\s+3rem;[^}]*\}/s);
  assert.match(styles, /\.home-hero\s*\{[^}]*min-height:\s*20rem;[^}]*\}/s);
  assert.match(
    styles,
    /\.home-taxonomy\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*\}/s,
  );
  assert.match(styles, /\.home-section\s*\{[^}]*padding-block-start:\s*3rem;[^}]*\}/s);
  assert.match(styles, /\.section-heading\s*\{[^}]*margin-block-end:\s*1\.25rem;[^}]*\}/s);
  assert.match(styles, /\.post-card__cover\s*\{[^}]*min-height:\s*13\.5rem;[^}]*\}/s);
  assert.match(
    styles,
    /\.post-row\s*\{(?=[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);)(?=[^}]*border-bottom:\s*1px\s+solid\s+var\(--line\);)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.post-row--with-cover\s*\{[^}]*grid-template-columns:\s*7rem\s+minmax\(0,\s*1fr\);[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.post-row__description\s*\{(?=[^}]*white-space:\s*nowrap;)(?=[^}]*text-overflow:\s*ellipsis;)[^}]*\}/s,
  );
  assert.match(styles, /\.post-row:hover\s*\{[^}]*transform:\s*translate3d\([^)]+\);[^}]*\}/s);
  assert.match(styles, /\.post-header\s*\{[^}]*max-width:\s*68rem;[^}]*\}/s);
  assert.match(
    styles,
    /\.post-header h1\s*\{(?=[^}]*max-width:\s*none;)(?=[^}]*font-size:\s*clamp\(2\.2rem,\s*4\.4vw,\s*3\.5rem\);)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.post-header__category,\s*\.post-header__column\s*\{(?=[^}]*min-height:\s*2\.75rem;)(?=[^}]*display:\s*inline-flex;)(?=[^}]*border-radius:\s*999px;)[^}]*\}/s,
  );
  assert.match(styles, /\.tag-list a\s*\{[^}]*border-radius:\s*999px;[^}]*\}/s);
  assert.match(
    styles,
    /\.post-layout--with-toc\s*\{(?=[^}]*grid-template-columns:\s*minmax\(0,\s*var\(--prose-width\)\)\s+minmax\(10rem,\s*13rem\);)(?=[^}]*grid-template-areas:\s*['"]content toc['"];)[^}]*\}/s,
  );
  assert.match(styles, /\.post-toc\s*\{[^}]*grid-area:\s*toc;[^}]*\}/s);
  assert.match(styles, /\.post-layout__content\s*\{[^}]*grid-area:\s*content;[^}]*\}/s);
  assert.match(
    styles,
    /\.post-toc-compact summary\s*\{(?=[^}]*min-height:\s*2\.75rem;)(?=[^}]*display:\s*flex;)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.prose\s*\{(?=[^}]*font-size:\s*1\.0625rem;)(?=[^}]*line-height:\s*1\.78;)[^}]*\}/s,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*48rem\)\s*\{[\s\S]*?\.primary-nav\s*\{[^}]*overflow-x:\s*auto;[^}]*\}[\s\S]*?\.home-taxonomy\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*\}[\s\S]*?\.post-row__description\s*\{[^}]*-webkit-line-clamp:\s*2;[^}]*\}/,
  );
  assert.doesNotMatch(styles, /\.article-meta\s*\{[^}]*flex-direction:\s*column;/s);
  assert.match(rowSource, /post-row__stretched-link/);
  assert.match(rowSource, /post-row__taxonomy-link/);
});

test('reduced motion declares stable final brand, footer, and phase states', async () => {
  const styles = await readSource('src/styles/global.css');
  const reducedMotion = styles.slice(
    styles.indexOf('@media (prefers-reduced-motion: reduce)'),
  );

  assert.match(
    reducedMotion,
    /\.home-title__xmo\s*>\s*span\s*\{(?=[^}]*animation:\s*none;)(?=[^}]*opacity:\s*1;)(?=[^}]*transform:\s*none;)[^}]*\}/s,
  );
  assert.match(
    reducedMotion,
    /\.home-title__suffix\s*\{(?=[^}]*animation:\s*none;)(?=[^}]*opacity:\s*1;)(?=[^}]*clip-path:\s*inset\(0\);)[^}]*\}/s,
  );
  assert.match(
    reducedMotion,
    /\.home-brand-mark\s+:is\(path,\s*ellipse\)\s*\{(?=[^}]*animation:\s*none;)(?=[^}]*stroke-dashoffset:\s*0;)[^}]*\}/s,
  );
  assert.match(
    reducedMotion,
    /\[data-footer-reveal\][\s\S]*?:is\([^)]+\)\s*\{(?=[^}]*opacity:\s*1;)(?=[^}]*transform:\s*none;)[^}]*\}/s,
  );
  assert.match(
    reducedMotion,
    /\.theme-toggle__glyph\s*\{[^}]*transform:\s*rotate\(0\);[^}]*\}/s,
  );
  assert.match(
    reducedMotion,
    /\[data-theme=['"]dark['"]\]\s+\.theme-toggle__phase\s*\{[^}]*transform:\s*translate3d\([^)]+\);[^}]*\}/s,
  );
});

test('category and column routes are generated from the real post collection', async () => {
  const [
    categoryIndexSource,
    categorySource,
    columnIndexSource,
    columnSource,
  ] = await Promise.all([
    readSource('src/pages/categories/index.astro'),
    readSource('src/pages/categories/[category].astro'),
    readSource('src/pages/columns/index.astro'),
    readSource('src/pages/columns/[column].astro'),
  ]);

  for (const source of [categoryIndexSource, categorySource]) {
    assert.match(source, /getCollection\(['"]posts['"]\)/);
    assert.match(source, /buildCategoryIndex/);
  }

  for (const source of [columnIndexSource, columnSource]) {
    assert.match(source, /getCollection\(['"]posts['"]\)/);
    assert.match(source, /buildColumnIndex/);
  }

  assert.match(categoryIndexSource, /posts\.length/);
  assert.match(categoryIndexSource, /pubDate/);
  assert.match(categorySource, /getStaticPaths/);
  assert.match(categorySource, /<PostRow\s+entry=\{post\}\s+headingLevel=['"]h2['"]/);
  assert.match(categorySource, /href=['"]\/categories\/['"]/);

  assert.match(columnIndexSource, /posts\.length/);
  assert.match(columnIndexSource, /pubDate/);
  assert.match(columnSource, /getStaticPaths/);
  assert.match(columnSource, /columnOrder/);
  assert.match(columnSource, /<PostRow\s+entry=\{post\}\s+headingLevel=['"]h2['"]/);
  assert.match(columnSource, /href=['"]\/columns\/['"]/);
});

test('supporting pages keep their copy honest and offer recovery', async () => {
  const [aboutSource, notFoundSource] = await Promise.all([
    readSource('src/pages/about.astro'),
    readSource('src/pages/404.astro'),
  ]);

  assert.match(aboutSource, /技术、成长与日常/);
  assert.match(aboutSource, /飞书/);
  assert.match(aboutSource, /Git/);
  assert.match(aboutSource, /Markdown/);
  assert.match(notFoundSource, /404/);
  assert.match(notFoundSource, /返回首页/);
});

test('PostLayout renders only the article extras supplied by a caller', async () => {
  const source = await readSource('src/layouts/PostLayout.astro');

  for (const prop of [
    'updatedDate',
    'readingMinutes',
    'headings',
    'previous',
    'next',
  ]) {
    assert.match(source, new RegExp(prop));
  }

  assert.match(source, /<article/);
  assert.match(source, /class=["']prose["']/);
  assert.match(source, /<slot\s*\/>/);
  assert.doesNotMatch(source, /sourceUrl|在飞书查看源文/);
});

test('article routes pass taxonomy data through to PostLayout', async () => {
  const source = await readSource('src/pages/posts/[...id].astro');

  assert.match(source, /category=\{post\.data\.category\}/);
  assert.match(source, /column=\{post\.data\.column\}/);
  assert.match(source, /columnOrder=\{post\.data\.columnOrder\}/);
});

test('article routes pass complete discovery data to PostLayout', async () => {
  const source = await readSource('src/pages/posts/[...id].astro');

  assert.match(source, /buildSeriesNavigation/);
  assert.match(source, /buildRelatedPosts/);
  assert.match(source, /type SeriesNavigation/);
  assert.match(source, /type RelatedPostLink/);
  assert.match(
    source,
    /interface Props\s*\{[\s\S]*series\?:\s*SeriesNavigation;[\s\S]*related:\s*(?:readonly\s+)?RelatedPostLink\[\];/,
  );
  assert.match(
    source,
    /const\s+routeRecords\s*=\s*buildPostRouteRecords\(posts\);/,
  );
  assert.match(source, /routeRecords\.map\(\(route\)\s*=>/);
  assert.match(
    source,
    /buildSeriesNavigation\(posts,\s*route\.props\.post\.id\)/,
  );
  assert.match(
    source,
    /new Set\(\[\s*route\.props\.previous\?\.href,\s*route\.props\.next\?\.href,\s*series\?\.previous\?\.href,\s*series\?\.next\?\.href,?\s*\]\.filter\(/,
  );
  assert.match(
    source,
    /buildRelatedPosts\(posts,\s*route\.props\.post\.id,\s*\{[\s\S]*excludeHrefs:\s*excluded,[\s\S]*limit:\s*3,[\s\S]*\}\)/,
  );
  assert.match(source, /props:\s*\{\s*\.\.\.route\.props,\s*series,\s*related\s*\}/);
  assert.match(source, /series=\{series\}/);
  assert.match(source, /related=\{related\}/);
});

test('PostLayout selects series navigation and non-empty related reading', async () => {
  const source = await readSource('src/layouts/PostLayout.astro');

  assert.match(source, /import PostSeriesNavigation/);
  assert.match(source, /import RelatedPostList/);
  assert.match(source, /type SeriesNavigation/);
  assert.match(source, /type RelatedPostLink/);
  assert.match(
    source,
    /interface Props\s*\{[\s\S]*series\?:\s*SeriesNavigation;[\s\S]*related\?:\s*(?:readonly\s+)?RelatedPostLink\[\];/,
  );
  assert.match(source, /related\s*=\s*\[\]/);
  assert.match(
    source,
    /series\s*\?\s*\(\s*<PostSeriesNavigation\s+series=\{series\}\s*\/>\s*\)\s*:\s*\(\s*hasAdjacentPosts\s*&&\s*\(\s*<nav\s+class=["']post-pagination["']/,
  );
  assert.match(
    source,
    /related\.length\s*>\s*0\s*&&\s*\(\s*<RelatedPostList\s+posts=\{related\}\s*\/>\s*\)/,
  );
});

test('PostLayout discovery components use typed semantic links without nesting', async () => {
  const [seriesSource, relatedSource] = await Promise.all([
    readSource('src/components/PostSeriesNavigation.astro').catch(() => ''),
    readSource('src/components/RelatedPostList.astro').catch(() => ''),
  ]);

  assert.match(seriesSource, /import type \{ SeriesNavigation \}/);
  assert.match(seriesSource, /series:\s*SeriesNavigation;/);
  assert.match(seriesSource, />专栏阅读</);
  assert.match(seriesSource, /href=\{series\.href\}/);
  assert.match(seriesSource, /padStart\(2,\s*['"]0['"]\)/);
  assert.match(
    seriesSource,
    /<span\s+class=["']visually-hidden["']>\s*专栏进度：第\s*\{series\.position\}\s*节，共\s*\{series\.total\}\s*节\s*<\/span>/,
  );
  assert.match(
    seriesSource,
    /<span\s+aria-hidden=["']true["']>\{displayPosition\}\s*\/\s*\{displayTotal\}<\/span>/,
  );
  assert.doesNotMatch(seriesSource, /<p[^>]*aria-label=/);
  assert.match(seriesSource, /series\.previous\s*&&/);
  assert.match(seriesSource, /rel=["']prev["']/);
  assert.match(seriesSource, />上一节</);
  assert.match(seriesSource, /series\.next\s*&&/);
  assert.match(seriesSource, /rel=["']next["']/);
  assert.match(seriesSource, />下一节</);
  assertNoNestedAnchors(seriesSource, 'PostSeriesNavigation');

  assert.match(relatedSource, /import type \{ RelatedPostLink \}/);
  assert.match(relatedSource, /posts:\s*(?:readonly\s+)?RelatedPostLink\[\];/);
  assert.match(relatedSource, /posts\.length\s*>\s*0\s*&&/);
  assert.match(relatedSource, /<section[^>]*aria-labelledby=/);
  assert.match(relatedSource, />继续阅读</);
  assert.match(relatedSource, /posts\.map\(\(post\)\s*=>/);
  assert.match(relatedSource, /href=\{post\.href\}/);
  assert.equal(
    relatedSource.match(/\bhref=/g)?.length,
    1,
    'each related row should expose one public article link in source',
  );
  assert.match(relatedSource, /<time\s+datetime=\{post\.pubDate\.toISOString\(\)\}/);
  assert.match(relatedSource, /post\.description/);
  assert.match(relatedSource, /post\.category/);
  assert.match(relatedSource, /post\.column/);
  assert.match(relatedSource, /post\.tags\.map/);
  assertNoNestedAnchors(relatedSource, 'RelatedPostList');
});

test('PostLayout discovery styles stay dense, accessible, and responsive', async () => {
  const styles = await readSource('src/styles/global.css');
  const discoveryBlocks = [...styles.matchAll(
    /(?:\.post-series-navigation|\.related-post)[^{]*\{([^}]*)\}/g,
  )].map(([, declarations]) => declarations).join('\n');

  assert.match(
    styles,
    /\.post-series-navigation\s*\{(?=[^}]*border-top:\s*1px\s+solid\s+var\(--line\);)(?=[^}]*color:\s*var\(--ink\);)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.post-series-navigation__progress\s*\{[^}]*font-variant-numeric:\s*tabular-nums;[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.post-series-navigation__links\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.post-series-navigation__link\s*\{(?=[^}]*min-width:\s*0;)(?=[^}]*min-height:\s*2\.75rem;)(?=[^}]*background:\s*var\(--surface\);)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.related-post-list\s*\{[^}]*border-top:\s*1px\s+solid\s+var\(--line\);[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.related-post__link\s*\{(?=[^}]*min-width:\s*0;)(?=[^}]*min-height:\s*2\.75rem;)(?=[^}]*color:\s*var\(--ink\);)[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.related-post__description\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*\}/s,
  );
  assert.match(
    styles,
    /:is\(\.post-series-navigation__column,\s*\.post-series-navigation__link,\s*\.related-post__link\):focus-visible\s*\{[^}]*outline:/s,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*48rem\)\s*\{[\s\S]*?\.post-series-navigation__links\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*\}/,
  );
  assert.match(
    styles,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?:is\(\.post-series-navigation__link,\s*\.related-post\)\s*\{(?=[^}]*transition:\s*none;)(?=[^}]*opacity:\s*1;)(?=[^}]*transform:\s*none;)[^}]*\}/,
  );
  assert.doesNotMatch(discoveryBlocks, /(?:^|[;\s])height\s*:/);
  assert.doesNotMatch(
    discoveryBlocks,
    /white-space:\s*nowrap|-webkit-line-clamp|(?<!-webkit-)line-clamp/,
  );
});

test('PostLayout renders linked article taxonomy without nesting links', async () => {
  const source = await readSource('src/layouts/PostLayout.astro');

  assert.match(
    source,
    /interface Props\s*\{[\s\S]*category:\s*string;[\s\S]*column\?:\s*string;[\s\S]*columnOrder\?:\s*number;/,
  );
  assert.match(source, /getCategoryHref/);
  assert.match(source, /getColumnHref/);
  assert.match(source, /href=\{getCategoryHref\(category\)\}/);
  assert.match(source, /href=\{getColumnHref\(column\)\}/);
  assert.match(source, /padStart\(2,\s*['"]0['"]\)/);
  assert.match(source, /aria-label=["']文章分类与标签["']/);
  assert.match(source, /<TagList\s+tags=\{tags\}\s+compact\s*\/>/);
});

test('PostLayout derives both adaptive contents views from filtered h2 through h4 headings', async () => {
  const source = await readSource('src/layouts/PostLayout.astro');

  assert.match(
    source,
    /const tableOfContents\s*=\s*headings\.filter\([\s\S]*?heading\.depth\s*>=\s*2\s*&&\s*heading\.depth\s*<=\s*4/,
  );
  assert.match(
    source,
    /const hasTableOfContents\s*=\s*tableOfContents\.length\s*>=\s*2;/,
  );
  assert.match(
    source,
    /<aside\s+class=["']post-toc post-toc--desktop["']/,
  );
  assert.match(source, /<details\s+class=["']post-toc-compact["']/);
  assert.match(source, /<summary>本页目录<\/summary>/);
  assert.equal(
    source.match(/tableOfContents\.map/g)?.length,
    2,
    'desktop and compact contents should map the same filtered headings',
  );
  assert.doesNotMatch(source, /headings\.map/);
  assert.match(
    source,
    /hasTableOfContents\s*&&\s*['"]post-layout--with-toc['"]/,
  );
  assert.ok(
    source.indexOf('<details class="post-toc-compact"') <
      source.indexOf('<div class="prose">'),
    'compact contents should appear before the article body',
  );
});

test('PostLayout excludes blank heading labels and slugs from contents', async () => {
  const source = await readSource('src/layouts/PostLayout.astro');

  assert.match(
    source,
    /const tableOfContents\s*=\s*headings\.filter\(\s*\(heading\)\s*=>\s*heading\.depth\s*>=\s*2\s*&&\s*heading\.depth\s*<=\s*4\s*&&\s*heading\.text\.trim\(\)\.length\s*>\s*0\s*&&\s*heading\.slug\.trim\(\)\.length\s*>\s*0\s*,?\s*\);/,
  );
});

test('PostLayout shows compact contents only on narrow screens', async () => {
  const source = await readSource('src/layouts/PostLayout.astro');

  assert.match(
    source,
    /\.post-toc-compact\s*\{[^}]*display:\s*none;[^}]*\}/s,
  );
  assert.match(
    source,
    /@media\s*\(max-width:\s*64rem\)\s*\{[\s\S]*?\.post-toc-compact\s*\{[^}]*display:\s*block;[^}]*\}/,
  );
});

test('article layouts opt into safe BlogPosting metadata only when supplied', async () => {
  const [baseSource, postSource] = await Promise.all([
    readSource('src/layouts/BaseLayout.astro'),
    readSource('src/layouts/PostLayout.astro'),
  ]);

  assert.match(baseSource, /serializeJsonLd/);
  assert.match(baseSource, /application\/ld\+json/);
  assert.match(baseSource, /jsonLd\s*!==\s*undefined/);
  assert.match(postSource, /canonicalPath/);
  assert.match(postSource, /BlogPosting/);
  assert.match(postSource, /datePublished/);
  assert.match(postSource, /dateModified/);
  assert.match(postSource, /mainEntityOfPage/);
  assert.match(postSource, /articleSection:\s*category/);
  assert.match(postSource, /isPartOf/);
  assert.match(postSource, /['"]@type['"]:\s*['"]CollectionPage['"]/);
  assert.match(postSource, /name:\s*column/);
  assert.match(
    postSource,
    /new URL\(getColumnHref\(column\),\s*SITE\.canonicalOrigin\)\.href/,
  );
});

test('article and tag routes are driven by the real content collection', async () => {
  const [articleSource, tagsSource, tagSource] = await Promise.all([
    readSource('src/pages/posts/[...id].astro'),
    readSource('src/pages/tags/index.astro'),
    readSource('src/pages/tags/[tag].astro'),
  ]);

  assert.match(articleSource, /getCollection\(['"]posts['"]\)/);
  assert.match(articleSource, /render\(post\)/);
  assert.match(articleSource, /post\.body/);
  assert.match(articleSource, /getPostHref/);
  assert.match(tagsSource, /getCollection\(['"]posts['"]\)/);
  assert.match(tagsSource, /buildTagIndex/);
  assert.match(tagSource, /buildTagIndex/);
  assert.match(tagSource, /headingLevel=["']h2["']/);
});

test('tag pages keep touch targets accessible and collapse safely on mobile', async () => {
  const source = await readSource('src/styles/global.css');

  assert.match(
    source,
    /\.tag-directory__link\s*\{[^}]*min-height:\s*2\.75rem;[^}]*\}/s,
  );
  assert.match(source, /\.tag-page/);
  assert.match(
    source,
    /@media\s*\(max-width:[^)]+\)[\s\S]*\.tag-directory__link/s,
  );
});

test('article routes never expose an internal Feishu source URL', async () => {
  const [routeSource, schemaSource] = await Promise.all([
    readSource('src/pages/posts/[...id].astro'),
    readSource('src/content.config.ts'),
  ]);

  assert.doesNotMatch(`${routeSource}\n${schemaSource}`, /sourceUrl|feishuRecordId/);
});
