'use strict';
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { KNOWLEDGE, answerInstitutional, localStatus } = require('../institutional-service');
const { POLICIES, createCirculationService } = require('../circulation-service');
const { LIBRARY_HOURS, EVENTS_CONTEXT } = require('../knowledge/library-facts');
const { routeServiceRequest } = require('../service-router');
require('dotenv').config = () => ({ parsed: {} });
delete process.env.OPENAI_API_KEY;
const { app } = require('../../server');
const server = app.listen(0, '127.0.0.1');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pericles-institutional-'));
const transcripts = [];
let count = 0;
beforeEach(() => { app.locals.circulation = createCirculationService({ filePath: path.join(directory, `${++count}.json`), now: () => new Date('2026-11-03T17:00:00Z') }); });
after(async () => {
  await new Promise(resolve => server.close(resolve));
  for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, file));
  fs.rmdirSync(directory);
  fs.writeFileSync(path.join(__dirname, 'institutional-http-result.json'), JSON.stringify({ fictional: true, transcripts }, null, 2));
});
function client() {
  let token;
  async function request(route, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { 'X-Demo-Session': token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    token = response.headers.get('x-demo-session') || token;
    return { status: response.status, payload: response.headers.get('content-type')?.includes('application/json') ? await response.json() : null };
  }
  return { request, chat: (message, history = []) => request('/api/chat', { message, history }), select: id => request('/api/circulation/selection', { accountId: id }), account: async () => (await request('/api/circulation/account')).payload };
}
const cases = [
  ['What time do you close tonight?', /\d{4}-\d{2}-\d{2}.*America\/Indiana\/Indianapolis.*Holiday/is],
  ['Are you open on Sundays?', /Sunday: 12:00 PM-4:00 PM/],
  ['What are my rights as a library patron?', /equitable.*intellectual freedom.*privacy.*nondiscriminatory.*accommodations/is],
  ['What responsibilities do I have?', /respectfully.*materials.*shared spaces.*credentials/is],
  ['How long can I check out a book?', /print.*21 days.*audiobooks 14 days.*Blu-ray 7 days/is],
  ['Can I renew something another patron has on hold?', /up to 2 times.*hold from another patron blocks renewal.*no renewal was initiated/is],
  ['How do I get a library card?', /free to local residents.*identification.*not established/is],
  ['Do you charge overdue fines?', /No overdue fines.*Replacement charges may apply.*not established/is],
  ['Is my borrowing history private?', /confidentiality.*Record retention and disclosure procedures are not established/is],
  ['Can I use a library computer?', /Public computers.*Wi-Fi.*limits.*not established/is],
  ["What's the library's phone number?", /telephone number.*not established/is],
  ['What holidays are you closed?', /Holiday exceptions.*not established/],
  ['What are your hours? And can you recommend a mystery novel?', /Monday-Friday: 8:00 AM-8:00 PM.*Why it fits.*mystery/is],
  ['What is your renewal policy? Please renew my current book.', /up to 2 times.*Choose a patron/is]
];
for (const [message, expected] of cases) {
  test(`institutional HTTP: ${message}`, async () => {
    const result = await client().chat(message);
    assert.equal(result.status, 200);
    assert.match(result.payload.reply, expected);
    assert.match(result.payload.reply, /For Stapleton Public Library/i);
    assert.deepEqual(result.payload.sources, []);
    transcripts.push({ message, status: result.status, reply: result.payload.reply });
  });
}

test('established hours/programs take precedence and transaction policies share the knowledge file', () => {
  assert.deepEqual(LIBRARY_HOURS, KNOWLEDGE.hours.display);
  assert.equal(KNOWLEDGE.hours.week.Friday.close, 1200);
  assert.equal(KNOWLEDGE.hours.week.Sunday.open, 720);
  assert.ok(EVENTS_CONTEXT.includes('Tech Team Training Seminars: Mondays at 11:00 AM (open to the public).'));
  assert.deepEqual(POLICIES.loanDays, KNOWLEDGE.circulation.loanDays);
  assert.equal(POLICIES.renewalLimit, KNOWLEDGE.circulation.renewalLimit);
  assert.equal(POLICIES.holdLimit, KNOWLEDGE.circulation.holdLimit);
});

test('Indianapolis dates, closing boundaries, tomorrow, Sunday, and DST use regular hours with unknown holidays', () => {
  assert.equal(localStatus(new Date('2026-11-04T00:59:00Z')).open, true);
  assert.equal(localStatus(new Date('2026-11-04T01:00:00Z')).open, false);
  assert.equal(localStatus(new Date('2026-11-04T02:00:00Z')).date, '2026-11-03');
  assert.match(answerInstitutional('What time do you close tomorrow?', undefined, { now: new Date('2026-11-04T02:00:00Z') }), /Wednesday 2026-11-04: 8:00 AM-8:00 PM/);
  assert.equal(localStatus(new Date('2026-11-01T17:00:00Z')).open, true);
  assert.equal(localStatus(new Date('2026-11-01T21:00:00Z')).open, false);
  assert.match(answerInstitutional('Are you open now?', undefined, { now: new Date('2026-12-25T17:00:00Z') }), /Based on regular hours.*Holiday exceptions.*not established/);
});

test('policy explanations never preview or execute a renewal even with a selected account', async () => {
  const patron = client();
  await patron.select('B');
  const before = await patron.account();
  for (const message of ['Can I renew something another patron has on hold?', 'What is your renewal policy?', 'Can I renew a book?', 'Do you charge overdue fines?', 'What are your loan periods?']) {
    const result = await patron.chat(message);
    assert.equal(result.status, 200);
    assert.doesNotMatch(result.payload.reply, /Confirm renewal|Server confirmed|which loan should I renew/i);
  }
  assert.deepEqual(await patron.account(), before);
  assert.doesNotMatch((await patron.chat('yes')).payload.reply, /Server confirmed/);
  assert.deepEqual(await patron.account(), before);
});

test('mixed policy/action asks for a loan when ambiguous, then uses the existing confirmation flow', async () => {
  const patron = client();
  await patron.select('B');
  const ambiguous = await patron.chat('What is your renewal policy? Please renew my current book.');
  assert.match(ambiguous.payload.reply, /up to 2 times.*which loan should I renew/is);
  assert.equal((await patron.account()).transactions.length, 0);
  const preview = await patron.chat('What is your renewal policy? Please renew B-1.');
  assert.match(preview.payload.reply, /up to 2 times.*Confirm renewal/is);
  assert.equal((await patron.account()).transactions.length, 0);
  const confirmed = await patron.chat('Yes');
  assert.match(confirmed.payload.reply, /Server confirmed renewal/);
  const account = await patron.account();
  assert.equal(account.loans.find(loan => loan.id === 'B-1').dueDate, '2026-11-24');
  assert.equal(account.loans.find(loan => loan.id === 'B-2').renewals, 0);
});

test('institutional follow-ups retain relevant context; topic changes discard old research and cancel pending actions', async () => {
  const patron = client();
  const history = [{ role: 'user', content: 'How long can I borrow a book?' }];
  assert.equal(routeServiceRequest('And audiobooks?', history).intent, 'policies');
  assert.match((await patron.chat('And audiobooks?', history)).payload.reply, /audiobooks 14 days/);
  assert.match((await patron.chat('What about identification?', [{ role: 'user', content: 'How do I get a library card?' }])).payload.reply, /identification.*not established/);
  assert.match((await patron.chat('What are my rights as a library patron?', [{ role: 'user', content: 'Find historical census sources for my grandfather.' }])).payload.reply, /equitable access/i);
  await patron.select('B');
  assert.match((await patron.chat('Renew everything')).payload.reply, /Confirm renewal/);
  assert.match((await patron.chat('What services do you offer?')).payload.reply, /Wi-Fi/);
  assert.doesNotMatch((await patron.chat('Yes')).payload.reply, /Server confirmed/);
  assert.equal((await patron.account()).transactions.length, 0);
  assert.match((await patron.chat('Why can\'t I renew this book?')).payload.reply, /active hold/);
});

test('unknown details and generic policy ambiguity are acknowledged without fabricated contact or legal guarantees', async () => {
  const patron = client();
  assert.match((await patron.chat('What are your policies?')).payload.reply, /Which policy.*\?/);
  for (const message of ['What is your meeting-room policy?', 'What computer time limits apply?', 'What identification is required?', 'How much are replacement charges?']) {
    const result = await patron.chat(message);
    assert.match(result.payload.reply, /not established/);
    assert.doesNotMatch(result.payload.reply, /\$\d|\b\d+ minutes|555-|90210/);
  }
  assert.match((await patron.chat('What are your privacy policies?')).payload.reply, /Record retention and disclosure procedures are not established/);
});

test('institutional source and transcripts are not public assets', async () => {
  const patron = client();
  for (const route of ['/pericles/knowledge/library-knowledge.json', '/pericles/institutional-service.js', '/pericles/evaluation/institutional-http-result.json']) assert.equal((await patron.request(route)).status, 404);
  assert.ok(!require('../public-assets').some(file => /library-knowledge|institutional/.test(file)));
});

test('library words in advisory/catalog requests do not become policy questions', async () => {
  const patron = client();
  assert.equal(routeServiceRequest('Recommend books about privacy.').intent, 'readers_advisory');
  assert.equal(routeServiceRequest('Search the catalog for library computers.').intent, 'catalog');
  const answer = await patron.chat('What are your hours? And can you recommend a mystery novel?');
  assert.match(answer.payload.reply, /Monday-Friday.*Why it fits/is);
});
