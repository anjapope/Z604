'use strict';
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCirculationService } = require('../circulation-service');
const { createPatronServices, upcomingPrograms } = require('../patron-services');
const { answerReadingLevel } = require('../learning-service');
const { routeServiceRequest } = require('../service-router');
require('dotenv').config = () => ({ parsed: {} });
process.env.OPENAI_API_KEY = 'offline-test-placeholder';
const { app } = require('../../server');
// Isolate the existing domain/provenance contracts; conversational generation has its own HTTP suite.
app.locals.composeServiceReply = async ({ payload }) => payload;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pericles-expanded-'));
let clock, serial = 0, filePath, calls = [];
const now = () => clock;
const server = app.listen(0, '127.0.0.1');
const realFetch = global.fetch;
global.fetch = async (url, options) => {
  if (String(url).startsWith('http://127.0.0.1:')) return realFetch(url, options);
  assert.equal(url, 'https://api.openai.com/v1/chat/completions', 'No real provider calls in this suite');
  calls.push(JSON.parse(options.body));
  return new Response(JSON.stringify({ choices: [{ message: { content: 'Here is a practical first step for your question.' } }] }), { headers: { 'Content-Type': 'application/json' } });
};
beforeEach(() => {
  // Exercise the optional courtesy-credit mechanism independently of the active strict classroom policy.
  require('../knowledge/library-knowledge.json').circulation.feeWaiversAllowed = true;
  clock = new Date('2026-11-04T16:00:00Z');
  calls = [];
  filePath = path.join(directory, `services-${++serial}.json`);
  app.locals.circulation = createCirculationService({ filePath: path.join(directory, `circulation-${serial}.json`), now });
  app.locals.patronServices = createPatronServices({ filePath, now });
});
after(async () => {
  global.fetch = realFetch;
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
});
function client() {
  let token;
  async function request(route, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { 'X-Demo-Session': token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    token = response.headers.get('x-demo-session') || token;
    return { status: response.status, body: await response.json() };
  }
  return { request, select: id => request('/api/circulation/selection', { accountId: id }), chat: async (message, history = []) => {
    const result = await request('/api/chat', { message, history });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.reply;
  } };
}

test('tax, printing, youth support and research topics reach substantive AI help with context', async () => {
  const c = client();
  for (const message of ['Help me prepare for taxes.', 'How do I start with 3D printing?', 'My child needs phonics practice.', 'Explain how to evaluate a research claim.', 'How do I fix a spreadsheet formula?']) {
    const result = await c.chat(message);
    assert.match(result, /practical first step/);
    assert.equal(calls.at(-1).messages.at(-1).content, message);
    assert.match(calls.at(-1).messages[0].content, /do not stop at.*ask a professional/i);
  }
  const history = [{ role: 'user', content: 'Help me prepare for taxes.' }, { role: 'assistant', content: 'Which country and year?' }];
  await c.chat('United States, for the previous year', history);
  assert.ok(calls.at(-1).messages.some(m => m.content === 'Help me prepare for taxes.'));
  assert.match(calls.at(-1).messages.map(m => m.content).join('\n'), /irs.gov\/individuals/);
  assert.equal(routeServiceRequest('Find primary sources about education.', history).intent, 'advanced_research');
});

test('program lists are dated, week-filtered, useful without selection, and unknown programs stay unknown', async () => {
  const c = client();
  const list = await c.chat('What programs are happening this week?');
  assert.match(list, /2026-11-0[4-8]/);
  assert.doesNotMatch(list, /2026-11-(?:09|1\d)/);
  assert.match(list, /Times are local to the library/);
  assert.match(await c.chat('When is Monster Prom?'), /registration dates are not yet available/i);
  const programs = (await c.request('/api/services/programs')).body.programs;
  assert.ok(programs.every(e => e.eventId.endsWith(e.date) && e.remaining >= 0));
  assert.equal(upcomingPrograms(new Date('2026-11-07T20:00:00Z')).some(e => e.date === '2026-11-07'), false, 'Started programs disappear');
});

test('registration previews, date clarification, confirmation, duplicate prevention, persistence and cancellation', async () => {
  const c = client();
  await c.select('A');
  assert.match(await c.chat('Register me for Reading Confidence Lab'), /Which session/);
  assert.match(await c.chat('2026-11-07'), /Confirm with/);
  assert.equal((await c.request('/api/services/account')).body.registrations.length, 0);
  assert.match(await c.chat('yes'), /Server confirmed one program place/);
  assert.equal((await c.request('/api/services/account')).body.registrations.length, 1);
  assert.match(await c.chat('Register me for Reading Confidence Lab on 2026-11-07'), /already registered/);
  const persisted = createPatronServices({ filePath, now });
  assert.equal(persisted.summary({ accountId: 'A' }).registrations.length, 1);
  assert.match(await c.chat('Cancel my registration for Reading Confidence Lab on 2026-11-07'), /Confirm with/);
  assert.match(await c.chat('yes'), /Server confirmed cancellation/);
  assert.equal((await c.request('/api/services/account')).body.registrations.length, 0);
});

test('fee explanation is read-only; courtesy credit and settlement need separate confirmations', async () => {
  const c = client();
  await c.select('B');
  assert.match(await c.chat('What are my fees?'), /balance \$16.00/);
  assert.equal((await c.request('/api/services/account')).body.balanceCents, 1600);
  assert.match(await c.chat('Waive my fees'), /\$15.00.*\$16.00 → \$1.00/);
  assert.equal((await c.request('/api/services/account')).body.balanceCents, 1600);
  assert.match(await c.chat('yes'), /remaining balance \$1.00/);
  assert.match(await c.chat('Waive my fees'), /already been used/);
  assert.match(await c.chat('Pay my fees'), /payment.*\$1.00/);
  assert.match(await c.chat('yes'), /remaining balance \$0.00/);
  assert.equal((await c.request('/api/services/account')).body.history.length, 2);
  assert.match(await c.chat('yes'), /no pending transaction/i);
  assert.equal((await c.request('/api/services/account')).body.history.length, 2);
});

test('account switches, unrelated questions, cancellation and timeout invalidate service previews', async () => {
  const c = client();
  await c.select('B');
  await c.chat('Waive my fees');
  await c.select('A');
  assert.match(await c.chat('yes'), /no pending transaction/i);
  await c.select('B');
  await c.chat('Waive my fees');
  await c.chat('What are your hours?');
  assert.match(await c.chat('yes'), /no pending transaction/i);
  await c.chat('Waive my fees');
  assert.match(await c.chat('cancel'), /cancelled/);
  await c.chat('Waive my fees');
  clock = new Date('2026-11-04T16:06:00Z');
  assert.match(await c.chat('yes'), /No current service preview/);
  assert.equal((await c.request('/api/services/account')).body.balanceCents, 1600);
});

test('stale balances, foreign confirmation tokens, capacity, and child audience are rechecked', async () => {
  const a = client(), b = client();
  await a.select('B'); await b.select('B');
  const p = (await a.request('/api/services/preview', { action: 'waive_fees' })).body;
  assert.equal((await b.request('/api/services/confirm', { confirmationToken: p.token })).status, 409);
  const q = (await b.request('/api/services/preview', { action: 'settle_fees' })).body;
  assert.equal((await b.request('/api/services/confirm', { confirmationToken: q.token })).status, 200);
  assert.equal((await a.request('/api/services/confirm', { confirmationToken: p.token })).status, 409);
  const offerings = require('../knowledge/service-offerings.json');
  const storytime = offerings.programs.find(p => p.id === 'storytime');
  const previousCapacity = storytime.capacity;
  try {
    storytime.capacity = 1;
    await a.select('A');
    const event = app.locals.patronServices.events().find(e => e.id === 'storytime');
    const pa = (await a.request('/api/services/preview', { action: 'register', eventId: event.eventId })).body;
    const pb = (await b.request('/api/services/preview', { action: 'register', eventId: event.eventId })).body;
    assert.equal((await a.request('/api/services/confirm', { confirmationToken: pa.token })).status, 200);
    assert.equal((await b.request('/api/services/confirm', { confirmationToken: pb.token })).status, 409);
  } finally { storytime.capacity = previousCapacity; }
  await a.select('C');
  assert.match(await a.chat('Register me for next Adult Book Club'), /adult session is not available/i);
});

test('Lexile replies use sourced measures, disclose edition gaps and respect missing data and exact ranges', async () => {
  assert.match(answerReadingLevel('What is the Lexile of Matilda?'), /840L.*Scholastic/s);
  assert.match(answerReadingLevel('What is the reading level of Dune?'), /Lexile unknown/);
  const range = answerReadingLevel('Books from 700L to 800L');
  assert.match(range, /The Wild Robot.*740L/s);
  const filtered = answerReadingLevel('Lexile books from 700L to 800L');
  assert.match(filtered, /The Wild Robot.*740L/s);
  assert.doesNotMatch(filtered, /Matilda/);
  assert.match(filtered, /no ISBN.*edition match/s);
  assert.match(filtered, /not.*precise school grade/);
  const c = client();
  assert.match(await c.chat('What Lexile is The Wild Robot?'), /740L/);
  assert.equal(calls.length, 0);
});

test('program suggestions are relevant, spaced out, optional, and can lead to registration choices', async () => {
  const c = client();
  const first = await c.chat('Help me with tax preparation.');
  assert.match(first, /practical first step.*Tax Preparation Readiness/s);
  assert.match(await c.chat('yes'), /Upcoming sessions/);
  const history = [{ role: 'assistant', content: first }];
  assert.doesNotMatch(await c.chat('Explain tax document categories.', history), /You might also try/);
  await c.chat('Stop suggesting programs');
  assert.doesNotMatch(await c.chat('Help me with 3d printing'), /You might also try/);
});

test('private service state is not a static asset and corrupt stores fail closed', async () => {
  const c = client();
  for (const route of ['/pericles/data/patron-services.json', '/pericles/patron-services.js', '/pericles/knowledge/service-offerings.json']) {
    const r = await realFetch(`http://127.0.0.1:${server.address().port}${route}`);
    assert.equal(r.status, 404);
  }
  fs.writeFileSync(filePath, '{not valid json');
  const r = await c.request('/api/services/programs');
  assert.equal(r.status, 503);
  assert.match(r.body.error, /No success is confirmed/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{not valid json');
});

test('a six-year-old receives three explained age-appropriate choices, without repeated sessions or internal IDs', async () => {
  const c = client();
  const reply = await c.chat('my child is 6. what programs are good for them?');
  assert.match(reply, /For a 6-year-old/);
  assert.match(reply, /Storytime.*playful option/s);
  assert.match(reply, /Reading Confidence Lab.*extra practice/s);
  assert.match(reply, /Build and Explore.*blocks and cardboard/s);
  assert.equal((reply.match(/^- /gm) || []).length, 3);
  assert.equal((reply.match(/Storytime/g) || []).length, 1);
  assert.doesNotMatch(reply, /ID:|@[\d-]+|Select patron|Adult Book Club|Tax Preparation|3D Printing: First Design/);
  assert.match(reply, /What do they enjoy most/);
  assert.equal(calls.length, 0, 'A useful recommendation works without the AI provider');
});

test('program recommendations remember age for interests and can preview the suggested session naturally', async () => {
  const c = client();
  await c.select('A');
  await c.chat('My child is six. What programs would be good?');
  const followup = await c.chat('He likes building things.');
  assert.match(followup, /For a 6-year-old/);
  assert.match(followup.split('\n').find(line => line.startsWith('- ')), /Build and Explore/);
  assert.match(followup, /starts at age 8/);
  const preview = await c.chat('Sign him up for the first one.');
  assert.match(preview, /Register one place for Build and Explore/);
  assert.match(preview, /Confirm with/);
  assert.equal((await c.request('/api/services/account')).body.registrations.length, 0);
  assert.match(await c.chat('yes'), /Server confirmed one program place/);
});

test('a new topic or selected account does not inherit the previous child-program recommendation', async () => {
  const c = client();
  await c.chat('My child is 6. What programs are good?');
  await c.select('C');
  assert.match(await c.chat('He likes building things.'), /practical first step/);
  await c.chat('What programs fit my 6-year-old?');
  await c.chat('What are your hours?');
  assert.match(await c.chat('He likes building things.'), /practical first step/);
});

test('story time details and short follow-ups use local program facts without AI calls', async () => {
  const c = client();
  await c.chat('My child is 5. What programs are good?');
  const reply = await c.chat('tell me about story time programming, what does it include?');
  assert.match(reply, /Storytime.*Shared stories/s);
  assert.match(reply, /interactive read-aloud/);
  assert.match(reply, /Songs, rhymes, and movement/);
  assert.match(reply, /60 minutes/);
  assert.doesNotMatch(reply, /ID:|Live reference research is unavailable/);
  assert.match(await c.chat('what should we bring?'), /no reading ability or supplies are required/);
  assert.equal(calls.length, 0);
});
