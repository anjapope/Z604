'use strict';

const levels = require('./knowledge/reading-levels.json');
const { CATALOG_SEED, CATALOG_ENTRIES } = require('./catalog-service');
const NOTE = 'Lexile describes text complexity, not a child’s intelligence, a diagnosis, interest level, or a precise school grade. Interests, comprehension, content, and reading support also matter. Measures below are sourced for specific editions; the demo records have no ISBN to verify an edition match.';

function readingMetadata(entry) {
  const title = String(entry.title).replace(/ \(Copy \d+\)$/i, '');
  return levels.titles.find(item => item.title.toLowerCase() === title.toLowerCase()
    && item.author.toLowerCase() === String(entry.author).toLowerCase()) || null;
}
function answerReadingLevel(message) {
  if (!/\b(?:lexile|reading levels?)\b|\b\d{2,4}\s*L\b/i.test(message)) return null;
  const candidates = CATALOG_ENTRIES.slice(0, CATALOG_SEED.length);
  const named = candidates.filter(entry => message.toLowerCase().includes(entry.title.toLowerCase()));
  const range = message.match(/\b(\d{2,4})L?\s*(?:-|–|to|through|and)\s*(\d{2,4})L?\b/i);
  const target = message.match(/\b(\d{2,4})\s*L\b/i);
  let matches;
  if (named.length) matches = named;
  else if (range) {
    const low = Number(range[1]), high = Number(range[2]);
    if (low > high) return 'What Lexile range should I use, with the lower number first?';
    matches = candidates.filter(entry => { const level = readingMetadata(entry); return level && level.lexile >= low && level.lexile <= high; });
  } else if (target) {
    matches = candidates.filter(readingMetadata).sort((a, b) => Math.abs(readingMetadata(a).lexile - Number(target[1])) - Math.abs(readingMetadata(b).lexile - Number(target[1])));
  } else matches = candidates.filter(readingMetadata);
  const seen = new Set();
  matches = matches.filter(entry => { const key = `${entry.title}|${entry.author}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 4);
  const lines = matches.map(entry => {
    const level = readingMetadata(entry);
    return `- [${entry.title}](/catalog-detail.html?id=${entry.recordId}) by ${entry.author}: ${level ? `${level.lexile}L — [${level.sourceLabel}](${level.source}), ISBN ${level.editionIsbn}.` : 'Lexile unknown in our curated metadata; I will not estimate a certified measure from age, genre, or a summary.'}`;
  });
  return `${NOTE}\n\n${lines.length ? lines.join('\n') : 'No measured titles in the curated subset match that range. Other collection titles may fit; their measures are unknown.'}\n\n${levels.titles.length} distinct titles currently have sourced measures; these are not a complete range search of the collection. Records do not establish availability. ${named.length || range ? '' : 'What does the reader enjoy, and is this for independent reading or reading together?'}`.trim();
}

module.exports = { readingMetadata, answerReadingLevel };
