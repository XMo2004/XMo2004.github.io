import {
  CODE_LANGUAGES,
  normalizeFeishuDocument,
  TEXT_PROPERTY_BY_TYPE,
} from './semantics.mjs';
import { renderFeishuDocument } from './markdown.mjs';

const SUPPORTED_BLOCK_TYPES = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 14, 15, 17, 19, 22, 27, 31, 32, 49,
]);

const CONTAINER_BLOCK_TYPES = new Set([1, 12, 13, 17, 19, 31, 32, 49]);

const MEDIA_TOKEN = /^[A-Za-z0-9_-]+$/;
export class FeishuConversionError extends Error {
  constructor(issues) {
    super(
      `Feishu document conversion failed:\n${issues
        .map((issue) => `- ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'FeishuConversionError';
    this.issues = issues.map((issue) => ({ ...issue }));
  }
}

function issue(code, message, blockId) {
  return { code, message, ...(blockId ? { blockId } : {}) };
}

function blockChildren(block, issues) {
  if (block.children === undefined) {
    return [];
  }
  if (!Array.isArray(block.children)) {
    issues.push(
      issue(
        'invalid_children',
        `Block "${block.block_id}" has a non-array children value.`,
        block.block_id,
      ),
    );
    return [];
  }
  return block.children;
}

function validateRichElements(block, elements, issues) {
  if (!Array.isArray(elements)) {
    issues.push(
      issue(
        'invalid_elements',
        `Block "${block.block_id}" has no valid rich-text elements array.`,
        block.block_id,
      ),
    );
    return;
  }

  for (const element of elements) {
    if (element === null || typeof element !== 'object' || Array.isArray(element)) {
      issues.push(
        issue(
          'invalid_element',
          `Block "${block.block_id}" contains an invalid rich-text element.`,
          block.block_id,
        ),
      );
      continue;
    }

    const elementTypes = Object.keys(element);
    if (
      elementTypes.length !== 1 ||
      !['text_run', 'equation'].includes(elementTypes[0])
    ) {
      const names = elementTypes.length > 0 ? elementTypes.join(', ') : '<empty>';
      for (const elementType of elementTypes.length > 0 ? elementTypes : ['<empty>']) {
        issues.push(
          issue(
            'unsupported_rich_element',
            `Block "${block.block_id}" uses unsupported rich-text element "${elementType}" (${names}).`,
            block.block_id,
          ),
        );
      }
      continue;
    }

  }
}

function validateBlocks(items) {
  const issues = [];
  const blocks = new Map();

  if (!Array.isArray(items)) {
    throw new FeishuConversionError([
      issue('invalid_input', 'Block list must be an array.'),
    ]);
  }

  const referenceSyncedIssues = items
    .filter(
      (block) =>
        block !== null &&
        typeof block === 'object' &&
        !Array.isArray(block) &&
        block.block_type === 50,
    )
    .map((block) =>
      issue(
        'unsupported_reference_synced',
        'Block is a reference synced block; only source synced blocks are supported.',
        typeof block.block_id === 'string' && block.block_id.length > 0
          ? block.block_id
          : undefined,
      ),
    );
  if (referenceSyncedIssues.length > 0) {
    throw new FeishuConversionError(referenceSyncedIssues);
  }

  for (const block of items) {
    if (
      block === null ||
      typeof block !== 'object' ||
      Array.isArray(block) ||
      typeof block.block_id !== 'string' ||
      block.block_id.length === 0 ||
      !Number.isInteger(block.block_type)
    ) {
      issues.push(issue('invalid_block', 'Document contains an invalid block object.'));
      continue;
    }

    if (blocks.has(block.block_id)) {
      issues.push(
        issue(
          'duplicate_block_id',
          `Duplicate block id "${block.block_id}".`,
          block.block_id,
        ),
      );
      continue;
    }
    blocks.set(block.block_id, block);

    if (!SUPPORTED_BLOCK_TYPES.has(block.block_type)) {
      issues.push(
        issue(
          'unsupported_block_type',
          `Block "${block.block_id}" has unsupported block type ${block.block_type}.`,
          block.block_id,
        ),
      );
      continue;
    }

    if (
      !CONTAINER_BLOCK_TYPES.has(block.block_type) &&
      Array.isArray(block.children) &&
      block.children.length > 0
    ) {
      issues.push(
        issue(
          'leaf_block_children',
          `Leaf block "${block.block_id}" has children, which are not supported for block type ${block.block_type}.`,
          block.block_id,
        ),
      );
    }

    const textProperty = TEXT_PROPERTY_BY_TYPE.get(block.block_type);
    if (textProperty !== undefined) {
      const textData = block[textProperty];
      if (textData === null || typeof textData !== 'object') {
        issues.push(
          issue(
            'missing_block_data',
            `Block "${block.block_id}" is missing "${textProperty}" data.`,
            block.block_id,
          ),
        );
      } else {
        validateRichElements(block, textData.elements, issues);
      }
    }

    if (
      block.block_type === 14 &&
      block.code?.style?.language !== undefined &&
      !CODE_LANGUAGES.has(block.code.style.language)
    ) {
      issues.push(
        issue(
          'unsupported_code_language',
          `Code block "${block.block_id}" has unsupported language enum ${String(block.code.style.language)}.`,
          block.block_id,
        ),
      );
    }

    if (block.block_type === 27) {
      const token = block.image?.token;
      if (typeof token !== 'string' || !MEDIA_TOKEN.test(token)) {
        issues.push(
          issue(
            'invalid_media_token',
            `Image block "${block.block_id}" has an invalid media token.`,
            block.block_id,
          ),
        );
      }
    }
  }

  const pageRoots = [...blocks.values()].filter((block) => block.block_type === 1);
  if (pageRoots.length !== 1) {
    issues.push(
      issue(
        'invalid_page_root',
        `Document must contain exactly one page root; found ${pageRoots.length}.`,
      ),
    );
  }

  for (const block of blocks.values()) {
    if (block.block_type === 31) {
      const table = block.table;
      const rowSize = table?.property?.row_size;
      const columnSize = table?.property?.column_size;
      const cells = table?.cells;

      if (
        table === null ||
        typeof table !== 'object' ||
        !Number.isInteger(rowSize) ||
        rowSize < 1 ||
        !Number.isInteger(columnSize) ||
        columnSize < 1
      ) {
        issues.push(
          issue(
            'invalid_table_dimensions',
            `Table block "${block.block_id}" must have positive integer row_size and column_size dimensions.`,
            block.block_id,
          ),
        );
      }

      if (!Array.isArray(cells)) {
        issues.push(
          issue(
            'invalid_table_cells',
            `Table block "${block.block_id}" must have a cells array.`,
            block.block_id,
          ),
        );
        continue;
      }

      if (
        Number.isInteger(rowSize) &&
        rowSize > 0 &&
        Number.isInteger(columnSize) &&
        columnSize > 0 &&
        cells.length !== rowSize * columnSize
      ) {
        issues.push(
          issue(
            'invalid_table_cell_count',
            `Table block "${block.block_id}" cell count must be ${rowSize * columnSize}; found ${cells.length}.`,
            block.block_id,
          ),
        );
      }

      const children = Array.isArray(block.children) ? block.children : [];
      if (
        cells.length !== children.length ||
        cells.some((cellId, index) => cellId !== children[index])
      ) {
        issues.push(
          issue(
            'table_children_mismatch',
            `Table block "${block.block_id}" children must match its ordered cells array.`,
            block.block_id,
          ),
        );
      }

      const seenCells = new Set();
      for (const cellId of cells) {
        if (seenCells.has(cellId)) {
          issues.push(
            issue(
              'duplicate_table_cell',
              `Table block "${block.block_id}" references duplicate cell "${cellId}".`,
              block.block_id,
            ),
          );
          continue;
        }
        seenCells.add(cellId);

        const cell = blocks.get(cellId);
        if (cell !== undefined && cell.block_type !== 32) {
          issues.push(
            issue(
              'invalid_table_cell_type',
              `Table block "${block.block_id}" cell "${cellId}" must have block type 32.`,
              block.block_id,
            ),
          );
        }
      }
    }

    if (block.block_type === 32) {
      const parent = blocks.get(block.parent_id);
      if (
        parent === undefined ||
        parent.block_type !== 31 ||
        !Array.isArray(parent.table?.cells) ||
        !parent.table.cells.includes(block.block_id)
      ) {
        issues.push(
          issue(
            'orphan_table_cell',
            `Table cell "${block.block_id}" must belong to a table cells array.`,
            block.block_id,
          ),
        );
      }

      for (const childId of Array.isArray(block.children) ? block.children : []) {
        const child = blocks.get(childId);
        if (
          child !== undefined &&
          (child.block_type !== 2 ||
            (Array.isArray(child.children) && child.children.length > 0))
        ) {
          issues.push(
            issue(
              'complex_table_cell',
              `Table cell "${block.block_id}" contains complex child "${childId}"; only plain text blocks are supported.`,
              block.block_id,
            ),
          );
        }
      }
    }
  }

  const referencedBy = new Map();
  for (const block of blocks.values()) {
    for (const childId of blockChildren(block, issues)) {
      if (typeof childId !== 'string' || !blocks.has(childId)) {
        issues.push(
          issue(
            'missing_child',
            `Block "${block.block_id}" references missing child "${String(childId)}".`,
            block.block_id,
          ),
        );
        continue;
      }

      const child = blocks.get(childId);
      if (child.parent_id !== block.block_id) {
        issues.push(
          issue(
            'parent_mismatch',
            `Parent mismatch for block "${childId}": referenced by "${block.block_id}" but parent_id is "${String(child.parent_id)}".`,
            childId,
          ),
        );
      }

      const firstParent = referencedBy.get(childId);
      if (firstParent !== undefined && firstParent !== block.block_id) {
        issues.push(
          issue(
            'multiple_parents',
            `Block "${childId}" is referenced by multiple parents "${firstParent}" and "${block.block_id}".`,
            childId,
          ),
        );
      } else {
        referencedBy.set(childId, block.block_id);
      }
    }
  }

  const visited = new Set();
  const active = new Set();

  function detectCycles(blockId) {
    if (active.has(blockId)) {
      issues.push(
        issue(
          'cycle',
          `Cycle detected at block "${blockId}".`,
          blockId,
        ),
      );
      return;
    }
    if (visited.has(blockId)) {
      return;
    }

    const block = blocks.get(blockId);
    if (block === undefined) {
      return;
    }

    active.add(blockId);
    for (const childId of Array.isArray(block.children) ? block.children : []) {
      if (blocks.has(childId)) {
        detectCycles(childId);
      }
    }
    active.delete(blockId);
    visited.add(blockId);
  }

  for (const blockId of blocks.keys()) {
    detectCycles(blockId);
  }

  const root = pageRoots[0];
  if (root !== undefined) {
    if (root.parent_id !== undefined && root.parent_id !== '') {
      issues.push(
        issue(
          'page_has_parent',
          `Page root "${root.block_id}" must not have parent_id.`,
          root.block_id,
        ),
      );
    }

    const reachable = new Set();
    const pending = [root.block_id];
    while (pending.length > 0) {
      const blockId = pending.pop();
      if (reachable.has(blockId)) {
        continue;
      }

      const block = blocks.get(blockId);
      if (block === undefined) {
        continue;
      }

      reachable.add(blockId);
      for (const childId of Array.isArray(block.children) ? block.children : []) {
        if (blocks.has(childId)) {
          pending.push(childId);
        }
      }
    }

    for (const blockId of blocks.keys()) {
      if (!reachable.has(blockId)) {
        issues.push(
          issue(
            'orphan_block',
            `Orphan block "${blockId}" is not reachable from page root "${root.block_id}".`,
            blockId,
          ),
        );
      }
    }
  }

  if (issues.length > 0) {
    throw new FeishuConversionError(issues);
  }

  return { blocks, root };
}

export function blocksToMarkdown(items) {
  const { blocks, root } = validateBlocks(items);
  const normalized = normalizeFeishuDocument({ blocks, root });
  if (normalized.issues.length > 0) {
    throw new FeishuConversionError(normalized.issues);
  }
  const rendered = renderFeishuDocument(normalized.document);
  if (rendered.issues.length > 0) {
    throw new FeishuConversionError(rendered.issues);
  }
  return rendered.conversion;
}
