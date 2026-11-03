'use strict';

const assert = require('node:assert/strict');
const { test, after } = require('node:test');

// This suite must prove routine services work without credentials or paid calls.
require('dotenv').config = () => ({ parsed: {} });
delete process.env.OPENAI_API_KEY;
const { app, shouldUseWebSearch } = require('../../server');
const { classifyServiceIntent, routeServiceRequest } = require('../service-router');
const { LIBRARY_HOURS, EVENTS_CONTEXT } = require('../knowledge/library-facts');

const server = app.listen(0, '127.0.0.1');
const originalFetch = global.fetch;
global.fetch = (url, options) => {
  assert.ok(String(url).startsWith('http://127.0.0.1:'), 'Service tests must never call an external provider');
  return originalFetch(url, options);
};
after(async () => {
  global.fetch = originalFetch;
  await new Promise(resolve => server.close(resolve));
});
const origin = () => `http://127.0.0.1:${server.address().port}`;
async function chat(message, history = []) {
  const response = await fetch(`${origin()}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, history })
  });
  assert.equal(response.status, 200);
  return (await response.json()).reply;
}

test('only intended public pages and browser assets are served', async () => {
  for (const path of ['/', '/index.html', '/account.html', '/account-summary.html', '/catalog.html',
    '/catalog-detail.html?id=CAT-0001', '/events.html', '/programs.html', '/research-help.html',
    '/about.html', '/instructions.html', '/styles.css', '/app.js', '/catalog.js',
    '/catalog-detail.js', '/catalog-data.js', '/events.js', '/pericles/citation-renderer.js']) {
    const response = await fetch(origin() + path);
    assert.equal(response.status, 200, path);
    await response.arrayBuffer();
  }
});

test('source, environment, tests, diagnostics, and reports cannot be retrieved through GET or HEAD', async () => {
  for (const path of ['/server.js', '/.env', '/.env.example', '/%2eenv', '/.git/config', '/package.json',
    '/package-lock.json', '/README.md', '/pericles/catalog-service.js', '/pericles/service-router.js',
    '/pericles/research-quality.js', '/pericles/source-inspection.js', '/pericles/knowledge/library-facts.js',
    '/pericles/evaluation/reference-service.test.js', '/pericles/evaluation/service-routing.test.js',
    '/pericles/evaluation/reliability-diagnosis.json', '/pericles/evaluation/reliability-verification.json',
    '/pericles/evaluation/provenance-live-result.md', '/pericles/evaluation/provenance-live-result.json',
    '/pericles/evaluation/run-reliability-live.cjs', '/pericles/citation-renderer.js/../research-quality.js',
    '/pericles/%2e%2e/server.js', '/%252eenv', '/pericles%2fevaluation%2freliability-diagnosis.json']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(origin() + path, { method });
      // Check status before reading anything: never print a sensitive response body.
      assert.equal(response.status, 404, `${method} ${path}`);
      await response.arrayBuffer();
    }
  }
});

test('fictional account entry requests no credentials and does not submit a GET form', async () => {
  const html = await (await fetch(`${origin()}/account.html`)).text();
  assert.match(html, /fictional demonstration account/i);
  assert.match(html, /href="account-summary.html"/);
  assert.doesNotMatch(html, /<(?:form|input)\b/i);
  const summary = await (await fetch(`${origin()}/account-summary.html`)).text();
  assert.match(summary, /fictional account summary/i);
  assert.match(summary, /No sign-in is required/);
});

const cases = [
  ['What time do you close Saturday?', 'library_information', /Saturday: 8:00 AM-5:00 PM/],
  ['Do you help with citations?', 'reference', /citation guidance.*citation style/is],
  ['Search the catalog for Dune', 'catalog', /Dune.*Frank Herbert/s],
  ['Search the catalogue for Dune', 'catalog', /Dune.*Frank Herbert/s],
  ['Do you have books by Harper Lee?', 'catalog', /To Kill a Mockingbird.*Harper Lee/s],
  ['How long can I borrow an ebook?', 'policies', /loan periods.*not established/is],
  ['What accessible resources do you have?', 'library_information', /accessibility.*not established/is],
  ['I do not want fiction', 'readers_advisory', /leave fiction out.*nonfiction topic/is],
  ['Can I renew my books?', 'account', /cannot.*renew.*fictional/is],
  ['What is my account status?', 'account', /cannot access.*fictional/is],
  ['Open my account', 'account', /fictional.*No sign-in/is],
  ['How do I get a library card?', 'policies', /eligibility.*not established/is],
  ['Where is the library?', 'library_information', /street address.*not established/is],
  ['Where is the archive room?', 'library_information', /locations.*not established/is],
  ['Can I reserve a meeting room?', 'library_information', /cannot reserve a room/i],
  ['When is Storytime?', 'events', /Tuesdays and Fridays, 10:00-11:00 AM/],
  ['What is your policy on book challenges?', 'policies', /intellectual freedom.*procedures.*not established/is],
  ['Help me develop a research topic.', 'reference', /topic development.*What topic/is],
  ['Recommend fiction for my seven-year-old.', 'readers_advisory', /reading preferences/i]
];
for (const [question, intent, expected] of cases) {
  test(`local service: ${question}`, async () => {
    assert.equal(classifyServiceIntent(question), intent);
    assert.equal(shouldUseWebSearch(question), false);
    assert.match(await chat(question), expected);
  });
}

test('clear service questions override previous research and unfinished genealogy', async () => {
  for (const previous of [
    'Find sources about Indiana libraries between 1900 and 1950.',
    'I am researching my grandfather in Indiana.'
  ]) {
    for (const [question, intent, expected] of cases) {
      const history = [{ role: 'user', content: previous }, { role: 'assistant', content: 'Could you give me more details?' }];
      assert.equal(routeServiceRequest(question, history).intent, intent);
      assert.equal(shouldUseWebSearch(question, previous), false);
      const reply = await chat(question, history);
      assert.match(reply, expected);
      assert.doesNotMatch(reply, /ancestor|full name|directly address your question/i);
    }
  }
});

test('routine answers are based on facts and do not invent unavailable details', async () => {
  const hours = await chat('What are your hours?');
  for (const line of LIBRARY_HOURS) assert.ok(hours.includes(line));
  const events = await chat('What programs are available?');
  for (const line of EVENTS_CONTEXT) assert.ok(events.includes(line));
  for (const question of ['How long can I borrow an ebook?', 'Where is the library?', 'How do I get a library card?']) {
    const reply = await chat(question);
    assert.match(reply, /not established/i);
    assert.doesNotMatch(reply, /\b\d+ (?:days|weeks)|555-|https?:\/\//);
  }
});

test('service follow-ups keep useful facts without reviving older research', async () => {
  const history = [
    { role: 'user', content: 'Find sources about Indiana history.' },
    { role: 'assistant', content: 'Research context...' },
    { role: 'user', content: 'What are your hours?' },
    { role: 'assistant', content: LIBRARY_HOURS.join('\n') }
  ];
  assert.match(await chat('What about Saturday?', history), /Saturday: 8:00 AM-5:00 PM/);
  assert.match(await chat('What about meeting rooms?', history), /cannot reserve a room/);
  assert.match(await chat('APA', [{ role: 'user', content: 'Do you help with citations?' }]), /source do you need to cite in APA/);
  const current = 'Search the catalog for Dune';
  const deduplicated = routeServiceRequest(current, [{ role: 'user', content: current }]);
  assert.equal(deduplicated.userContext, current);
  assert.equal(deduplicated.history.length, 0);
});

test('advanced research remains explicit and uses coherent context only for follow-ups', () => {
  assert.equal(classifyServiceIntent('Find three credible primary sources about Indiana library history.'), 'advanced_research');
  const history = [
    { role: 'user', content: 'What are your hours?' },
    { role: 'assistant', content: 'Regular hours...' },
    { role: 'user', content: 'I am researching my grandfather in Indiana.' },
    { role: 'assistant', content: 'What is the ancestor’s name and decade?' },
    { role: 'user', content: 'His name was Robert Miller, and he lived in Indianapolis in the 1940s.' }
  ];
  const followup = routeServiceRequest('What should I search for first?', history);
  assert.equal(followup.intent, 'advanced_research');
  assert.match(followup.userContext, /Robert Miller/);
  assert.doesNotMatch(followup.userContext, /your hours/);
  const switched = routeServiceRequest('Search the catalog for Dune', history);
  assert.equal(switched.intent, 'catalog');
  assert.equal(switched.history.length, 0);
  assert.equal(switched.userContext, 'Search the catalog for Dune');
});

test('catalog APIs and health remain accessible without AI configuration', async () => {
  for (const path of ['/api/health', '/api/catalog/summary', '/api/catalog/search?q=Harper%20Lee']) {
    const response = await fetch(origin() + path);
    assert.equal(response.status, 200);
    await response.json();
  }
});
