import { searchEntries, type SearchEntry } from '../lib/search';

interface SearchIndexPayload {
  version?: unknown;
  entries?: unknown;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSameOriginPath(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && value.startsWith('/');
  } catch {
    return false;
  }
}

function isSearchEntry(value: unknown): value is SearchEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const entry = value as Partial<SearchEntry>;
  return (
    typeof entry.href === 'string' &&
    isSameOriginPath(entry.href) &&
    typeof entry.title === 'string' &&
    typeof entry.description === 'string' &&
    typeof entry.pubDate === 'string' &&
    typeof entry.category === 'string' &&
    (entry.column === undefined || typeof entry.column === 'string') &&
    (entry.columnOrder === undefined || typeof entry.columnOrder === 'number') &&
    isStringArray(entry.tags) &&
    typeof entry.readingMinutes === 'number' &&
    typeof entry.searchText === 'string'
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return (
    target.matches('input, textarea, select, [contenteditable]') ||
    target.closest('[contenteditable]') !== null
  );
}

(() => {
  const dialogNode = document.querySelector<HTMLDialogElement>('#site-search');
  const openers = document.querySelectorAll<HTMLButtonElement>('[data-search-open]');
  const inputNode = document.querySelector<HTMLInputElement>('[data-search-input]');
  const resultsNode = document.querySelector<HTMLOListElement>('[data-search-results]');
  const statusNode = document.querySelector<HTMLElement>('[data-search-status]');
  const closeButtonNode = document.querySelector<HTMLButtonElement>('[data-search-close]');

  if (
    !dialogNode ||
    openers.length === 0 ||
    !inputNode ||
    !resultsNode ||
    !statusNode ||
    !closeButtonNode
  ) {
    return;
  }

  const dialog = dialogNode;
  const input = inputNode;
  const results = resultsNode;
  const status = statusNode;
  const closeButton = closeButtonNode;

  let searchIndexPromise: Promise<readonly SearchEntry[]> | undefined;
  let loadedEntries: readonly SearchEntry[] | undefined;
  let resultAnchors: HTMLAnchorElement[] = [];
  let activeIndex = -1;
  let returnFocusTo: HTMLButtonElement = openers[0];

  function loadSearchIndex(): Promise<readonly SearchEntry[]> {
    searchIndexPromise ??= fetch('/search-index.json', {
      headers: { accept: 'application/json' }
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error('Search index request failed.');
      }

      const payload: SearchIndexPayload = await response.json();
      if (payload.version !== 1 || !Array.isArray(payload.entries)) {
        throw new Error('Search index payload is invalid.');
      }
      if (!payload.entries.every(isSearchEntry)) {
        throw new Error('Search index entries are invalid.');
      }

      return payload.entries;
    });

    return searchIndexPromise;
  }

  function updateActiveResult(nextIndex: number): void {
    if (resultAnchors.length === 0 || nextIndex < 0) {
      activeIndex = -1;
      resultAnchors.forEach((anchor) => anchor.removeAttribute('aria-current'));
      return;
    }

    activeIndex =
      ((nextIndex % resultAnchors.length) + resultAnchors.length) %
      resultAnchors.length;
    resultAnchors.forEach((anchor, index) => {
      if (index === activeIndex) {
        anchor.setAttribute('aria-current', 'true');
      } else {
        anchor.removeAttribute('aria-current');
      }
    });
  }

  function createResult(entry: SearchEntry): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'search-dialog__result';

    const anchor = document.createElement('a');
    anchor.href = entry.href;
    anchor.dataset.searchResult = '';

    const title = document.createElement('span');
    title.className = 'search-dialog__result-title';
    title.textContent = entry.title;

    const description = document.createElement('span');
    description.className = 'search-dialog__result-description';
    description.textContent = entry.description;

    const metadata = document.createElement('span');
    metadata.className = 'search-dialog__result-meta';
    metadata.textContent = [
      entry.pubDate,
      entry.category,
      entry.column,
      ...entry.tags,
    ]
      .filter((value): value is string => typeof value === 'string' && value !== '')
      .join(' · ');

    anchor.append(title, description, metadata);
    item.append(anchor);
    return item;
  }

  function renderCurrentQuery(): void {
    if (loadedEntries === undefined) {
      return;
    }

    const query = input.value.trim();
    const matches = searchEntries(loadedEntries, query, 8);
    const fragment = document.createDocumentFragment();
    const nextAnchors: HTMLAnchorElement[] = [];

    for (const entry of matches) {
      const item = createResult(entry);
      const anchor = item.querySelector<HTMLAnchorElement>('[data-search-result]');
      if (anchor !== null) {
        nextAnchors.push(anchor);
      }
      fragment.append(item);
    }

    results.replaceChildren(fragment);
    resultAnchors = nextAnchors;
    updateActiveResult(-1);

    if (query === '') {
      status.textContent = '最近更新';
    } else if (matches.length === 0) {
      status.textContent = status.dataset.searchEmpty ?? '没有找到相关文章';
    } else {
      status.textContent = `找到 ${matches.length} 篇文章`;
    }
  }

  async function openSearch(opener: HTMLButtonElement): Promise<void> {
    returnFocusTo = opener;
    if (!dialog.open) {
      dialog.showModal();
    }
    input.focus();

    status.textContent = status.dataset.searchLoading ?? '正在加载文章…';
    try {
      loadedEntries = await loadSearchIndex();
      renderCurrentQuery();
    } catch {
      loadedEntries = undefined;
      resultAnchors = [];
      activeIndex = -1;
      results.replaceChildren();
      status.textContent = status.dataset.searchError ?? '搜索暂不可用';
    }
  }

  openers.forEach((opener) => {
    opener.addEventListener('click', () => {
      void openSearch(opener);
    });
  });

  closeButton.addEventListener('click', () => dialog.close());
  input.addEventListener('input', renderCurrentQuery);

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      updateActiveResult(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      updateActiveResult(activeIndex <= 0 ? resultAnchors.length - 1 : activeIndex - 1);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      resultAnchors[activeIndex]?.click();
    }
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  dialog.addEventListener('close', () => {
    updateActiveResult(-1);
    returnFocusTo.focus();
  });

  document.addEventListener('keydown', (event) => {
    const commandShortcut =
      event.key.toLocaleLowerCase('en-US') === 'k' &&
      (event.metaKey || event.ctrlKey);
    const slashShortcut = event.key === '/' && !isEditableTarget(event.target);

    if (!commandShortcut && !slashShortcut) {
      return;
    }

    event.preventDefault();
    void openSearch(openers[0]);
  });

  openers.forEach((opener) => {
    opener.hidden = false;
  });
})();
