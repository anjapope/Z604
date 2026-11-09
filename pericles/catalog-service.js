'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { isCirculationStatisticsQuestion, isRestrictedHistoryRequest, publicPopularityReply } = require('./catalog-circulation');
const { inventorySummary, inventoryAnswer } = require('./inventory-service');

function loadCatalog() {
  const usagePath = path.join(__dirname, 'knowledge', 'circulation-summaries.json');
  const privateUsage = fs.existsSync(usagePath) ? JSON.parse(fs.readFileSync(usagePath, 'utf8')).records : {};
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
      circulation: privateUsage[entry.recordId] || null,
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
    .filter((token) => (token.length >= 3 || token === 'ai' || token === '3d') && !STOPWORDS.has(token));
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
  const normalizedQuery = tokens.length === 1 ? tokens[0] : query.toLowerCase().trim();
  const title = entry.title.toLowerCase();
  const author = entry.author.toLowerCase();
  const subjects = (entry.subjects || []).join(' ').toLowerCase();
  const index = `${title} ${author} ${entry.genre} ${entry.format} ${entry.callNumber} ${entry.location} ${subjects}`.toLowerCase().replace(/\b3[- ]d\b/g, '3d');
  let score = 0;
  if (title === normalizedQuery) score += 100;
  if ((entry.subjects || []).some(s => s.toLowerCase() === normalizedQuery)) score += 60;
  if (tokens.length && tokens.every(token => index.includes(token))) score += 10;

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
    ...inventorySummary(CATALOG_ENTRIES),
    uniqueSeedTitles: uniqueSeedTitles.size,
    formats,
    distinctWorks: new Set(CATALOG_ENTRIES.map(e => `${e.title.replace(/ \(Copy \d+\)$/i, '').replace(/^Percy Jackson and the Olympians: /, '')}|${e.author}`)).size,
    genres
  };
}

function isCollectionQuestion(message) {
  if (isCirculationStatisticsQuestion(message)) return true;
  if (/\b(?:my|our|can i|may i|am i|have i|charges?|fees?|fines?|policy|policies)\b/i.test(message)) return false;
  return /\b(?:oldest|newest|earliest|latest)\s+(?:(?:published|publication)\s+)?(?:books?|titles?|items?|records?|publication)|\b(?:how broad|how large|how big|how many (?:books|items|titles|records|works|dvds|audiobooks|ebooks)|copies|copy history|withdrawn|lost items|replaced|replacement|deaccession\w*|retired copies|inventory|collection size|catalog(?:ue)? size|publication (?:years|range)|date range|format breakdown|genre breakdown|describe (?:the |your )?collection)\b/i.test(message)
    || /^(?:what do you have|tell me about (?:your |the )?(?:catalog(?:ue)?|collection|holdings))[?.!]*$/i.test(message.trim());
}
function answerCollectionQuestion(message) {
  const summary = getCatalogSummary();
  const formats = Object.entries(summary.formats).map(([format,count])=>`${format}: ${count.toLocaleString()}`).join('; ');
  const genres = Object.entries(summary.genres).map(([genre,count])=>`${genre}: ${count.toLocaleString()}`).join('; ');
  if (/\b(?:oldest|newest|earliest|latest|publication years|publication range|date range)\b/i.test(message)) {
    const onlyBooks = /\bbooks?\b/i.test(message);
    const entries = CATALOG_ENTRIES.filter(e=>Number.isFinite(Number(e.year)) && (!onlyBooks || ['Print Book','Large Print','Ebook'].includes(e.format)));
    if (!entries.length) return 'The catalog has no publication years for that selection.';
    const min = Math.min(...entries.map(e=>Number(e.year))), max = Math.max(...entries.map(e=>Number(e.year)));
    const latest = /\b(?:newest|latest)\b/i.test(message);
    const year = latest ? max : min;
    const seen = new Set();
    const records = entries.filter(e=>Number(e.year)===year).filter(e=>{const k=e.title.replace(/ \(Copy \d+\)$/i,'')+'|'+e.author;if(seen.has(k))return false;seen.add(k);return true;});
    return `The ${latest ? 'latest' : 'earliest'} recorded publication year ${onlyBooks ? 'for books ' : ''}in SPL’s catalog is ${year}. Matching works:\n${records.map(e=>`- [${e.title}](/catalog-detail.html?id=${e.recordId}) — ${e.author}; ${e.year}; ${e.format}; call number ${e.callNumber}.`).join('\n')}\nThe recorded publication-year range is ${min}–${max}. These are the catalog’s publication years; they do not establish the age of a particular physical copy, its edition or printing date, or when SPL acquired it.`;
  }
  if (/\b(?:how many|number of)\b/i.test(message)) {
    let count = /\brecords\b/i.test(message) ? summary.totalRecords : summary.activeCopies, label=/\brecords\b/i.test(message) ? 'bibliographic records' : 'active physical copies';
    if (/\bbooks?\b/i.test(message)) { count=summary.activeBookCopies; label='active print and large-print copies (digital records counted separately)'; }
    else if (/\bdvds?\b/i.test(message)) {count=summary.activeCopiesByFormat.DVD||0;label='active DVD copies';}
    else if (/\baudiobooks?\b/i.test(message)) {count=summary.formats.Audiobook||0;label='audiobook records';}
    else if (/\be-?books?\b/i.test(message)) {count=summary.formats.Ebook||0;label='ebook records';}
    else if (/\b(?:titles|works)\b/i.test(message)) {count=summary.distinctWorks;label='distinct works (normalized title and author; copies grouped together)';}
    return `SPL’s catalog contains ${count.toLocaleString()} ${label}. The full catalog has ${summary.totalRecords.toLocaleString()} records representing ${summary.distinctWorks.toLocaleString()} distinct works. Bibliographic records group copy-level items. ${summary.retiredCopies} retired copies are excluded from active holdings; ${summary.digitalRecords} digital-format records have no recorded license counts. Bibliographic format breakdown: ${formats}. Catalog counts do not establish current shelf availability.`;
  }
  return `SPL’s catalog contains ${summary.totalRecords.toLocaleString()} records representing ${summary.distinctWorks.toLocaleString()} distinct works, with ${summary.activeCopies.toLocaleString()} active physical copies and ${summary.retiredCopies} retired copies retained in item history. Formats: ${formats}. The genre categories represented include ${genres}. The catalog does not track current circulation or availability.`;
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
  if (isCirculationStatisticsQuestion(message) || isRestrictedHistoryRequest(message)) return publicPopularityReply(message, CATALOG_ENTRIES);
  const inventory = inventoryAnswer(message, CATALOG_ENTRIES);
  if (inventory) return inventory;
  if (isCollectionQuestion(message)) return answerCollectionQuestion(message);

  const requestedTitle = getRequestedTitle(message);
  if (requestedTitle && !findExactTitle(requestedTitle)) {
    return `I cannot verify an exact match for “${requestedTitle}” in Stapleton’s catalog, so I cannot confirm that title as a holding or provide a call number. `;
  }

  const authorRequest = message.match(/\bbooks?\s+by\s+(.+?)[?.!]*$/i)?.[1]?.trim();
  const catalogRequest = message.match(/\b(?:search|browse)\s+(?:the\s+)?catalog(?:ue)?\s+(?:for\s+)?(.+?)[?.!]*$/i)?.[1]?.trim();
  const matches = searchCatalog(authorRequest || catalogRequest || searchQuery, { limit: 6, author: authorRequest || null });
  if (matches.length) {
    const items = matches.slice(0, 5).map((entry) =>
      `- ${entry.title} — ${entry.author} (${entry.year}); ${entry.format}; call number ${entry.callNumber}; ${entry.location}.`
    );
    const availabilityNote = /\bavailable|availability|on the shelf|borrow\b/i.test(message)
      ? ' These records are listed in the catalog, but it does not track current availability or circulation.'
      : '';
    return `Verified catalog records:\n${items.join('\n')}${availabilityNote}`;
  }

  if (/\b(book|title|copy|catalogue?|catalog|holding|have)\b/i.test(message)) {
    return 'I cannot verify that title in Stapleton’s catalog, so I can’t confirm a holding or provide a call number. ';
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
