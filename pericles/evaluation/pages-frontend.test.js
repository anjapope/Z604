'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { buildFrontend } = require('../../scripts/prepare-frontend.cjs');
const root = path.resolve(__dirname, '../..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pericles-pages-test-'));
after(() => {
  assert.equal(path.dirname(directory), os.tmpdir());
  assert.match(path.basename(directory), /^pericles-pages-test-/);
  fs.rmSync(directory, { recursive: true });
});
const source = name => fs.readFileSync(path.join(root, name), 'utf8');

test('production source configuration targets Render while localhost stays same-origin', async () => {
  for (const [hostname, origin, expected] of [
    ['anjapope.github.io', 'https://anjapope.github.io', 'https://pericles-api.onrender.com'],
    ['localhost', 'http://localhost:4000', ''],
    ['127.0.0.1', 'http://127.0.0.1:4000', '']
  ]) {
    const requests = [];
    const window = { location: { hostname, origin, href: origin + '/Z604/index.html' }, sessionStorage: { getItem() {}, setItem() {} }, fetch: async (url, options) => { requests.push({ url, options }); return { headers: new Headers() }; } };
    vm.runInNewContext(source('frontend-config.js'), { window });
    assert.equal(window.PERICLES_CONFIG.backendUrl, expected);
    vm.runInNewContext(source('api-client.js'), { window, URL, Headers, AbortSignal });
    for (const route of ['/api/chat', '/api/catalog/search?q=Dune', '/api/circulation/selection', '/api/circulation/account', '/api/circulation/preview', '/api/circulation/confirm']) await window.PericlesApi.fetch(route);
    for (const { url, options } of requests) {
      assert.ok(url.startsWith(expected + '/api/'));
      assert.equal(options.credentials, expected ? 'omit' : 'same-origin');
    }
    if (expected) assert.equal(window.PericlesApi.catalogUrl('/catalog-detail.html?id=CAT-0011'), origin + '/Z604/catalog-detail.html?id=CAT-0011');
  }
});

test('production artifact preserves project-relative assets/navigation and omits private files', () => {
  const output = path.join(directory, 'artifact');
  buildFrontend({ output, backendUrl: 'https://pericles-api.onrender.com' });
  assert.match(fs.readFileSync(path.join(output, 'frontend-config.js'), 'utf8'), /https:\/\/pericles-api.onrender.com/);
  for (const file of fs.readdirSync(output).filter(file => file.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(output, file), 'utf8');
    for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (/^(?:https?:|mailto:|#)/.test(url)) continue;
      assert.ok(!url.startsWith('/'), `${file}: root-relative URL ${url} loses /Z604/`);
      assert.ok(fs.existsSync(path.join(output, url.split(/[?#]/)[0])), `${file}: missing ${url}`);
    }
  }
  for (const file of ['server.js', '.env', '.env.example', 'pericles/deployment.js', 'pericles/data/circulation.json', 'pericles/evaluation/pages-render-live-result.json']) assert.equal(fs.existsSync(path.join(output, file)), false);
  const catalog = fs.readFileSync(path.join(output, 'catalog.html'), 'utf8');
  assert.ok(catalog.indexOf('api-client.js') < catalog.indexOf('src="catalog.js"'));
});

test('catalog UI searches hosted API records and escapes API-supplied display text', async () => {
  class Node {
    constructor() { this.value = ''; this.textContent = ''; this.innerHTML = ''; this.children = []; this.classList = { add() {}, remove() {} }; }
    addEventListener() {} setAttribute() {} appendChild(child) { this.children.push(child); } replaceChildren() { this.children = []; this.innerHTML = ''; }
  }
  const ids = ['catalogIndex', 'catalogDetail', 'catalogCount', 'catalogControls', 'catalogSearch', 'genreFilter', 'formatFilter', 'pageStatus', 'prevPage', 'nextPage', 'filterStatus', 'benchmarkReadout'];
  const nodes = new Map(ids.map(id => [id, new Node()]));
  const requests = [], tasks = [];
  const record = { recordId: 'CAT-0011', title: '<img src=x onerror=alert(1)>', author: 'Remote author', year: 1965, format: 'Print Book', genre: 'Science Fiction', audience: 'Adult', subjects: ['Ecology'], description: 'Catalog description', callNumber: 'FIC HER' };
  const context = vm.createContext({
    document: { getElementById: id => nodes.get(id), createElement: () => new Node() },
    window: { PericlesApi: { fetch: async url => { requests.push(url); return { ok: true, json: async () => ({ results: [record] }) }; } } },
    CATALOG_ENTRIES: [{ ...record, title: 'Local-only title' }],
    performance: { now: () => 0 }, setTimeout, clearTimeout,
    requestAnimationFrame: callback => tasks.push(Promise.resolve().then(callback))
  });
  vm.runInContext(source('catalog.js'), context);
  await Promise.all(tasks);
  nodes.get('catalogSearch').value = 'Dune';
  vm.runInContext('scheduleRender()', context);
  await Promise.all(tasks);
  assert.deepEqual(requests, ['/api/catalog/search?q=dune&limit=50']);
  assert.match(nodes.get('catalogDetail').innerHTML, /&lt;img/);
  assert.doesNotMatch(nodes.get('catalogDetail').innerHTML, /<img|Local-only title/);
});

test('Pages workflow is manual and publishes only the frontend build artifact', () => {
  const workflow = source('.github/workflows/pages.yml');
  assert.match(workflow, /on:\s+workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request):/m);
  assert.match(workflow, /PUBLIC_BACKEND_URL: https:\/\/pericles-api.onrender.com/);
  assert.match(workflow, /path: dist-frontend/);
  assert.match(workflow, /needs: build/);
  assert.match(workflow, /npm test/);
});
