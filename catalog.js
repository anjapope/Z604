const catalogIndex = document.getElementById('catalogIndex');
const catalogDetail = document.getElementById('catalogDetail');
const catalogCount = document.getElementById('catalogCount');
const catalogControls = document.getElementById('catalogControls');
const catalogSearch = document.getElementById('catalogSearch');
const genreFilter = document.getElementById('genreFilter');
const formatFilter = document.getElementById('formatFilter');
const pageStatus = document.getElementById('pageStatus');
const prevPageButton = document.getElementById('prevPage');
const nextPageButton = document.getElementById('nextPage');
const filterStatus = document.getElementById('filterStatus');
const benchmarkReadout = document.getElementById('benchmarkReadout');

const PAGE_SIZE = 50;
let currentPage = 1;
let latestRenderToken = 0;
let selectedRecordId = null;
let hostedResults = [];
let hostedQuery = null;
const recordsById = new Map(CATALOG_ENTRIES.map(entry => [entry.recordId, entry]));

function escapeCatalogText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function safeCatalogEntry(entry) {
  return { ...Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, typeof value === 'string' ? escapeCatalogText(value) : value])), subjects: (entry.subjects || []).map(escapeCatalogText) };
}

function uniqueValues(entries, key) {
  return [...new Set(entries.map((entry) => entry[key]).filter(Boolean))].sort();
}

function fillSelect(select, values) {
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function matchesFilter(entry, query, genre, format) {
  const searchableText = entry.searchIndex || [
    entry.title,
    entry.author,
    entry.callNumber,
    entry.genre,
    entry.format,
    entry.audience,
    entry.location,
    ...(entry.subjects || [])
  ].join(' ').toLowerCase();

  const queryOk = !query || searchableText.includes(query);
  const genreOk = !genre || entry.genre === genre;
  const formatOk = !format || entry.format === format;

  return queryOk && genreOk && formatOk;
}

function renderDetail(entry) {
  const inventoryEntry = entry;
  const sourceUrl = entry.sourceUrl;
  entry = safeCatalogEntry(entry);
  const subjects = (entry.subjects || []).join(' • ');

  catalogDetail.innerHTML = `
    <p class="catalog-call">${entry.callNumber}</p>
    <h2>${entry.title}</h2>
    <p class="catalog-byline">${entry.author} · ${entry.year}</p>
    <p class="catalog-meta"><strong>Genre:</strong> ${entry.genre}</p>
    <p class="catalog-meta"><strong>Format:</strong> ${entry.format}</p>
    <p class="catalog-meta"><strong>Audience:</strong> ${entry.audience}</p>
    <p class="catalog-meta"><strong>Location:</strong> ${entry.location}</p>
    <p class="catalog-description">${entry.description}</p>
    <p class="catalog-subjects"><strong>Subjects:</strong> ${subjects}</p>
    <p class="catalog-open-wrap"><a class="catalog-open-link" href="catalog-detail.html?id=${encodeURIComponent(entry.recordId)}">Open full card page</a></p>
  `;
  window.PericlesInventory?.render(catalogDetail, inventoryEntry);
  if (/^https:\/\/openlibrary\.org\/works\/OL\d+W$/.test(sourceUrl || '')) {
    const source = document.createElement('a');
    source.href = sourceUrl;
    source.textContent = 'Bibliographic source: Open Library';
    source.rel = 'noopener noreferrer';
    catalogDetail.appendChild(source);
  }
}

function renderDetailPlaceholder(message) {
  catalogDetail.innerHTML = `<p class="catalog-empty">${message}</p>`;
}

function buildIndexItem(entry, isSelected, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `catalog-index-item${isSelected ? ' selected' : ''}`;
  button.title = `${entry.title} by ${entry.author} (${entry.year}) — ${entry.callNumber}. Click to view full card details.`;
  button.setAttribute('aria-label', `Open catalog card for ${entry.title} by ${entry.author}`);
  const safe = safeCatalogEntry(entry);
  button.innerHTML = `
    <p class="index-title">${safe.title}</p>
    <p class="index-meta">${safe.author} · ${safe.year}</p>
    <p class="index-meta">${safe.callNumber} · ${safe.format}</p>
  `;
  button.addEventListener('click', onClick);
  return button;
}

function renderIndex(pagedEntries) {
  catalogIndex.innerHTML = '';

  pagedEntries.forEach((entry) => {
    const item = buildIndexItem(
      entry,
      entry.recordId === selectedRecordId,
      () => {
        selectedRecordId = entry.recordId;
        renderIndex(pagedEntries);
        renderDetail(entry);
      }
    );

    catalogIndex.appendChild(item);
  });
}

function getFilteredEntries() {
  const query = catalogSearch.value.trim().toLowerCase();
  if (!query) {
    return [];
  }

  const genre = genreFilter.value;
  const format = formatFilter.value;

  return hostedResults.filter(entry => (!genre || entry.genre === genre) && (!format || entry.format === format));
}

function updatePaginationControls(totalItems, totalPages, startIndex, endIndex) {
  if (!totalItems) {
    pageStatus.textContent = 'No matching titles';
    prevPageButton.disabled = true;
    nextPageButton.disabled = true;
    return;
  }

  pageStatus.textContent = `Showing ${startIndex + 1}-${endIndex} of ${totalItems}`;
  prevPageButton.disabled = currentPage <= 1;
  nextPageButton.disabled = currentPage >= totalPages;
}

function updateFilterFeedback(isLoading, elapsedMs = null, scannedCount = null, matchedCount = null) {
  if (isLoading) {
    filterStatus.textContent = 'Filtering...';
    filterStatus.classList.add('loading');
    return;
  }

  filterStatus.textContent = 'Ready';
  filterStatus.classList.remove('loading');

  if (typeof elapsedMs === 'number') {
    if (typeof scannedCount === 'number' && typeof matchedCount === 'number') {
      benchmarkReadout.textContent = `Last update: ${elapsedMs.toFixed(1)} ms · ${scannedCount.toLocaleString()} scanned · ${matchedCount.toLocaleString()} matched`;
      return;
    }

    if (typeof scannedCount === 'number') {
      benchmarkReadout.textContent = `Last update: ${elapsedMs.toFixed(1)} ms · ${scannedCount.toLocaleString()} scanned`;
      return;
    }

    benchmarkReadout.textContent = `Last update: ${elapsedMs.toFixed(1)} ms`;
  }
}

function renderCatalog() {
  const query = catalogSearch.value.trim().toLowerCase();
  const hasSearch = query.length > 0;

  if (!hasSearch) {
    catalogIndex.innerHTML = '<p class="catalog-empty">Type in the search box to begin browsing the catalog index.</p>';
    selectedRecordId = null;
    renderDetailPlaceholder('Search for a title, author, subject, or call number to view a catalog card.');
    catalogCount.textContent = '0 titles';
    pageStatus.textContent = 'Enter a search to begin';
    prevPageButton.disabled = true;
    nextPageButton.disabled = true;
    return 0;
  }

  const filtered = getFilteredEntries();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, filtered.length);
  const pagedEntries = filtered.slice(startIndex, endIndex);

  if (!filtered.length) {
    catalogIndex.innerHTML = '<p class="catalog-empty">No titles match your filters. Try a broader search.</p>';
    selectedRecordId = null;
    renderDetailPlaceholder('Select a result from the index to view full details.');
  } else {
    const selectedInPage = pagedEntries.find((entry) => entry.recordId === selectedRecordId);
    if (!selectedInPage && pagedEntries.length) {
      selectedRecordId = pagedEntries[0].recordId;
    }

    const activeEntry = pagedEntries.find((entry) => entry.recordId === selectedRecordId) || pagedEntries[0];
    renderIndex(pagedEntries);
    renderDetail(activeEntry);
  }

  const label = filtered.length === 1 ? 'title' : 'titles';
  catalogCount.textContent = `${filtered.length} ${label} (from up to 50 API records)`;
  updatePaginationControls(filtered.length, totalPages, startIndex, endIndex);

  return filtered.length;
}

function scheduleRender() {
  const token = latestRenderToken + 1;
  latestRenderToken = token;
  updateFilterFeedback(true);

  requestAnimationFrame(async () => {
    if (token !== latestRenderToken) {
      return;
    }

    const startedAt = performance.now();
    const query = catalogSearch.value.trim().toLowerCase();
    try {
      if (query && query !== hostedQuery) {
        const response = await window.PericlesApi.fetch(`/api/catalog/search?q=${encodeURIComponent(query)}&limit=50`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Catalog search is unavailable.');
        if (token !== latestRenderToken) return;
        hostedResults = payload.results.map(record => ({ ...recordsById.get(record.recordId), ...record }));
        hostedQuery = query;
      }
    } catch (error) {
      if (token !== latestRenderToken) return;
      hostedQuery = null;
      hostedResults = [];
      catalogIndex.replaceChildren();
      catalogDetail.textContent = error.message;
      catalogCount.textContent = 'Search unavailable';
      pageStatus.textContent = 'Search unavailable';
      prevPageButton.disabled = true;
      nextPageButton.disabled = true;
      updateFilterFeedback(false);
      filterStatus.textContent = 'Search unavailable';
      return;
    }
    const matchedCount = renderCatalog();
    const elapsedMs = performance.now() - startedAt;
    const scannedCount = hostedResults.length;

    if (token === latestRenderToken) {
      updateFilterFeedback(false, elapsedMs, scannedCount, matchedCount);
    }
  });
}

function resetToFirstPageAndRender() {
  currentPage = 1;
  scheduleRender();
}

function goToPreviousPage() {
  if (currentPage > 1) {
    currentPage -= 1;
    scheduleRender();
  }
}

function goToNextPage() {
  const filtered = getFilteredEntries();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage < totalPages) {
    currentPage += 1;
    scheduleRender();
  }
}

fillSelect(genreFilter, uniqueValues(CATALOG_ENTRIES, 'genre'));
fillSelect(formatFilter, uniqueValues(CATALOG_ENTRIES, 'format'));

if (catalogControls) {
  catalogControls.addEventListener('submit', (event) => {
    event.preventDefault();
    resetToFirstPageAndRender();
  });
}

catalogSearch.addEventListener('input', debounce(resetToFirstPageAndRender, 180));
genreFilter.addEventListener('change', resetToFirstPageAndRender);
formatFilter.addEventListener('change', resetToFirstPageAndRender);
prevPageButton.addEventListener('click', goToPreviousPage);
nextPageButton.addEventListener('click', goToNextPage);

scheduleRender();
