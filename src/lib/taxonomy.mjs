const UTF8_ENCODER = new TextEncoder();

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {string}
 */
function requireEntryId(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} entry id must be a non-empty string.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {string} id
 * @returns {string}
 */
function requireLabel(value, name, id) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string for entry "${id}".`);
  }
  return value;
}

/** @param {string} label */
export function canonicalizeTaxonomyLabel(label) {
  return label.trim().normalize('NFKC').toLowerCase();
}

/** @param {string} label */
export function getTaxonomyLabel(label) {
  return label.trim().normalize('NFKC');
}

/** @param {string} value */
function fnv1aHash(value) {
  let hash = 0x811c9dc5;

  for (const byte of UTF8_ENCODER.encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

/** @param {string} label */
export function normalizeTaxonomySlug(label) {
  const canonicalLabel = canonicalizeTaxonomyLabel(label);
  const base = canonicalLabel
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const hash = fnv1aHash(canonicalLabel);

  if (!base) {
    return `tag-${hash}`;
  }

  if (/[^\p{Letter}\p{Number}\s-]/u.test(canonicalLabel)) {
    return `${base}-${hash}`;
  }

  return base;
}

/**
 * @typedef {{ id: string, category: unknown }} CategoryTaxonomyEntry
 * @param {readonly CategoryTaxonomyEntry[]} entries
 */
export function validateCategoryEntries(entries) {
  const entryBySlug = new Map();

  for (const entry of entries) {
    const id = requireEntryId(entry?.id, 'Category');
    const category = requireLabel(entry?.category, 'Category', id);
    const canonicalCategory = canonicalizeTaxonomyLabel(category);
    const slug = normalizeTaxonomySlug(category);
    const first = entryBySlug.get(slug);

    if (first !== undefined && first.canonical !== canonicalCategory) {
      throw new Error(
        `Category route collision for slug "${slug}": label "${first.label}" ` +
          `(canonical "${first.canonical}") from entry "${first.id}" conflicts with ` +
          `label "${getTaxonomyLabel(category)}" (canonical "${canonicalCategory}") ` +
          `from entry "${id}".`,
      );
    }

    if (first === undefined) {
      entryBySlug.set(slug, {
        canonical: canonicalCategory,
        id,
        label: getTaxonomyLabel(category),
      });
    }
  }
}

/**
 * @typedef {{ id: string, column?: unknown, columnOrder?: unknown }} ColumnTaxonomyEntry
 * @param {readonly ColumnTaxonomyEntry[]} entries
 */
export function validateColumnEntries(entries) {
  const entryBySlug = new Map();
  const entryByOrderByCanonicalColumn = new Map();

  for (const entry of entries) {
    const id = requireEntryId(entry?.id, 'Column');
    const { column, columnOrder } = entry;
    const hasColumn = column !== undefined;
    const hasColumnOrder = columnOrder !== undefined;

    if (!hasColumn) {
      if (hasColumnOrder) {
        throw new Error(
          `Column order ${String(columnOrder)} exists without a column for entry "${id}".`,
        );
      }
      continue;
    }

    const columnLabel = requireLabel(column, 'Column', id);
    if (
      !hasColumnOrder ||
      !Number.isSafeInteger(columnOrder) ||
      columnOrder <= 0
    ) {
      throw new Error(
        `Column order must be a positive integer within the safe integer range for entry "${id}".`,
      );
    }

    const canonicalColumn = canonicalizeTaxonomyLabel(columnLabel);
    const slug = normalizeTaxonomySlug(columnLabel);
    const firstForSlug = entryBySlug.get(slug);

    if (
      firstForSlug !== undefined &&
      firstForSlug.canonical !== canonicalColumn
    ) {
      throw new Error(
        `Column route collision for slug "${slug}": label "${firstForSlug.label}" ` +
          `(canonical "${firstForSlug.canonical}") from entry "${firstForSlug.id}" conflicts with ` +
          `label "${getTaxonomyLabel(columnLabel)}" (canonical "${canonicalColumn}") ` +
          `from entry "${id}".`,
      );
    }

    if (firstForSlug === undefined) {
      entryBySlug.set(slug, {
        canonical: canonicalColumn,
        id,
        label: getTaxonomyLabel(columnLabel),
      });
    }

    let entryByOrder = entryByOrderByCanonicalColumn.get(canonicalColumn);
    if (entryByOrder === undefined) {
      entryByOrder = new Map();
      entryByOrderByCanonicalColumn.set(canonicalColumn, entryByOrder);
    }

    const firstForOrder = entryByOrder.get(columnOrder);
    if (firstForOrder !== undefined) {
      throw new Error(
        `Column "${getTaxonomyLabel(columnLabel)}" has duplicate order ${columnOrder} ` +
          `for entries "${firstForOrder}" and "${id}".`,
      );
    }
    entryByOrder.set(columnOrder, id);
  }
}
