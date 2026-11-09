'use strict';
const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { configuration, createGuard } = require('../deployment');
const { createCirculationService } = require('../circulation-service');
const { buildFrontend } = require('../../scripts/prepare-frontend.cjs');
require('dotenv').config = () => ({ parsed: {} });
process.env.OPENAI_API_KEY = 'deployment-test-not-a-credential';
const { app } = require('../../server');
// Isolate the existing domain/provenance contracts; conversational generation has its own HTTP suite.
app.locals.composeServiceReply = async ({ payload }) => payload;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pericles-deploy-test-'));
const originalFetch = global.fetch;
const server = app.listen(0, '127.0.0.1');
const approved = 'https://classroom-example.github.io';
let number = 0;
const defaults = () => configuration({ FRONTEND_ORIGIN: approved });
beforeEach(() => {
  app.locals.deploymentGuard = createGuard(defaults());
  app.locals.circulation = createCirculationService({ filePath: path.join(directory, `state-${++number}.json`) });
});
afterEach(() => { global.fetch = originalFetch; });
after(async () => {
  await new Promise(resolve => server.close(resolve));
  assert.equal(path.dirname(directory), os.tmpdir());
  assert.match(path.basename(directory), /^pericles-deploy-test-/);
  fs.rmSync(directory, { recursive: true });
});
async function request(route, body, headers = {}, method) {
  return originalFetch(`http://127.0.0.1:${server.address().port}${route}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function mockProvider() {
  let calls = 0;
  global.fetch = async url => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    calls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Verified offline test response.' } }] }) };
  };
  return () => calls;
}

test('Render configuration binds assigned port on all interfaces and fails closed on invalid public config', () => {
  const config = configuration({ RENDER: 'true', PORT: '10023', FRONTEND_ORIGIN: approved });
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 10023);
  assert.equal(config.trustProxy, 1);
  assert.equal(config.aiLimit, 3);
  assert.equal(configuration({}).host, '127.0.0.1');
  assert.equal(configuration({}).trustProxy, false);
  assert.throws(() => configuration({ NODE_ENV: 'production' }), /FRONTEND_ORIGIN/);
  for (const origin of ['*', approved + '/', approved + '/Z604', 'https://evil.example', 'null']) assert.throws(() => configuration({ FRONTEND_ORIGIN: origin }));
  assert.throws(() => configuration({ PORT: '-1' }));
  assert.throws(() => configuration({ CLASSROOM_AI_REQUEST_LIMIT: '0' }));
});

test('health endpoint exposes only a minimal boolean', async () => {
  const response = await request('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('approved Pages and local origins receive exact CORS; unapproved origins and preflights are rejected', async () => {
  for (const origin of [approved, 'http://localhost:4000', 'http://127.0.0.1:5500']) {
    const response = await request('/api/catalog/summary', undefined, { Origin: origin });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    await response.json();
  }
  for (const origin of ['https://attacker.github.io', approved + '.evil.example', 'null']) {
    const response = await request('/api/circulation/selection', { accountId: 'A' }, { Origin: origin });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  const preflight = await request('/api/circulation/confirm', undefined, { Origin: approved, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-demo-session' }, 'OPTIONS');
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /X-Demo-Session/);
  assert.equal((await request('/api/chat', undefined, { Origin: approved, 'Access-Control-Request-Method': 'DELETE' }, 'OPTIONS')).status, 403);
  assert.equal((await request('/api/chat', undefined, { Origin: approved, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' }, 'OPTIONS')).status, 403);
});

test('cross-site header sessions preserve selection, previews and confirmed renewal without cookies', async () => {
  const response = await request('/api/circulation/selection', { accountId: 'B' }, { Origin: approved });
  const token = response.headers.get('x-demo-session');
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.match(response.headers.get('access-control-expose-headers'), /X-Demo-Session/);
  const headers = { Origin: approved, 'X-Demo-Session': token };
  const account = await (await request('/api/circulation/account', undefined, headers)).json();
  assert.equal(account.patron.id, 'B');
  const preview = await (await request('/api/chat', { message: 'Can you renew everything?' }, headers)).json();
  assert.match(preview.reply, /Confirm renewal/);
  const confirmed = await (await request('/api/chat', { message: 'Yes, renew the eligible ones.' }, headers)).json();
  assert.match(confirmed.reply, /Server confirmed renewal/);
  const after = await (await request('/api/circulation/account', undefined, headers)).json();
  assert.equal(after.loans.find(l => l.id === 'B-1').renewals, 1);
  const hold = await (await request('/api/chat', { message: 'Place a hold on Dune.' }, headers)).json();
  assert.match(hold.reply, /Confirm placement/);
  const held = await (await request('/api/chat', { message: 'Yes' }, headers)).json();
  assert.match(held.reply, /Server confirmed hold placement/);
  const heldAccount = await (await request('/api/circulation/account', undefined, headers)).json();
  assert.ok(heldAccount.holds.some(item => item.title === 'Dune'));
  assert.equal((await request('/api/circulation/account', undefined, { Origin: approved })).status, 409);
});

test('general API throttle returns 429 with retry guidance', async () => {
  app.locals.deploymentGuard = createGuard({ ...defaults(), apiLimit: 2 });
  assert.equal((await request('/api/health')).status, 200);
  assert.equal((await request('/api/health')).status, 200);
  const limited = await request('/api/health');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
});

test('AI per-IP throttle cannot be bypassed by a forwarded header locally and leaves local services working', async () => {
  app.locals.deploymentGuard = createGuard({ ...defaults(), aiLimit: 1 });
  const calls = mockProvider();
  assert.equal((await request('/api/chat', { message: 'Hello there.' })).status, 200);
  const limited = await request('/api/chat', { message: 'Hello again.' }, { 'X-Forwarded-For': '203.0.113.99' });
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /pause/);
  assert.equal(calls(), 1);
  assert.equal((await request('/api/chat', { message: 'When is Storytime?' })).status, 200);
  assert.equal((await request('/api/circulation/selection', { accountId: 'C' })).status, 200);
});

test('classroom job ceiling and provider-call ceiling fail closed', async () => {
  const calls = mockProvider();
  app.locals.deploymentGuard = createGuard({ ...defaults(), classroomLimit: 1 });
  assert.equal((await request('/api/chat', { message: 'Hello there.' })).status, 200);
  const limited = await request('/api/chat', { message: 'Hello again.' });
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /classroom AI allowance/);
  assert.equal(calls(), 1);
  const guard = createGuard({ ...defaults(), providerLimit: 1 });
  assert.equal(guard.admitProviderCall(), true);
  assert.equal(guard.admitProviderCall(), false);
});

test('only lifetime ceilings accept unlimited; finite defaults and validation remain intact', () => {
  const names = ['CLASSROOM_AI_REQUEST_LIMIT', 'CLASSROOM_PROVIDER_CALL_LIMIT'];
  const config = configuration(Object.fromEntries(names.map(name => [name, ' unlimited '])));
  assert.equal(config.classroomLimit, null);
  assert.equal(config.providerLimit, null);
  assert.equal(configuration({ CLASSROOM_AI_REQUEST_LIMIT: 'UNLIMITED' }).classroomLimit, null);
  assert.equal(configuration({}).classroomLimit, 50);
  assert.equal(configuration({ CLASSROOM_PROVIDER_CALL_LIMIT: '' }).providerLimit, 200);
  for (const name of names) {
    assert.doesNotThrow(() => configuration({ [name]: '100000' }));
    for (const value of ['1000000', '0', '-1', '1.5', 'Infinity', 'NaN', 'disabled']) assert.throws(() => configuration({ [name]: value }), new RegExp(name));
  }
  for (const name of ['AI_REQUESTS_PER_CLIENT', 'AI_CLIENT_WINDOW_SECONDS', 'API_REQUESTS_PER_MINUTE', 'AI_MAX_CONCURRENT', 'AI_PROVIDER_TIMEOUT_MS', 'AI_RESPONSE_TIMEOUT_MS']) assert.throws(() => configuration({ [name]: 'unlimited' }), new RegExp(name));
  assert.equal(config.concurrentLimit, 2);
  assert.equal(config.providerTimeoutMs, 45000);
  assert.equal(config.responseTimeoutMs, 180000);
});

test('unlimited ceilings allow continued use beyond defaults while concurrency remains enforced', () => {
  let time = 0;
  const config = configuration({ CLASSROOM_AI_REQUEST_LIMIT: 'unlimited', CLASSROOM_PROVIDER_CALL_LIMIT: 'unlimited', AI_MAX_CONCURRENT: '1' });
  const guard = createGuard(config, () => time);
  const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  for (let i = 0; i < 60; i++) {
    const release = guard.acquireAI({ ip: 'client' }, res);
    assert.equal(typeof release, 'function');
    assert.equal(guard.acquireAI({ ip: 'other-client' }, res), null);
    assert.match(res.body.error, /busy/);
    for (let j = 0; j < 5; j++) assert.equal(guard.admitProviderCall(), true);
    release();
    time += config.aiWindowMs + 1;
  }
});

test('each lifetime ceiling can be disabled independently without bypassing the other', () => {
  const res = { setHeader() {}, status() { return this; }, json() {} };
  let config = configuration({ CLASSROOM_AI_REQUEST_LIMIT: 'unlimited', CLASSROOM_PROVIDER_CALL_LIMIT: '1' });
  let guard = createGuard(config);
  guard.acquireAI({ ip: 'client' }, res)();
  assert.equal(guard.admitProviderCall(), true);
  assert.equal(guard.admitProviderCall(), false);
  assert.equal(guard.acquireAI({ ip: 'client' }, res), null);
  config = configuration({ CLASSROOM_AI_REQUEST_LIMIT: '1', CLASSROOM_PROVIDER_CALL_LIMIT: 'unlimited' });
  guard = createGuard(config);
  for (let i = 0; i < 250; i++) assert.equal(guard.admitProviderCall(), true);
  guard.acquireAI({ ip: 'client' }, res)();
  assert.equal(guard.acquireAI({ ip: 'other-client' }, res), null);
});

test('unlimited lifetime ceilings retain HTTP IP throttles, origin checks and provider timeout handling', async () => {
  const config = configuration({ FRONTEND_ORIGIN: approved, CLASSROOM_AI_REQUEST_LIMIT: 'unlimited', CLASSROOM_PROVIDER_CALL_LIMIT: 'unlimited', AI_REQUESTS_PER_CLIENT: '1' });
  app.locals.deploymentGuard = createGuard(config);
  global.fetch = async () => { const error = new Error('offline timeout'); error.name = 'TimeoutError'; throw error; };
  assert.equal((await request('/api/chat', { message: 'Hello there.' })).status, 502);
  const limited = await request('/api/chat', { message: 'Hello again.' });
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /pause/);
  assert.equal((await request('/api/health', undefined, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/api/chat', { message: 'When is Storytime?' })).status, 200);
  app.locals.deploymentGuard = createGuard({ ...config, apiLimit: 1 });
  assert.equal((await request('/api/health')).status, 200);
  assert.equal((await request('/api/health')).status, 429);
});

test('concurrency slots are released once and client limits reset after their window', () => {
  let time = 0;
  const guard = createGuard({ ...defaults(), aiLimit: 1, concurrentLimit: 1, aiWindowMs: 1000 }, () => time);
  const res = { setHeader() {}, status() { return this; }, json() {} };
  const release = guard.acquireAI({ ip: 'client-a' }, res);
  assert.equal(guard.acquireAI({ ip: 'client-b' }, res), null);
  release(); release();
  assert.equal(guard.acquireAI({ ip: 'client-a' }, res), null);
  time = 1001;
  assert.equal(typeof guard.acquireAI({ ip: 'client-a' }, res), 'function');
});

test('provider unavailability gives a safe error and malformed JSON never exposes stack traces', async () => {
  global.fetch = async () => { const error = new Error('private upstream details'); error.name = 'TimeoutError'; throw error; };
  const response = await request('/api/chat', { message: 'Hello there.' });
  assert.equal(response.status, 502);
  const text = JSON.stringify(await response.json());
  assert.doesNotMatch(text, /private upstream|deployment-test-not-a-credential|stack/);
  const invalid = await originalFetch(`http://127.0.0.1:${server.address().port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'The request must contain valid JSON.' });
});

test('frontend client routes account, catalog and chat APIs to Render and retains opaque session headers', async () => {
  const storage = new Map(), seen = [];
  const token = 'a'.repeat(64);
  const window = {
    PERICLES_CONFIG: { backendUrl: 'https://classroom-example.onrender.com' },
    location: { origin: approved, hostname: 'classroom-example.github.io', href: approved + '/Z604/index.html' },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, options) => { seen.push({ url, options }); return { headers: new Headers({ 'X-Demo-Session': token }) }; }
  };
  const source = fs.readFileSync(path.join(__dirname, '../../api-client.js'), 'utf8');
  vm.runInNewContext(source, { window, URL, Headers, AbortSignal });
  await window.PericlesApi.fetch('/api/circulation/selection', { method: 'POST' });
  await window.PericlesApi.fetch('/api/catalog/search?q=Dune');
  await window.PericlesApi.fetch('/api/chat', { method: 'POST' });
  assert.equal(seen[0].url, 'https://classroom-example.onrender.com/api/circulation/selection');
  assert.equal(seen[1].options.headers.get('X-Demo-Session'), token);
  assert.equal(seen[0].options.credentials, 'omit');
  assert.equal(window.PericlesApi.catalogUrl('/catalog-detail.html?id=CAT-0011'), approved + '/Z604/catalog-detail.html?id=CAT-0011');
  await assert.rejects(window.PericlesApi.fetch('https://evil.example'), /Invalid API route/);
  window.PERICLES_CONFIG.backendUrl = '';
  window.location = { origin: 'http://localhost:4000', hostname: 'localhost', href: 'http://localhost:4000/' };
  vm.runInNewContext(source, { window, URL, Headers, AbortSignal });
  await window.PericlesApi.fetch('/api/health');
  assert.equal(seen.at(-1).url, '/api/health');
  assert.equal(seen.at(-1).options.credentials, 'same-origin');
});

test('frontend artifact contains only allowlisted browser files and public config; backend files stay private', async () => {
  const output = path.join(directory, 'frontend');
  buildFrontend({ output, backendUrl: 'https://classroom-example.onrender.com' });
  assert.ok(fs.existsSync(path.join(output, 'index.html')));
  assert.match(fs.readFileSync(path.join(output, 'frontend-config.js'), 'utf8'), /classroom-example.onrender.com/);
  for (const file of ['.env', 'server.js', 'package.json', 'pericles/data/circulation.json', 'pericles/deployment.js', 'pericles/evaluation/circulation-http-result.json']) {
    assert.equal(fs.existsSync(path.join(output, file)), false);
    assert.equal((await request('/' + file)).status, 404);
  }
  assert.throws(() => buildFrontend({ output }), /not empty/);
  assert.throws(() => buildFrontend({ output: path.join(directory, 'invalid'), backendUrl: 'https://user:secret@example.com' }));
  for (const file of ['index.html', 'account.html', 'account-summary.html']) {
    const html = fs.readFileSync(path.join(output, file), 'utf8');
    assert.ok(html.indexOf('frontend-config.js') < html.indexOf('account.js'));
    assert.ok(html.indexOf('api-client.js') < html.indexOf('account.js'));
  }
});
