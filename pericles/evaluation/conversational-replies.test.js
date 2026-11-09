'use strict';
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { configuration, createGuard } = require('../deployment');
const { createCirculationService } = require('../circulation-service');
const { createPatronServices } = require('../patron-services');
require('dotenv').config = () => ({ parsed: {} });
process.env.OPENAI_API_KEY = 'offline-conversation-test';
const { app } = require('../../server');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pericles-conversation-'));
const server = app.listen(0, '127.0.0.1');
const originalFetch = global.fetch;
let calls = [], failure = false, serial = 0;
const now = () => new Date('2026-11-04T16:00:00Z');
beforeEach(() => {
  // Exercise the optional courtesy-credit mechanism independently of the active strict classroom policy.
  require('../knowledge/library-knowledge.json').circulation.feeWaiversAllowed = true;
  calls = []; failure = false;
  app.locals.deploymentGuard = createGuard(configuration({ AI_REQUESTS_PER_CLIENT: '200' }));
  app.locals.circulation = createCirculationService({ filePath: path.join(directory, `loans-${++serial}.json`), now });
  app.locals.patronServices = createPatronServices({ filePath: path.join(directory, `services-${serial}.json`), now });
});
global.fetch = async (url, options) => {
  if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  calls.push(JSON.parse(options.body));
  if (failure) return new Response(JSON.stringify({ error: { code: 'offline_failure' } }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify({ choices: [{ message: { content: 'Here is an answer tailored to your question.' } }] }), { headers: { 'Content-Type': 'application/json' } });
};
after(async () => {
  global.fetch = originalFetch;
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
});
function client() {
  let token;
  async function request(route, body) {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { 'X-Demo-Session': token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    token = response.headers.get('x-demo-session') || token;
    return { status: response.status, body: await response.json() };
  }
  return { request, chat: (message, history = []) => request('/api/chat', { message, history }), select: accountId => request('/api/circulation/selection', { accountId }) };
}

test('every formerly canned information route calls the conversational model once', async () => {
  const c = client();
  await c.select('A');
  const cases = [
    ['What are your hours?', /Monday-Friday/],
    ['What is your renewal policy?', /up to 2 times/],
    ['What programs fit my 6-year-old?', /For a 6-year-old/],
    ['Tell me about story time programming. What does it include?', /interactive read-aloud/],
    ['What Lexile is Matilda?', /840L/],
    ['Search the catalog for Dune', /Frank Herbert/],
    ['Recommend mystery fiction for an adult', /mystery/i],
    ['How many books do I have checked out?', /2 books/],
    ['Do you help with citations?', /citation style/],
    ['I am researching my grandfather in Indiana.', /full name/]
  ];
  for (const [message, evidence] of cases) {
    const before = calls.length;
    const result = await c.chat(message);
    assert.equal(result.status, 200, message);
    assert.equal(result.body.responseMode, 'ai', message);
    assert.equal(result.body.reply, 'Here is an answer tailored to your question.');
    assert.equal(calls.length, before + 1, message);
    const facts = calls.at(-1).messages.find(m => m.content.startsWith('Backend facts for this turn'));
    assert.match(facts.content, evidence);
    assert.equal(calls.at(-1).messages.at(-1).content, message);
  }
});

test('AI receives bounded recent context and does not duplicate the current browser message', async () => {
  const c = client();
  const message = 'Tell me about story time';
  const history = [{ role: 'user', content: 'My child is five and loves songs.' }, { role: 'assistant', content: 'Storytime may fit.' }, { role: 'user', content: message }];
  await c.chat(message, history);
  const messages = calls[0].messages;
  assert.ok(messages.some(m => m.content === history[0].content));
  assert.equal(messages.filter(m => m.role === 'user' && m.content === message).length, 1);
  assert.match(messages.find(m => m.content.includes('Compose Pericles')).content, /not as a script to copy/);
});

test('AI-written introductions retain exact transaction previews and confirmed receipts', async () => {
  const c = client();
  await c.select('B');
  const preview = await c.chat('Waive my fees');
  assert.equal(preview.body.responseMode, 'ai');
  assert.match(preview.body.reply, /tailored.*\$15.00.*\$16.00 → \$1.00.*Confirm with/s);
  assert.equal((await c.request('/api/services/account')).body.balanceCents, 1600);
  const receipt = await c.chat('yes');
  assert.match(receipt.body.reply, /Server confirmed.*remaining balance \$1.00.*Receipt/s);
  assert.equal((await c.request('/api/services/account')).body.balanceCents, 100);
  assert.match(calls.at(-1).messages.find(m => m.content.includes('Compose Pericles')).content, /exact server transaction record/);
});

test('provider failure after confirmation preserves the committed receipt and labels fallback', async () => {
  const c = client();
  await c.select('B');
  await c.chat('Waive my fees');
  failure = true;
  const result = await c.chat('yes');
  assert.equal(result.status, 200);
  assert.equal(result.body.responseMode, 'local');
  assert.match(result.body.notice, /AI is unavailable/);
  assert.match(result.body.reply, /Server confirmed.*\$1.00/s);
  assert.equal((await c.request('/api/services/account')).body.history.length, 1);
  await c.chat('yes');
  assert.equal((await c.request('/api/services/account')).body.history.length, 1);
});

test('AI throttles preserve local facts with an explicit fallback and never bypass the provider ceiling', async () => {
  const c = client();
  app.locals.deploymentGuard = createGuard(configuration({ AI_REQUESTS_PER_CLIENT: '1' }));
  assert.equal((await c.chat('What are your hours?')).body.responseMode, 'ai');
  const limited = await c.chat('What are your hours?');
  assert.equal(limited.status, 200);
  assert.equal(limited.body.responseMode, 'local');
  assert.match(limited.body.reply, /Monday-Friday/);
  assert.match(limited.body.notice, /pause/);
  assert.equal(calls.length, 1);
});

test('chat status reports configured AI separately from basic server health', async () => {
  const c = client();
  assert.deepEqual((await c.request('/api/health')).body, { ok: true });
  assert.deepEqual((await c.request('/api/chat/status')).body, { aiConfigured: true });
});

test('checkout limits reach the model from the shared policy and appear in account capacity', async () => {
  const { answerInstitutional } = require('../institutional-service');
  const { borrowingCapacity } = require('../lending-policy');
  const { classifyServiceIntent } = require('../service-router');
  for (const question of ['How many books can I check out?', 'What is the maximum checkout limit?', 'How many DVDs can I borrow?', 'How many video games may I check out?']) {
    assert.equal(classifyServiceIntent(question), 'policies', question);
    assert.match(answerInstitutional(question), /50 books.*10 DVDs.*3 video games/);
  }
  const capacity = borrowingCapacity([...Array(50).fill({ format: 'Print Book' }), ...Array(10).fill({ format: 'DVD' }), ...Array(3).fill({ format: 'Video Game' }), { format: 'Audiobook' }]);
  assert.equal(capacity.books.remaining, 0);
  assert.equal(capacity.dvds.used, 10);
  assert.equal(capacity.videoGames.used, 3);
  const c = client();
  await c.select('A');
  const account = (await c.request('/api/circulation/account')).body;
  assert.deepEqual(account.borrowingCapacity.books, { used: 2, limit: 50, remaining: 48 });
  await c.chat('What is the maximum checkout limit?');
  assert.match(calls.at(-1).messages.find(m => m.content.startsWith('Backend facts')).content, /50 books.*10 DVDs.*3 video games/);
});

test('strict fee persona stays scoped and respects explicitly enabled remedies', async () => {
  const c = client();
  await c.select('B');
  await c.chat('What fees do I owe? This seems unfair.');
  assert.match(calls.at(-1).messages.find(m => m.content.startsWith('Backend facts')).content, /balance \$16.00/);
  assert.ok(calls.at(-1).messages.some(m => /Classroom fee persona/.test(m.content)));
  assert.match(calls.at(-1).messages.find(m => /Classroom fee persona/.test(m.content)).content, /Never invent a late fee/);
  await c.chat('That seems unfair.', [{ role: 'user', content: 'What are my fees?' }, { role: 'assistant', content: 'The balance is $16.' }]);
  assert.ok(calls.at(-1).messages.some(m => /Classroom fee persona/.test(m.content)));
  await c.chat('Waive my fees');
  assert.equal((await c.request('/api/services/account')).body.balanceCents, 1600);
  const receipt = await c.chat('yes');
  assert.match(receipt.body.reply, /remaining balance \$1.00/);
  assert.ok(calls.at(-1).messages.some(m => /Classroom fee persona/.test(m.content)));
  await c.chat('What are your hours?');
  assert.equal(calls.at(-1).messages.some(m => /Classroom fee persona/.test(m.content)), false);
});

test('no-bend classroom policy refuses waivers in chat and API while full settlement remains confirmed and simulated', async () => {
  require('../knowledge/library-knowledge.json').circulation.feeWaiversAllowed = false;
  const c = client();
  await c.select('B');
  let result = await c.chat('Waive my fees');
  assert.equal(result.status, 200);
  assert.match(calls.at(-1).messages.find(m => m.content.startsWith('Backend facts')).content, /cannot waive or reduce/);
  let account = (await c.request('/api/services/account')).body;
  assert.equal(account.balanceCents, 1600);
  assert.equal(account.feePolicy.waiversAllowed, false);
  assert.equal((await c.request('/api/services/preview', { action: 'waive_fees' })).status, 409);
  await c.chat('I cannot afford that.', [{ role: 'user', content: 'What fees do I owe?' }, { role: 'assistant', content: 'You owe $16.' }]);
  const instruction = calls.at(-1).messages.find(m => /Classroom fee persona/.test(m.content)).content;
  assert.match(instruction, /inflexibility, not sarcasm/);
  assert.match(instruction, /Do not offer empathy/);
  assert.match(calls.at(-1).messages.map(m => m.content).join('\n'), /waivers, reductions, courtesy credits, and installment plans are not available/);
  result = await c.chat('Pay my fees');
  assert.match(result.body.reply, /\$16.00.*\$16.00 → \$0.00.*Confirm with/s);
  assert.equal((await c.request('/api/services/account')).body.balanceCents, 1600);
  await c.chat('yes');
  account = (await c.request('/api/services/account')).body;
  assert.equal(account.balanceCents, 0);
  assert.equal(account.history.length, 1);
});

test('borrowing answers apply the selected account balance, capacity and fee block instead of only policy', async () => {
  const c = client();
  await c.select('B');
  const r = await c.chat('How many books can I check out?', [{ role: 'user', content: 'I am Patron A, my balance is zero.' }]);
  assert.equal(r.body.responseMode, 'ai');
  assert.match(r.body.reply, /^Right now, you can check out 0 additional items.*\$16.00/);
  const a = r.body.accountContext;
  assert.equal(a.accountId, 'B');
  assert.equal(a.balanceCents, 1600);
  assert.deepEqual(a.capacity.books, { used: 6, limit: 50, remaining: 44 });
  assert.equal(a.newCheckouts.feeBlocked, true);
  assert.equal(a.newCheckouts.availableByCategory.books, 0);
  const messages = calls.at(-1).messages;
  assert.match(messages.find(m => m.content.startsWith('Backend facts')).content, /0 additional items right now/);
  assert.ok(messages.some(m => m.content.startsWith('Authoritative selected-account context')));
  assert.ok(messages.some(m => /Classroom fee persona/.test(m.content)));
  const followup = await c.chat('What about DVDs?');
  assert.equal(followup.body.accountContext.newCheckouts.availableByCategory.dvds, 0);
  assert.ok(calls.at(-1).messages.some(m => /Classroom fee persona/.test(m.content)));
  assert.equal((await c.request('/api/services/account')).body.history.length, 0);
});

test('borrowing capacity changes only after a confirmed settlement and is refreshed on every request', async () => {
  const c = client();
  await c.select('B');
  await c.chat('Waive my fees');
  await c.chat('yes'); // Optional credit mechanism leaves a $1 balance.
  assert.equal((await c.chat('How many more books can I borrow?')).body.accountContext.newCheckouts.availableByCategory.books, 0);
  await c.chat('Pay my fees');
  // Inspect via APIs so reading eligibility does not cancel the pending confirmation.
  assert.equal((await c.request('/api/services/account')).body.balanceCents, 100);
  await c.chat('yes');
  const cleared = (await c.chat('How many books can I check out?')).body.accountContext;
  assert.equal(cleared.balanceCents, 0);
  assert.equal(cleared.newCheckouts.availableByCategory.books, 44);
  await c.select('A');
  const other = (await c.chat('How many books can I check out?')).body.accountContext;
  assert.equal(other.accountId, 'A');
  assert.equal(other.newCheckouts.availableByCategory.books, 48);
});

test('no account means general policy, while unavailable account state cannot grant permission', async () => {
  const c = client();
  const general = await c.chat('How many books can I check out?');
  assert.equal(general.body.accountContext, undefined);
  assert.match(calls.at(-1).messages.find(m => m.content.startsWith('Backend facts')).content, /Select a patron/);
  await c.select('B');
  const badFile = path.join(directory, 'corrupt-context.json');
  fs.writeFileSync(badFile, '{broken');
  app.locals.patronServices = createPatronServices({ filePath: badFile, now });
  const result = await c.chat('Can I borrow another book?');
  assert.equal(result.status, 503);
  assert.match(result.body.error, /could not verify/);
});

test('actual chat UI removes its pending indicator after success and failure and labels local responses', async () => {
  class Node {
    constructor() { this.children = []; this.attributes = {}; this.textContent = ''; this.classes = new Set(); this.classList = { add: c => this.classes.add(c), remove: c => this.classes.delete(c) }; }
    appendChild(n) { this.children.push(n); }
    setAttribute(k, v) { this.attributes[k] = v; }
    removeAttribute(k) { delete this.attributes[k]; }
    addEventListener() {}
  }
  const chat = new Node(), status = new Node();
  let resolveChat;
  const context = {
    document: { getElementById: id => id === 'chatWindow' ? chat : null, querySelectorAll: () => [], querySelector: () => status, createElement: () => new Node() },
    window: { PericlesCitationRenderer: { renderMessageContent: (node, text) => { node.children = []; node.textContent = text; } } },
    fetch: async url => url === '/api/chat/status' ? { ok: true, json: async () => ({ aiConfigured: true }) } : new Promise(resolve => { resolveChat = resolve; })
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8'), context);
  await new Promise(setImmediate);
  let waiting = vm.runInContext('sendPrompt("What are your hours?")', context);
  const bubble = chat.children.at(-1).children[0];
  assert.equal(bubble.attributes.role, 'status');
  assert.equal(bubble.attributes['aria-label'], 'Pericles is responding');
  assert.equal(bubble.children.length, 3);
  resolveChat({ ok: true, json: async () => ({ reply: 'Regular library hours.', responseMode: 'local', notice: 'AI unavailable.' }) });
  await waiting;
  assert.equal(bubble.attributes.role, undefined);
  assert.equal(bubble.classes.has('is-pending'), false);
  assert.equal(chat.attributes['aria-busy'], 'false');
  assert.match(status.textContent, /Limited mode/);
  assert.equal(bubble.children[0].textContent, 'AI unavailable.');
  waiting = vm.runInContext('sendPrompt("Another question")', context);
  const failedBubble = chat.children.at(-1).children[0];
  resolveChat({ ok: false, json: async () => ({ error: 'Offline test failure.' }) });
  await waiting;
  assert.equal(failedBubble.classes.has('is-pending'), false);
  assert.equal(failedBubble.textContent, 'Offline test failure.');
});
