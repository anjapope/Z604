'use strict';
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { circulationIntent } = require('../circulation-intent');
const { classifyServiceIntent } = require('../service-router');
const { createCirculationService } = require('../circulation-service');
require('dotenv').config = () => ({ parsed: {} });
delete process.env.OPENAI_API_KEY;
const { app } = require('../../server');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pericles-account-routing-'));
const server = app.listen(0, '127.0.0.1');
let number = 0, filePath;
const transcripts = [];
beforeEach(() => {
  filePath = path.join(directory, `${++number}.json`);
  app.locals.circulation = createCirculationService({ filePath });
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, file));
  fs.rmdirSync(directory);
  fs.writeFileSync(path.join(__dirname, 'account-routing-result.json'), JSON.stringify(transcripts, null, 2));
});
function client() {
  let token;
  async function request(route, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { 'X-Demo-Session': token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    token = response.headers.get('x-demo-session') || token;
    return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') ? await response.json() : null };
  }
  return { request, select: id => request('/api/circulation/selection', { accountId: id }), account: async () => (await request('/api/circulation/account')).body, chat: async (message, history = [], extra = {}) => {
    const result = await request('/api/chat', { message, history, ...extra });
    assert.equal(result.status, 200);
    return result.body.reply;
  } };
}
const original = 'Can you tell me how many books I currently have checked out?';
const questions = [original, 'How many books do I have checked out?', 'What do I have checked out?', 'When are my books due?', 'Do I have any holds?', 'Can I renew my book?'];
const forbidden = /confirmationMinutes|loanDays|sessionStorage|server-side|process lifetime|JSON|confirmation expiration|Only the three fictional accounts|Dates use|No real sign-in, checkout|fictional classroom circulation policies/i;

test('intent precedence distinguishes actions, personal state, and general borrowing limits', () => {
  for (const text of questions) assert.equal(classifyServiceIntent(text), 'account', text);
  for (const text of ['Renew my book.', 'Please renew A-1.', 'Can you renew everything?', 'Place a hold on Dune.', 'Cancel my hold on Dune.']) assert.equal(circulationIntent(text).kind, 'action', text);
  assert.equal(circulationIntent('Can I renew my book?').kind, 'information');
  for (const text of ['How long can I borrow a book?', 'What are my rights as a patron?', 'How many books can I check out?', 'How many holds can I place?']) assert.equal(classifyServiceIntent(text), 'policies', text);
  assert.equal(classifyServiceIntent('Are you open Sunday?'), 'library_information');
  assert.equal(classifyServiceIntent('Recommend books about borrowing history.'), 'readers_advisory');
  assert.equal(classifyServiceIntent('Find primary sources about library borrowing history.'), 'advanced_research');
});

test('original failing question uses authoritative format-aware counts for all patrons', async () => {
  const patron = client();
  for (const id of ['A', 'B', 'C']) {
    await patron.select(id);
    const state = await patron.account();
    const before = structuredClone(state);
    const books = state.loans.filter(loan => ['Print Book', 'Large Print', 'Ebook'].includes(loan.format)).length;
    const reply = await patron.chat(original);
    assert.match(reply, new RegExp(`Patron ${id}: You have ${books} books`));
    assert.match(reply, new RegExp(`${state.loans.length} loans in total`));
    assert.doesNotMatch(reply, forbidden);
    assert.ok(reply.length < 300);
    if (id === 'A') assert.match(reply, /2 books.*3 loans.*1 audiobook/);
    assert.deepEqual(await patron.account(), before);
    transcripts.push({ account: id, message: original, reply });
  }
});

test('no selection asks for one without invented counts, titles, dates or policy dumps', async () => {
  for (const question of questions) {
    const reply = await client().chat(question);
    assert.match(reply, /(?:select|choose).*fictional.*(?:patron|account)/i);
    assert.doesNotMatch(reply, /You have \d|Educated|Atomic Habits|\d{4}-\d{2}-\d{2}/);
    assert.doesNotMatch(reply, forbidden);
  }
});

test('ordinary account information is focused and read-only, including renewal eligibility', async () => {
  const patron = client();
  await patron.select('B');
  const before = await patron.account();
  for (const question of questions) {
    const reply = await patron.chat(question);
    assert.doesNotMatch(reply, /Confirm renewal|Confirm placement|Server confirmed|Which policy/);
    assert.doesNotMatch(reply, forbidden);
    if (question === 'What do I have checked out?') { for (const loan of before.loans) assert.ok(reply.includes(loan.title)); }
    if (question === 'When are my books due?') { for (const loan of before.loans) assert.ok(reply.includes(loan.dueDate)); }
    if (question === 'Do I have any holds?') assert.match(reply, /1 active hold: The Hobbit/);
    if (question === 'Can I renew my book?') assert.match(reply, /Educated: eligible.*Great Gatsby: another.*hold.*1984: renewal limit/is);
    assert.deepEqual(await patron.account(), before);
  }
  assert.doesNotMatch(await patron.chat('Yes'), /Server confirmed/);
  assert.deepEqual(await patron.account(), before);
});

test('policy/account topic changes and account switching use current intent and selected session', async () => {
  const patron = client();
  await patron.select('A');
  const policy = 'How long can I borrow a book?';
  assert.match(await patron.chat(policy), /21 days/);
  const history = [{ role: 'user', content: policy }];
  assert.match(await patron.chat(original, history), /2 books.*3 loans/);
  assert.match(await patron.chat('What are my rights as a patron?', [{ role: 'user', content: original }]), /equitable access/i);
  assert.match(await patron.chat('Are you open Sunday?'), /Sunday: 12:00 PM-4:00 PM/);
  assert.match(await patron.chat('How many books can I check out?'), /50 books.*10 DVDs.*3 video games/);
  await patron.select('C');
  assert.match(await patron.chat(original, history, { accountId: 'A' }), /Patron C: You have 2 books.*2 loans/);
  assert.equal((await patron.account()).transactions.length, 0);
});

test('explicit actions still preview and confirm; information and policy questions cancel pending changes', async () => {
  const patron = client();
  await patron.select('A');
  assert.match(await patron.chat('Renew A-1.'), /Confirm renewal/);
  assert.match(await patron.chat(original), /2 books/);
  assert.doesNotMatch(await patron.chat('Yes'), /Server confirmed/);
  assert.equal((await patron.account()).transactions.length, 0);
  assert.match(await patron.chat('Renew A-1.'), /Confirm renewal/);
  assert.match(await patron.chat('Yes'), /Server confirmed renewal/);
  assert.equal((await patron.account()).transactions.length, 1);
  assert.match(await patron.chat('Place a hold on Dune.'), /Confirm placement/);
  assert.match(await patron.chat('How long can I borrow a book?'), /21 days/);
  assert.doesNotMatch(await patron.chat('Yes'), /Server confirmed/);
  assert.equal((await patron.account()).transactions.length, 1);
  assert.match(await patron.chat('Cancel my hold on Dune.'), /not supported.*No hold was changed/);
});

test('empty account records report zero rather than inventing holdings', async () => {
  const patron = client();
  await patron.select('A');
  const seed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  seed.accounts.A.loans = [];
  seed.accounts.A.holds = [];
  fs.writeFileSync(filePath, JSON.stringify(seed));
  app.locals.circulation = createCirculationService({ filePath });
  await patron.select('A');
  assert.match(await patron.chat(original), /0 books.*0 loans/);
  assert.match(await patron.chat('Do I have any holds?'), /no active holds/);
  assert.match(await patron.chat('What do I have checked out?'), /no loans checked out/);
});

test('short account follow-ups use session state without replacing a new explicit topic', async () => {
  const patron = client();
  await patron.select('A');
  const history = [{ role: 'user', content: original }];
  assert.match(await patron.chat('Which ones?', history), /The Midnight Library.*Atomic Habits.*Project Hail Mary/s);
  assert.match(await patron.chat('Due dates please', history), /due \d{4}-\d{2}-\d{2}/);
  assert.match(await patron.chat('How many in total?', history), /3 loans checked out/);
  assert.match(await patron.chat('How long can I borrow a book?', history), /21 days/);
  assert.match(await patron.chat('Recommend a mystery novel.', history), /Why it fits/);
  assert.equal((await patron.account()).transactions.length, 0);
});

test('general policy answers stay short and never emit transaction/backend specifications', async () => {
  const patron = client();
  await patron.select('A');
  for (const question of ['What is your renewal policy?', 'What is your hold policy?', 'What are your circulation policies?', 'How do I place a hold?']) {
    const reply = await patron.chat(question);
    assert.ok(reply.length < 500);
    assert.doesNotMatch(reply, forbidden);
    assert.doesNotMatch(reply, /Patron [ABC]|account [ABC]|five minutes|5 minutes|No real sign-in/);
  }
  for (const route of ['/pericles/circulation-intent.js', '/pericles/evaluation/account-routing-result.json', '/.env', '/pericles/data/circulation.json']) assert.equal((await patron.request(route)).status, 404);
});
