'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { parsePreferences, selectWorks, workKey, answerAdvisory } = require('../readers-advisory');
const { routeServiceRequest, answerLocalService } = require('../service-router');
const { CATALOG_ENTRIES } = require('../catalog-service');
require('dotenv').config = () => ({ parsed: {} });
delete process.env.OPENAI_API_KEY;
const { app } = require('../../server');
const server = app.listen(0, '127.0.0.1');
after(() => new Promise(resolve => server.close(resolve)));
const choose = text => selectWorks(parsePreferences(text));
const history = (...turns) => turns.map(content => ({ role: 'user', content }));

test('children are gated by audience even when adult metadata mentions children or magic', () => {
  for (const request of ['Recommend fantasy for my seven-year-old.', 'Recommend books about robots for a child age 8.']) {
    const works = choose(request);
    assert.ok(works.length);
    assert.ok(works.every(({ entry }) => /Children|All Ages/.test(entry.audience)));
    assert.ok(works.every(({ entry }) => !/Cerulean|Thrones|Wind/.test(entry.title)));
  }
  assert.ok(choose('Recommend nonfiction about science for my 8-year-old.').every(({ entry, fiction }) => entry.audience === 'All Ages' && !fiction));
});

test('adult genres, formats, descriptions, arbitrary subjects and exclusions constrain matches', () => {
  const works = choose('Recommend adult science fiction, no horror, only audiobooks.');
  assert.equal(works.length, 3);
  assert.ok(works.every(({ entry }) => entry.format === 'Audiobook' && entry.genre === 'Science Fiction'));
  assert.ok(choose('Recommend adult nonfiction about cooking.').every(({ fiction }) => !fiction));
  assert.ok(choose('Recommend books for adults about ecology.').some(({ entry }) => entry.title === 'Dune'));
  assert.equal(choose('Recommend adult books about quantum archaeology.').length, 0);
  assert.equal(choose('Recommend fantasy for adults, no fantasy.').some(({ entry }) => entry.genre === 'Fantasy'), false);
});

test('one interview question and sufficient preferences receive recommendations', () => {
  for (const request of ['Recommend a book.', 'Recommend fiction for my seven-year-old.', 'I do not want fiction']) {
    assert.equal((answerAdvisory(request).match(/\?/g) || []).length, 1);
  }
  assert.match(answerAdvisory('Recommend fantasy for my seven-year-old.'), /Why it fits/);
});

test('multi-turn interview retains audience, genre, exclusions and format; services and new requests reset', () => {
  const prior = history('Recommend fiction for my seven-year-old.', 'Fantasy, no horror.', 'Only audiobooks.');
  const service = routeServiceRequest('What about ebooks?', prior);
  assert.equal(service.intent, 'readers_advisory');
  const prefs = parsePreferences(service.userContext);
  assert.equal(prefs.audience, 'Children');
  assert.equal(prefs.format, 'Ebook');
  assert.deepEqual(prefs.interests, ['fantasy']);
  assert.ok(prefs.excluded.includes('horror'));
  assert.equal(routeServiceRequest('What are your hours?', prior).intent, 'library_information');
  const switched = routeServiceRequest('Recommend adult nonfiction about cooking.', prior);
  assert.equal(switched.history.length, 0);
  assert.equal(parsePreferences(switched.userContext).audience, 'Adult');
});

test('copies and alternate Lightning Thief title editions collapse to distinct works', () => {
  const works = choose('Recommend adventure for children.');
  assert.equal(new Set(works.map(({ entry }) => workKey(entry))).size, works.length);
  const riordan = CATALOG_ENTRIES.filter(entry => entry.author === 'Rick Riordan');
  assert.equal(new Set(riordan.map(workKey)).size, 1);
});

test('insufficient matches return fewer works, zero matches and unsupported appeal are explicit', () => {
  assert.equal(choose('Recommend books about robots for children.').length, 1);
  assert.match(answerAdvisory('Recommend books about robots for children.'), /1 appropriate distinct work\./);
  assert.match(answerAdvisory('Recommend nonfiction about quantum archaeology for adults.'), /no appropriate works/);
  assert.match(answerAdvisory('Recommend short adult fantasy.'), /cannot verify those qualities/);
});

test('generated media retain media formats and physical juvenile call numbers and locations agree', () => {
  assert.ok(CATALOG_ENTRIES.filter(e => /Planet Earth II/.test(e.title)).every(e => e.format === 'Blu-ray'));
  assert.ok(CATALOG_ENTRIES.filter(e => e.audience === 'Children' && e.format === 'Print Book').every(e => /Children|Juvenile/.test(e.location) && !/^(AUDIO|EBOOK)/.test(e.callNumber)));
});

test('HTTP advisory replies and all recommendation links work without an AI provider', async () => {
  for (const message of ['Recommend fantasy for my seven-year-old.', 'Recommend adult science fiction, no horror, only audiobooks.', 'Recommend books about robots for children.', 'Recommend adult nonfiction about quantum archaeology.']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
    assert.equal(response.status, 200);
    const { reply, sources } = await response.json();
    assert.deepEqual(sources, []);
    assert.match(reply, /not confirmed circulation availability/);
    for (const [, url, id] of reply.matchAll(/\((\/catalog-detail.html\?id=(CAT-\d+))\)/g)) {
      assert.ok(CATALOG_ENTRIES.some(entry => entry.recordId === id));
      const page = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
      assert.equal(page.status, 200);
      await page.arrayBuffer();
    }
  }
});

test('chat renders catalog links as safe local anchors and leaves arbitrary relative links inert', () => {
  const { renderMessageContent } = require('../citation-renderer');
  const node = tag => ({ tag, children: [], appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; } });
  const documentRef = { createElement: node, createTextNode: text => ({ text }) };
  const container = node('div');
  renderMessageContent(container, '[Dune](/catalog-detail.html?id=CAT-0011) [unsafe](/account.html) <script>', [], documentRef);
  const anchors = container.children.filter(child => child.tag === 'a');
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].href, '/catalog-detail.html?id=CAT-0011');
  assert.equal(anchors[0].textContent, 'Dune');
});
