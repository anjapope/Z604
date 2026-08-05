const catalogDetailPage = document.getElementById('catalogDetailPage');

function getRecordIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function renderMissingRecord() {
  catalogDetailPage.innerHTML = '<p class="catalog-empty">Catalog record not found. Return to the index and open a record again.</p>';
}

function renderRecord(entry) {
  const subjects = (entry.subjects || []).join(' • ');

  catalogDetailPage.innerHTML = `
    <p class="catalog-call">${entry.callNumber}</p>
    <h2>${entry.title}</h2>
    <p class="catalog-byline">${entry.author} · ${entry.year}</p>
    <p class="catalog-meta"><strong>Record ID:</strong> ${entry.recordId}</p>
    <p class="catalog-meta"><strong>Genre:</strong> ${entry.genre}</p>
    <p class="catalog-meta"><strong>Format:</strong> ${entry.format}</p>
    <p class="catalog-meta"><strong>Audience:</strong> ${entry.audience}</p>
    <p class="catalog-meta"><strong>Location:</strong> ${entry.location}</p>
    <p class="catalog-description">${entry.description}</p>
    <p class="catalog-subjects"><strong>Subjects:</strong> ${subjects}</p>
  `;
}

const recordId = getRecordIdFromQuery();
const entry = CATALOG_ENTRIES.find((item) => item.recordId === recordId);

if (!entry) {
  renderMissingRecord();
} else {
  renderRecord(entry);
}
