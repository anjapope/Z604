'use strict';

const assert = require('node:assert/strict');
const { after, afterEach, test } = require('node:test');

process.env.OPENAI_API_KEY = 'test-key-not-a-credential';

const {
  app,
  normalizeHistory,
  extractStructuredResearch
} = require('../../server');
const { CATALOG_ENTRIES, searchCatalog } = require('../catalog-service');
const { cleanResearchAnswer } = require('../research-quality');
const { renderMessageContent, safeHttpUrl } = require('../citation-renderer');

const server = app.listen(0, '127.0.0.1');
const originalFetch = global.fetch;

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});

async function postChat(message, history = []) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history })
  });
  return { status: response.status, payload: await response.json() };
}

function mockOpenAIResponse(responsePayload, captureRequest = () => {}) {
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.openai.com/')) {
      return originalFetch(url, options);
    }
    captureRequest({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
}

function sourceRecord(url, overrides = {}) {
  return {
    title: 'Indiana Public Library Annual Report, 1938',
    institution: 'Indiana State Board of Library Commissioners',
    author: '',
    url,
    subjectEvidence: 'Annual reporting on public libraries and library services.',
    geographicEvidence: 'Issued by the Indiana State Board of Library Commissioners.',
    coverageStart: 1938,
    coverageEnd: 1938,
    coverageScope: 'point',
    coverageEvidence: 'The record is the board annual report for 1938 and describes Indiana public libraries.',
    publicationDate: '1938',
    authorityEvidence: 'An official publication of the state library agency.',
    sourceType: 'primary',
    sourceTypeEvidence: 'An original annual report created by the agency in 1938.',
    relevance: 'A contemporary state report documenting public library activity in Indiana during the requested period.',
    ...overrides
  };
}

function webSearchResponse(answer, candidateSources = [sourceRecord('https://archives.example.org/records')], returnedSources = candidateSources) {
  const citations = returnedSources
    .filter((source) => source.url)
    .map((source) => ({ ...source }));
  return {
    output: [
      {
        type: 'web_search_call',
        action: { sources: citations }
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: JSON.stringify({ answer, sources: candidateSources }),
          annotations: citations.map((citation) => ({ type: 'url_citation', ...citation }))
        }]
      }
    ]
  };
}

test('Scenario A: fiction suggestions are real catalog records with correct call numbers and formats', async () => {
  const { status, payload } = await postChat('What fiction do you have available?');
  const knownRecords = searchCatalog('fiction', { limit: 6 });

  assert.equal(status, 200);
  assert.ok(knownRecords.length >= 5);
  for (const entry of knownRecords.slice(0, 5)) {
    assert.ok(payload.reply.includes(entry.title));
    assert.ok(payload.reply.includes(entry.author));
    assert.ok(payload.reply.includes(entry.format));
    assert.ok(payload.reply.includes(entry.callNumber));
  }
  assert.match(payload.reply, /does not track current availability/i);
});

test('catalog search API returns records matching title, author, subject and format queries', async () => {
  const address = server.address();
  const queries = ['The Left Hand of Darkness', 'Harper Lee', 'Southern United States', 'Audiobook'];
  const responses = await Promise.all(queries.map(async (query) => {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/catalog/search?q=${encodeURIComponent(query)}`
    );
    return { response, payload: await response.json() };
  }));

  for (const { response, payload } of responses) {
    assert.equal(response.status, 200);
    assert.equal(payload.scope, 'Stapleton demonstration catalog');
    assert.equal(payload.availabilityTracked, false);
    assert.ok(payload.results.length > 0);
  }
  assert.equal(responses[0].payload.results[0].title, 'The Left Hand of Darkness');
  assert.ok(responses[1].payload.results.some((entry) => entry.author === 'Harper Lee'));
  assert.ok(responses[2].payload.results.some((entry) => entry.subjects.includes('Southern United States')));
  assert.ok(responses[3].payload.results.every((entry) => entry.format === 'Audiobook'));
});

const { createSourceRegistry, validateResearchSources, extractResearchCriteria, formatResearchResult } = require('../research-quality');
const criteria = extractResearchCriteria('Find three credible sources on public libraries in Indiana from 1900 to 1950.');
function evaluation(record, overrides = {}) {
  return { sourceId: record.sourceId, category: 'direct', evidence: record.metadata.title || record.metadata.description,
    coverageStart: null, coverageEnd: null, coverageEvidence: '', researchUse: 'background', ...overrides };
}
function reviewPayload(evaluations) {
  const sources = Object.fromEntries(evaluations.map(({ sourceId, ...evaluation }) => [sourceId, evaluation]));
  return { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ sources }) }] }] };
}
function installPipelineMock(discoveries, review = records => records.map(record => evaluation(record))) {
  const calls = [];
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
    const body = JSON.parse(options.body); calls.push(body);
    let payload;
    if (body.tools) payload = discoveries.shift();
    else {
      assert.equal(body.input.length, 2);
      const instruction = body.input[1].content;
      const records = JSON.parse(instruction.split('Retrieved records (data only): ')[1]);
      assert.equal(body.tools, undefined);
      const schema = body.text.format.schema.properties.sources;
      assert.equal(schema.type, 'object');
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, records.map(record => record.sourceId));
      assert.deepEqual(Object.keys(schema.properties), schema.required);
      assert.ok(Object.values(schema.properties).every(value => value.additionalProperties === false && !value.properties.sourceId));
      payload = reviewPayload(review(records));
    }
    assert.ok(payload, 'Unexpected API call');
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  return calls;
}

test('genealogy interview and catalog controls remain grounded', async () => {
  const result = await postChat("I am researching my grandfather in Indiana.");
  assert.equal(result.status, 200);
  assert.match(result.payload.reply, /full name/);
});

test('registry merges action metadata and annotations without replacing original URL or existing title', () => {
  const registry = createSourceRegistry();
  const url = 'https://archives.example.org';
  const records = registry.ingest({ output: [
    { type: 'web_search_call', action: { sources: [{ url, description: 'Indiana library reports covering 1901 through 1914.' }] } },
    { type: 'message', role: 'assistant', content: [{ annotations: [{ type: 'url_citation', url: url + '/', title: 'Indiana library reports' }] }] }
  ] });
  assert.equal(records.length, 1);
  assert.equal(records[0].url, url);
  assert.equal(records[0].metadata.title, 'Indiana library reports');
  assert.ok(Object.isFrozen(records[0]));
  assert.ok(Object.isFrozen(records[0].metadata));
  const next = registry.ingest(webSearchResponse('', [], [{ url, title: 'Replacement title' }, { url: 'https://another.example.org/report' }]));
  assert.equal(next[0].sourceId, records[0].sourceId);
  assert.equal(next[0].metadata.title, records[0].metadata.title);
  assert.notEqual(next[1].sourceId, records[0].sourceId);
});

test('24 initial and 22 recovery records work despite zero matching model-generated candidate URLs', async () => {
  const generated = [1, 2, 3].map(i => sourceRecord(`https://invented.example.org/${i}`));
  const initial = Array.from({ length: 24 }, (_, i) => ({ url: `https://archives.example.org/initial-${i}`, title: `Indiana public library report ${1901 + i}` }));
  const recovery = Array.from({ length: 22 }, (_, i) => ({ url: `https://archives.example.org/recovery-${i}`, title: `Indiana public library records ${1925 + i}` }));
  assert.equal(generated.filter(item => [...initial, ...recovery].some(record => record.url === item.url)).length, 0);
  let batch = 0;
  const calls = installPipelineMock([webSearchResponse('Ignored invented citations', generated, initial), webSearchResponse('Ignored invented citations', generated, recovery)], records => {
    batch += 1;
    return records.map((record, i) => evaluation(record, { category: i === 0 && batch === 2 ? 'direct' : 'supplementary' }));
  });
  const oldInfo = console.info, oldDiagnostic = process.env.PERICLES_RESEARCH_DIAGNOSTICS;
  const logs = [];
  process.env.PERICLES_RESEARCH_DIAGNOSTICS = 'true'; console.info = line => logs.push(JSON.parse(line));
  try {
    const result = await postChat('Find three sources on public libraries in Indiana from 1900 to 1950.');
    assert.equal(result.status, 200);
    assert.equal(calls.length, 4);
    assert.equal(logs[0].retrievedCount, 46);
    assert.equal(logs[0].evaluatedCount, 46);
    assert.equal(logs[0].acceptedCount, 46);
    assert.equal(result.payload.sources.length, 3);
    for (const source of result.payload.sources) assert.ok([...initial, ...recovery].some(record => record.url === source.url));
    assert.ok(calls.filter(call => !call.tools).every(call => !JSON.stringify(call).includes('invented.example.org')));
    assert.ok(calls[2].input.some(item => item.content.includes('Bounded Research Recovery Search')));
  } finally { console.info = oldInfo; if (oldDiagnostic === undefined) delete process.env.PERICLES_RESEARCH_DIAGNOSTICS; else process.env.PERICLES_RESEARCH_DIAGNOSTICS = oldDiagnostic; }
});

test('unknown IDs, URL mutations, unsupported bibliographic claims, duplicate IDs and invented evidence cannot become recommendations', () => {
  const registry = createSourceRegistry();
  const [record] = registry.ingest(webSearchResponse('', [], [{ url: 'https://archives.example.org', title: 'Indiana public library annual report 1938' }]));
  for (const extra of [{ url: record.url }, { title: 'Invented title' }, { author: 'Invented author' }, { publicationDate: '1938' }]) {
    assert.deepEqual(validateResearchSources([evaluation(record, extra)], registry.records, criteria), []);
  }
  assert.deepEqual(validateResearchSources([evaluation(record, { sourceId: 'source_999' })], registry.records, criteria), []);
  assert.deepEqual(validateResearchSources([evaluation(record, { evidence: 'Invented bibliographic assertion' })], registry.records, criteria), []);
  const accepted = validateResearchSources([evaluation(record), evaluation(record)], registry.records, criteria);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].url, 'https://archives.example.org');
});

test('partial-period coverage and archival finding aids survive; publication dates alone do not establish coverage', () => {
  const registry = createSourceRegistry();
  const records = registry.ingest(webSearchResponse('', [], [
    { url: 'https://archives.example.org/aid', title: 'Indiana public library commission finding aid', description: 'Records document library services from 1901 through 1914.' },
    { url: 'https://archives.example.org/report', title: 'Indiana public library report', publication_date: '1938' },
    { url: 'https://archives.example.org/context', title: 'Indiana public library contextual history', description: 'Records cover 1880 through 1890.' }
  ]));
  const accepted = validateResearchSources([
    evaluation(records[0], { coverageStart: 1901, coverageEnd: 1914, coverageEvidence: records[0].metadata.description }),
    evaluation(records[1]),
    evaluation(records[2], { coverageStart: 1880, coverageEnd: 1890, coverageEvidence: records[2].metadata.description })
  ], registry.records, criteria);
  assert.equal(accepted[0].category, 'direct');
  assert.match(accepted[0].relevance, /1901-1914/);
  assert.match(accepted[1].relevance, /Coverage for the requested period is unconfirmed/);
  assert.equal(accepted[2].category, 'supplementary');
});

test('missing title is not invented and discovery alone never establishes relevance', () => {
  const registry = createSourceRegistry();
  const records = registry.ingest(webSearchResponse('', [], [
    { url: 'https://archives.example.org/untitled', description: 'Indiana public library annual reports' },
    { url: 'https://archives.example.org/no-metadata' }
  ]));
  assert.equal(validateResearchSources([], registry.records, criteria).length, 0);
  const accepted = validateResearchSources(records.map(record => evaluation(record)), registry.records, criteria);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].title, '');
  assert.equal(accepted[0].author, '');
});

test('excluded sources and duplicate recovered records are not recommended; response count is server derived', async () => {
  const sources = Array.from({ length: 3 }, (_, i) => ({ url: `https://archives.example.org/${i}`, title: `Indiana public library report ${1910 + i}` }));
  const calls = installPipelineMock([webSearchResponse('Invented answer', [], sources), webSearchResponse('Invented answer', [], sources)], records => records.map((record, i) => evaluation(record, { category: i === 0 ? 'supplementary' : 'excluded' })));
  const { payload } = await postChat('Find three sources about public libraries in Indiana.');
  assert.equal(calls.length, 3);
  assert.equal(payload.sources.length, 1);
  assert.match(payload.reply, /1 supplementary/);
  assert.doesNotMatch(payload.reply, /Invented answer/);
});

test('incomplete or duplicate model reviews fail closed and record safe failure counts', async () => {
  const returned = [{ url: 'https://archives.example.org/a', title: 'Indiana library reports' }, { url: 'https://archives.example.org/b', title: 'Indiana library records' }];
  const logs = [], oldError = console.error;
  console.error = line => logs.push(JSON.parse(line));
  try {
    for (const review of [records => [evaluation(records[0])], records => [evaluation(records[0]), evaluation(records[0])]]) {
      installPipelineMock([webSearchResponse('', [], returned)], review);
      const result = await postChat('Find sources on Indiana public libraries.');
      assert.equal(result.status, 502);
      assert.equal(result.payload.sources, undefined);
    }
    assert.equal(logs.length, 2);
    assert.ok(logs.every(log => log.errorType === 'source_review_validation_error' && log.retrievedCount === 2 && log.evaluatedCount === 0));
    assert.ok(!/Indiana|Bearer|https:|test-key/.test(JSON.stringify(logs)));
  } finally { console.error = oldError; }
});

test('live 502 regression: all 24 retrieved IDs have required independent evaluation slots', async () => {
  const returned = Array.from({ length: 24 }, (_, index) => ({ url: `https://archives.example.org/report-${index}`, title: `Indiana annual library report ${1901 + index}` }));
  const calls = installPipelineMock([webSearchResponse('', [], returned), webSearchResponse('', [], returned)], records => records.map(record => evaluation(record, { category: 'excluded', evidence: '' })));
  const result = await postChat("I'm researching the history of public libraries in Indiana between 1900 and 1950. Can you find three specific, credible sources, preferably including primary sources, and give me links to them?");
  assert.equal(result.status, 200);
  const schema = calls[1].text.format.schema.properties.sources;
  assert.equal(schema.required.length, 24);
  assert.equal(new Set(schema.required).size, 24);
  assert.equal(schema.properties.source_24.type, 'object');
  assert.equal(schema.properties.source_1.additionalProperties, false);
  assert.deepEqual(result.payload.sources, []);
});

test('observed undated Jefferson collection and boundary-only Muncie catalog are never direct period recommendations', () => {
  const registry = createSourceRegistry();
  const records = registry.ingest(webSearchResponse('', [], [
    { title: 'Jefferson County Public Library - Collections Hosted by the Indiana State Library', url: 'https://indianamemory.contentdm.oclc.org/digital/collection/p16066coll103?utm_source=openai' },
    { title: '1875-01-29 to 1900-03-21 Muncie Public Library accession catalog - Page 188', url: 'https://dmr.bsu.edu/digital/collection/WMRead/id/617?utm_source=openai' }
  ]));
  const sources = validateResearchSources([
    evaluation(records[0]), evaluation(records[1], { coverageStart: 1875, coverageEnd: 1900, coverageEvidence: records[1].metadata.title, researchUse: 'institutional_record' })
  ], registry.records, criteria);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].category, 'supplementary');
  assert.match(sources[0].relevance, /background rather than established evidence/);
  assert.equal(sources[0].url, records[1].url);
});

test('dated commission reports and inspected archival coverage give specific research guidance', () => {
  const registry = createSourceRegistry();
  const records = registry.ingest(webSearchResponse('', [], [
    { url: 'https://archives.example.org/report', title: 'Annual report of the Public Library Commission of Indiana for 1912' },
    { url: 'https://archives.example.org/aid', title: 'Indiana public library commission finding aid' }
  ]));
  registry.records.set(records[1].sourceId, Object.freeze({ ...records[1], metadata: Object.freeze({ ...records[1].metadata, pageText: 'Scope and content: library commission records document activities from 1901 through 1914.' }) }));
  const sources = validateResearchSources([
    evaluation(records[0], { researchUse: 'contemporary_report', coverageStart: 1912, coverageEnd: 1912, coverageEvidence: records[0].metadata.title }),
    evaluation(records[1], { researchUse: 'finding_aid', coverageStart: 1901, coverageEnd: 1914, coverageEvidence: registry.records.get(records[1].sourceId).metadata.pageText })
  ], registry.records, criteria);
  assert.deepEqual(sources.map(source => source.category), ['direct', 'direct']);
  assert.match(sources[0].relevance, /Consult this report.*1912/);
  assert.match(sources[1].relevance, /locate records.*1901-1914/);
  assert.equal(sources[1].inspected, true);
  assert.ok(sources.every(source => !/Retrieved metadata|not independently|Relevant evidence/.test(source.relevance)));
});

test('bounded inspection keeps IDs and URLs and refuses arbitrary or private destinations', async () => {
  const { canInspect, htmlText, enrichSources } = require('../source-inspection');
  for (const url of ['http://www.in.gov/library', 'https://127.0.0.1/', 'https://www.in.gov.evil.test/', 'https://user:password@www.in.gov/', 'https://www.in.gov:8443/', 'https://arbitrary.example.org/']) assert.equal(canInspect(url), false);
  assert.equal(canInspect('https://www.in.gov/library/'), true);
  assert.equal(htmlText('<h1>Library reports &amp; records</h1><script>invented()</script>'), 'Library reports & records');
  const registry = createSourceRegistry();
  const records = registry.ingest(webSearchResponse('', [], [
    { url: 'https://www.in.gov/library/reports', title: 'Indiana annual reports' },
    { url: 'https://www.in.gov/library/collections', title: 'Collections' }
  ]));
  const inspected = [];
  const count = await enrichSources(registry, records, 1, async url => { inspected.push(url); return 'Annual report for 1912'; });
  assert.equal(count, 1); assert.equal(inspected.length, 1);
  assert.equal(registry.records.get(records[0].sourceId).url, records[0].url);
  assert.equal(registry.records.get(records[0].sourceId).metadata.pageText, 'Annual report for 1912');
});

test('empty discovery performs bounded recovery and can legitimately return zero', async () => {
  const calls = installPipelineMock([webSearchResponse('', [], []), webSearchResponse('', [], [])]);
  const result = await postChat('Find sources about an obscure subject.');
  assert.equal(calls.length, 2);
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload.sources, []);
  assert.match(result.payload.reply, /could not establish sources/);
});

test('provider failures log identifiers without credentials, patron text or provider messages', async () => {
  const logs = [], oldError = console.error;
  console.error = line => logs.push(line);
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
    return new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded', type: 'rate_limit_error', message: 'PRIVATE_PATRON_TEXT' } }), { status: 429 });
  };
  try {
    const result = await postChat('Find sources about PRIVATE_PATRON_TEXT.');
    assert.equal(result.status, 502);
    assert.ok(logs.every(line => !/PRIVATE_PATRON_TEXT|Bearer|test-key/.test(line)));
    assert.equal(JSON.parse(logs[0]).providerErrorCode, 'rate_limit_exceeded');
  } finally { console.error = oldError; }
});

test('citation rendering creates safe clickable links without displaying Markdown or interpreting source titles as HTML', () => {
  class FakeNode {
    constructor(tagName, text = '') {
      this.tagName = tagName;
      this.textContent = text;
      this.childNodes = [];
    }

    appendChild(child) {
      this.childNodes.push(child);
      return child;
    }

    replaceChildren() {
      this.childNodes = [];
    }
  }
  const documentRef = {
    createElement: (tagName) => new FakeNode(tagName),
    createTextNode: (text) => new FakeNode('#text', text)
  };
  const container = new FakeNode('div');
  const answer = cleanResearchAnswer(String.raw`See \[the report\](https://in.gov/library/report).`);

  renderMessageContent(container, answer, [{
    title: '<script>alert(1)</script> Annual Report',
    institution: 'Indiana Library Agency',
    sourceType: 'Primary',
    category: 'direct',
    url: 'https://in.gov/library/report',
    urlStatus: 'Returned by OpenAI web search; page not independently fetched'
  }], documentRef);

  assert.equal(answer, 'See the report.');
  assert.equal(container.childNodes[0].tagName, '#text');
  const section = container.childNodes.find((node) => node.tagName === 'section');
  const sourceListItem = section.childNodes[1].childNodes[0];
  const categoryLabel = sourceListItem.childNodes[0];
  assert.equal(categoryLabel.textContent, 'Directly relevant: ');
  const sourceLink = sourceListItem.childNodes.find((node) =>
    node.tagName === 'a' && node.textContent.includes('Annual Report'));
  assert.equal(sourceLink.tagName, 'a');
  assert.equal(sourceLink.href, 'https://in.gov/library/report');
  assert.equal(sourceLink.textContent, '<script>alert(1)</script> Annual Report');
  assert.equal(sourceListItem.childNodes.filter(node => node.tagName === 'a').length, 1);
  assert.ok(!sourceListItem.childNodes.some(node => node.tagName === 'small'));
  assert.equal(container.childNodes.some((node) => node.tagName === 'script'), false);
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(cleanResearchAnswer('Summary text.\n\nSources:\n- Annual report: https://in.gov/report'), 'Summary text.');
});

test('Scenario D: collection description is computed from the actual demonstration records', async () => {
  const { status, payload } = await postChat("How broad is Stapleton's collection?");

  assert.equal(status, 200);
  assert.match(payload.reply, new RegExp(CATALOG_ENTRIES.length.toLocaleString().replace(',', '\\,')));
  assert.match(payload.reply, /demonstration records/i);
  assert.match(payload.reply, /does not track current circulation or availability/i);
});

test('Scenario E: an unlisted title is not given an invented call number or holding', async () => {
  const known = await postChat('Does Stapleton have a copy of The Great Gatsby?');
  assert.match(known.payload.reply, /The Great Gatsby/);
  assert.match(known.payload.reply, /FIC FIT C001/);

  const { status, payload } = await postChat('Does Stapleton have a copy of The Invented Stapleton Codex?');

  assert.equal(status, 200);
  assert.match(payload.reply, /cannot verify/i);
  assert.match(payload.reply, /cannot confirm that title as a holding or provide a call number/i);
  assert.doesNotMatch(payload.reply, /call number\s+[A-Z0-9]/i);

  const similarButUnlisted = await postChat('Does Stapleton have a copy of The Great New Mystery?');
  assert.match(similarButUnlisted.payload.reply, /cannot verify an exact match/i);
  assert.doesNotMatch(similarButUnlisted.payload.reply, /The Great Gatsby/);
});

test('short follow-ups retain research context without repeating the interview', async () => {
  const calls = installPipelineMock([webSearchResponse('', [], [{ url: 'https://archives.example.org/census', title: 'Indianapolis census records 1940' }]), webSearchResponse('', [], [])]);
  const result = await postChat('What should I search for first?', [
    { role: 'user', content: 'My grandfather Robert Miller lived in Indianapolis in the 1940s.' }
  ]);
  assert.equal(result.status, 200);
  assert.ok(JSON.stringify(calls[0].input).includes('Robert Miller'));
  assert.doesNotMatch(result.payload.reply, /could you share his full name/i);
});

test('history and request bodies are bounded', async () => {
  const history = Array.from({ length: 20 }, (_, index) => ({
    role: 'user',
    content: `${index}: ${'x'.repeat(2000)}`
  }));
  const normalized = normalizeHistory(history);
  assert.ok(normalized.length <= 12);
  assert.ok(normalized.length > 0);
  assert.ok(normalized.reduce((total, item) => total + item.content.length, 0) <= 16000);

  const { status } = await postChat('x'.repeat(4001));
  assert.equal(status, 413);
});
