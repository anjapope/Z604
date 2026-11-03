'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCatalog() {
  const filePath = path.resolve(__dirname, '..', 'catalog-data.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${source}\nglobalThis.__catalog = { seed: CATALOG_SEED_ENTRIES, entries: CATALOG_ENTRIES };`,
    context
  );

  if (!Array.isArray(context.__catalog?.seed) || !Array.isArray(context.__catalog?.entries)) {
    throw new Error('Catalog data did not expose valid seed and generated records.');
  }

  return {
    seed: context.__catalog.seed.map((entry) => ({ ...entry })),
    entries: context.__catalog.entries.map((entry) => ({
      ...entry,
      subjects: [...(entry.subjects || [])]
    }))
  };
}

const { seed: CATALOG_SEED, entries: CATALOG_ENTRIES } = loadCatalog();
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'what', 'when', 'where',
  'about', 'have', 'how', 'your', 'you', 'are', 'can', 'into', 'than', 'does',
  'stapleton', 'library', 'catalog', 'available', 'copy', 'find', 'show', 'list',
  'recommend', 'recommendations', 'do', 'of', 'is', 'in', 'on', 'at', 'by', 'any'
]);
const FORMATS = [
  'Large Print',
  'Print Book',
  'Audiobook',
  'Ebook'
];

function tokenize(query) {
  return String(query)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => (token.length >= 3 || token === 'ai') && !STOPWORDS.has(token));
}

function resolveFormat(query) {
  const normalized = query.toLowerCase();
  if (/\b(ebooks?|e-books?)\b/.test(normalized)) return 'Ebook';
  if (/\b(audiobooks?|audio books?)\b/.test(normalized)) return 'Audiobook';
  if (/\blarge[- ]print\b/.test(normalized)) return 'Large Print';
  if (/\b(print books?|physical books?)\b/.test(normalized)) return 'Print Book';
  return null;
}

function resolveFictionFilter(query) {
  return /\bfiction\b/i.test(query) && !/\b(?:do not|don't|not|avoid|no)\s+(?:want\s+)?fiction\b/i.test(query);
}

function scoreEntry(entry, query, tokens) {
  const normalizedQuery = query.toLowerCase().trim();
  const title = entry.title.toLowerCase();
  const author = entry.author.toLowerCase();
  const subjects = (entry.subjects || []).join(' ').toLowerCase();
  const index = `${title} ${author} ${entry.genre} ${entry.format} ${entry.callNumber} ${entry.location} ${subjects}`.toLowerCase();
  let score = 0;

  if (normalizedQuery && title.includes(normalizedQuery)) score += 20;
  if (normalizedQuery && author.includes(normalizedQuery)) score += 14;
  if (normalizedQuery && entry.callNumber.toLowerCase().includes(normalizedQuery)) score += 12;

  for (const token of tokens) {
    if (title.includes(token)) score += 8;
    if (author.includes(token)) score += 7;
    if (subjects.includes(token)) score += 5;
    if (entry.genre.toLowerCase().includes(token)) score += 5;
    if (entry.format.toLowerCase().includes(token)) score += 4;
    if (index.includes(token)) score += 1;
  }

  return score;
}

function searchCatalog(query, { limit = 10, format = null, fiction = false, author = null } = {}) {
  const tokens = tokenize(query);
  const targetFormat = format || resolveFormat(query);
  const onlyFiction = fiction || resolveFictionFilter(query);

  return CATALOG_ENTRIES
    .filter((entry) => (!author || entry.author.toLowerCase().includes(author.toLowerCase()))
      && (!targetFormat || entry.format === targetFormat)
      && (!onlyFiction || /fiction|fantasy|mystery|thriller/i.test(entry.genre)))
    .map((entry) => ({ entry, score: scoreEntry(entry, query, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.entry.recordId.localeCompare(right.entry.recordId))
    .slice(0, Math.max(1, Math.min(50, limit)))
    .map(({ entry }) => entry);
}

function getCatalogSummary() {
  const formats = {};
  const genres = {};
  const uniqueSeedTitles = new Set(CATALOG_SEED.map((entry) => entry.title));

  for (const entry of CATALOG_ENTRIES) {
    formats[entry.format] = (formats[entry.format] || 0) + 1;
    genres[entry.genre] = (genres[entry.genre] || 0) + 1;
  }

  return {
    totalRecords: CATALOG_ENTRIES.length,
    uniqueSeedTitles: uniqueSeedTitles.size,
    formats,
    genres
  };
}

function isCollectionQuestion(message) {
  return /\b(?:how broad|how large|how many (?:titles|records)|collection size|catalog(?:ue)? size|describe (?:the |your )?collection)\b/i.test(message) || /^(?:what do you have|tell me about (?:your |the )?(?:catalog(?:ue)?|collection|holdings))[?.!]*$/i.test(message.trim());
}

function isCatalogQuestion(message) {
  return /\b(catalog(?:ue)?|holdings|have (?:a copy|this|that|any|the)|do you have|does (?:stapleton|the library) have|fiction|ebooks?|e-books?|audiobooks?|large print|call number|recommend(?:ation)?s? (?:a |some )?(?:book|novel)|books? (?:about|on|by)|book by|title)\b/i.test(message);
}

function getRequestedTitle(message) {
  if (/\bbooks?\s+(?:by|about|on)\b/i.test(message)) return null;
  const quotedTitle = message.match(/["“]([^"”]+)["”]/);
  if (quotedTitle) return quotedTitle[1].trim();

  const titleRequest = message.match(/\b(?:do you have|does (?:stapleton|the library) have|can i borrow|is there a copy of)\s+(?:a copy of\s+|a book called\s+|the book\s+|the novel\s+)?((?:[A-Z0-9][A-Za-z0-9:'’-]*\s+){1,}[A-Z0-9][A-Za-z0-9:'’-]*)[?.!]*$/i);
  return titleRequest?.[1]?.trim() || null;
}

function findExactTitle(title) {
  const normalizedTitle = title.toLowerCase().replace(/\s+\(copy \d+\)$/i, '').trim();
  return CATALOG_ENTRIES.find((entry) =>
    entry.title.toLowerCase().replace(/\s+\(copy \d+\)$/i, '').trim() === normalizedTitle
  ) || null;
}

function answerCatalogQuestion(message, searchQuery = message) {
  if (isCollectionQuestion(message)) {
    const summary = getCatalogSummary();
    const formats = Object.entries(summary.formats)
      .map(([format, count]) => `${format}: ${count.toLocaleString()}`)
      .join('; ');
    const genres = Object.entries(summary.genres)
      .map(([genre, count]) => `${genre}: ${count.toLocaleString()}`)
      .join('; ');

    return `Stapleton's demonstration catalog contains ${summary.totalRecords.toLocaleString()} generated records based on ${summary.uniqueSeedTitles} seeded titles. Formats: ${formats}. The genre categories represented include ${genres}. These are demonstration records, not an inventory of Stapleton's complete real-world holdings; the catalog does not track current circulation or availability.`;
  }

  const requestedTitle = getRequestedTitle(message);
  if (requestedTitle && !findExactTitle(requestedTitle)) {
    return `I cannot verify an exact match for “${requestedTitle}” in Stapleton’s demonstration catalog, so I cannot confirm that title as a holding or provide a call number. A missing demonstration-catalog record does not establish whether a real library owns the item.`;
  }

  const authorRequest = message.match(/\bbooks?\s+by\s+(.+?)[?.!]*$/i)?.[1]?.trim();
  const catalogRequest = message.match(/\b(?:search|browse)\s+(?:the\s+)?catalog(?:ue)?\s+(?:for\s+)?(.+?)[?.!]*$/i)?.[1]?.trim();
  const matches = searchCatalog(authorRequest || catalogRequest || searchQuery, { limit: 6, author: authorRequest || null });
  if (matches.length) {
    const items = matches.slice(0, 5).map((entry) =>
      `- ${entry.title} — ${entry.author} (${entry.year}); ${entry.format}; call number ${entry.callNumber}; ${entry.location}.`
    );
    const availabilityNote = /\bavailable|availability|on the shelf|borrow\b/i.test(message)
      ? ' These records are listed in the demonstration catalog, but it does not track current availability or circulation.'
      : '';
    return `Verified demonstration-catalog records:\n${items.join('\n')}${availabilityNote}`;
  }

  if (/\b(book|title|copy|catalogue?|catalog|holding|have)\b/i.test(message)) {
    return 'I cannot verify that title in Stapleton’s demonstration catalog, so I can’t confirm a holding or provide a call number. A missing demonstration-catalog record does not establish whether a real library owns the item.';
  }

  return null;
}

module.exports = {
  CATALOG_ENTRIES,
  CATALOG_SEED,
  answerCatalogQuestion,
  getCatalogSummary,
  getRequestedTitle,
  isCatalogQuestion,
  isCollectionQuestion,
  searchCatalog
};
