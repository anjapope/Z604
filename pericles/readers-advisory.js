'use strict';

const { CATALOG_ENTRIES } = require('./catalog-service');

const concepts = {
  fantasy: /\b(fantasy|magic|magical|dragons?)\b/i,
  'science fiction': /\b(science fiction|sci-fi|scifi)\b/i,
  mystery: /\b(myster\w*|detective\w*)\b/i,
  horror: /\b(horror|scary)\b/i,
  history: /\b(history|historical)\b/i,
  cooking: /\b(cooking|cookbooks?|recipes?)\b/i,
  friendship: /\bfriendship\b/i,
  adventure: /\badventures?\b/i,
  robots: /\brobots?\b/i,
  humor: /\b(funny|humou?r)\b/i,
  nature: /\b(nature|animals?|wildlife)\b/i,
  science: /\bscience\b/i,
  memoir: /\b(memoirs?|biograph\w*)\b/i,
  romance: /\bromance\b/i
};

function isAdvisoryRequest(text) {
  return /\b(recommend\w*|suggest\w*|read[- ]?alikes?|what (?:should|could|can) I read|looking for|something to read|I (?:like|enjoy|prefer)|books? for|no horror|only audiobooks)\b/i.test(text);
}

function parsePreferences(context) {
  const p = { audience: null, format: null, fiction: null, interests: [], excluded: [] };
  for (const line of context.split('\n')) {
    if (/\b(instead|new topic|start over|actually.*for (?:me|an adult))\b/i.test(line)) {
      Object.assign(p, { audience: null, format: null, fiction: null, interests: [], excluded: [] });
    }
    const age = line.match(/\b(\d{1,2})[- ]year[- ]old\b|\bage[ds]?\s+(\d{1,2})\b/i);
    const words = line.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[- ]year[- ]old\b/i);
    if (age) p.audience = Number(age[1] || age[2]) < 13 ? 'Children' : Number(age[1] || age[2]) < 18 ? 'Teen' : 'Adult';
    else if (words || /\b(child\w*|kids?|preschool\w*)\b/i.test(line)) p.audience = 'Children';
    else if (/\bteens?|young adult\b/i.test(line)) p.audience = 'Teen';
    else if (/\badults?|for me\b/i.test(line)) p.audience = 'Adult';
    const format = line.match(/\b(audiobooks?|audio books?|ebooks?|e-books?|large print|print books?|physical books?|DVD|Blu-ray)\b/i)?.[0];
    if (format) p.format = /audio/i.test(format) ? 'Audiobook' : /e-?book/i.test(format) ? 'Ebook' : /large/i.test(format) ? 'Large Print' : /dvd/i.test(format) ? 'DVD' : /blu/i.test(format) ? 'Blu-ray' : 'Print Book';
    let positive = line.replace(/\b(?:no|not|avoid|without|exclude|don't want|do not want)\s+([^,.!?;]+)/gi, (_, phrase) => {
      if (/\bfiction\b/i.test(phrase) && !/nonfiction/i.test(phrase)) p.fiction = false;
      for (const [name, pattern] of Object.entries(concepts)) if (pattern.test(phrase)) p.excluded.push(name);
      return '';
    });
    if (/\bnon[- ]?fiction\b/i.test(positive)) p.fiction = false;
    else if (/\bfiction\b/i.test(positive)) p.fiction = true;
    const interests = Object.entries(concepts).filter(([name, pattern]) => pattern.test(positive) && !(name === 'science' && /science fiction/i.test(positive))).map(([name]) => name);
    const subjectText = positive.replace(/\bfor\s+(?:an?\s+)?(?:adults?|teens?|children|kids?|my .+?year.old)\b/i, '').replace(/\b(?:only\s+)?(?:audiobooks?|ebooks?|large print|print books?)\b/gi, '');
    const subject = subjectText.match(/\b(?:about|on)\s+(.+?)[.!?]*$/i)?.[1];
    if (subject && !interests.length && !/^(?:ebooks?|audiobooks?|large print|print books?)[.!?]*$/i.test(subject)) interests.push(...subject.toLowerCase().split(/\s+/).filter(word => word.length > 2 && !['the', 'and', 'for', 'only', 'books'].includes(word)));
    if (interests.length) p.interests = interests;
    p.interests = p.interests.filter(name => !p.excluded.includes(name));
    if (/\b(short|gentle|fast[- ]paced|easy|read[- ]alike)\b/i.test(positive)) p.unsupportedAppeal = true;
  }
  return p;
}

function workKey(entry) {
  return `${entry.author}|${entry.title.replace(/ \(Copy \d+\)$/i, '').replace(/^Percy Jackson and the Olympians: /, '')}`.toLowerCase();
}

function matchesConcept(name, text) {
  const pattern = concepts[name] || new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  return pattern.test(text);
}

function selectWorks(p) {
  const seen = new Set();
  return CATALOG_ENTRIES.map(entry => {
    const metadata = `${entry.genre} ${entry.subjects.join(' ')} ${entry.description}`;
    const fiction = typeof entry.isFiction === 'boolean' ? entry.isFiction : /\bFIC\b|\bJ\b|\bYA\b|^E /i.test(entry.callNumber) || /fiction|fantasy|mystery|young adult|children/i.test(entry.genre);
    const matches = p.interests.filter(name => matchesConcept(name, metadata));
    const score = matches.reduce((total, name) => total + (matchesConcept(name, entry.genre) ? 4 : matchesConcept(name, entry.subjects.join(' ')) ? 2 : 1), 0);
    return { entry, metadata, fiction, matches, score };
  }).filter(({ entry, metadata, fiction, matches }) =>
    (!p.audience || entry.audience.split('/').includes(p.audience) || entry.audience === 'All Ages') &&
    (!p.format || entry.format === p.format) && (p.fiction === null || p.fiction === fiction) &&
    !p.excluded.some(name => matchesConcept(name, metadata)) &&
    (!p.interests.length || matches.length === p.interests.length))
    .filter(({ entry }) => { const key = workKey(entry); if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

function answerAdvisory(context) {
  const p = parsePreferences(context);
  if (!p.interests.length && p.fiction === false) return 'I will leave fiction out. Which nonfiction topic would you like to explore?';
  if (!p.audience && (p.interests.length || p.format)) p.audience = 'Adult';
  if (!p.audience) return 'Who is this reading for—an adult, a teen, or a child (and what age)?';
  if (!p.interests.length && p.fiction !== true) return `${p.fiction === false ? 'I will leave fiction out. ' : ''}What topic or genre would you enjoy?`;
  // Broad fiction alone leaves an interview opportunity; a supplied format is enough to proceed.
  if (!p.interests.length && !p.format) return 'What reading preferences should I use—for example, adventure, friendship, or a favorite genre?';
  const works = selectWorks(p);
  const note = 'Current circulation availability is not confirmed. Copies and editions do not represent distinct works.';
  if (!works.length) return `I found no appropriate works matching all of those preferences in the catalog. ${note}`;
  const lines = works.map(({ entry: e, matches }) => `- [${e.title.replace(/ \(Copy \d+\)$/i, '')}](/catalog-detail.html?id=${e.recordId}) — ${e.author}. ${e.format}; audience: ${e.audience}; genre: ${e.genre}. Why it fits: ${matches.length ? `the catalog describes ${matches.join(' and ')}; ` : ''}${e.description.replace(/ Catalog copy .*$/, '')}`);
  return `${works.length < 3 ? `I found ${works.length} appropriate distinct work${works.length === 1 ? '' : 's'}.` : 'Here are three matching distinct works.'}\n${lines.join('\n')}\n${p.unsupportedAppeal ? 'The catalog does not establish reading level, length, or pace, so I cannot verify those qualities. ' : ''}${note}`;
}

module.exports = { isAdvisoryRequest, parsePreferences, selectWorks, workKey, answerAdvisory };
