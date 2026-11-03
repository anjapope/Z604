'use strict';
// Explicit live verification of fictional, disposable records only. No paid AI calls.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const origin = 'https://anjapope.github.io';
const backend = 'https://pericles-api.onrender.com';
const report = { backend, frontend: origin + '/Z604/', checks: [], transactions: [] };
const storage = new Map();
const window = {
  location: { origin, hostname: 'anjapope.github.io', href: origin + '/Z604/index.html' },
  sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  fetch: async (url, options) => {
    assert.ok(url.startsWith(backend + '/api/'));
    assert.equal(options.credentials, 'omit');
    const headers = new Headers(options.headers);
    headers.set('Origin', origin);
    const response = await fetch(url, { ...options, headers });
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    if (response.headers.get('x-demo-session')) assert.match(response.headers.get('access-control-expose-headers'), /X-Demo-Session/i);
    return response;
  }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../frontend-config.js'), 'utf8'), { window });
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../api-client.js'), 'utf8'), { window, URL, Headers, AbortSignal });
async function api(route, body) {
  const response = await window.PericlesApi.fetch(route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  report.checks.push({ route, status: response.status });
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
async function chat(message) {
  const result = await api('/api/chat', { message });
  return result.reply;
}
(async () => {
  assert.deepEqual(await api('/api/health'), { ok: true });
  const preflight = await fetch(backend + '/api/circulation/confirm', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-demo-session' }, signal: AbortSignal.timeout(45000) });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /X-Demo-Session/i);
  report.checks.push({ route: 'approved preflight', status: preflight.status });
  const blocked = await fetch(backend + '/api/health', { headers: { Origin: 'https://unapproved.example' }, signal: AbortSignal.timeout(45000) });
  assert.equal(blocked.status, 403);
  report.checks.push({ route: 'unapproved origin', status: blocked.status });
  const catalog = await api('/api/catalog/search?q=Dune&limit=5');
  assert.ok(catalog.results.some(record => record.title === 'Dune'));
  assert.match(await chat('When is Storytime?'), /Storytime/);
  const advisory = await chat('Recommend fantasy for my seven-year-old.');
  assert.match(advisory, /Why it fits/);
  report.advisory = advisory;
  const patrons = await api('/api/circulation/patrons');
  assert.equal(patrons.patrons.length, 3);
  for (const id of ['A', 'B', 'C']) {
    await api('/api/circulation/selection', { accountId: id });
    assert.equal((await api('/api/circulation/account')).patron.id, id);
  }
  let selected, loan;
  for (const id of ['B', 'A', 'C']) {
    selected = await api('/api/circulation/selection', { accountId: id });
    loan = selected.loans.find(item => item.eligible);
    if (loan) break;
  }
  if (loan) {
    const preview = await chat(`Renew ${loan.id}.`);
    assert.match(preview, /Confirm renewal/);
    const confirmed = await chat('Yes');
    assert.match(confirmed, /Server confirmed renewal/);
    const account = await api('/api/circulation/account');
    const updated = account.loans.find(item => item.id === loan.id);
    assert.equal(updated.renewals, loan.renewals + 1);
    assert.notEqual(updated.dueDate, loan.dueDate);
    report.transactions.push({ action: 'renew', preview, confirmed, verifiedDueDate: updated.dueDate });
    assert.match(await chat('Yes'), /no pending/);
  } else report.transactions.push({ action: 'renew', limitation: 'All live fictional loans are blocked or at their renewal limit; no reset was attempted.' });
  let held = false;
  for (const id of ['B', 'A']) {
    await api('/api/circulation/selection', { accountId: id });
    for (const title of ['Dune', 'Pride and Prejudice', 'Becoming', 'The Glass Castle']) {
      const preview = await chat(`Place a hold on ${title}.`);
      if (!/Confirm placement/.test(preview)) continue;
      const confirmed = await chat('Yes');
      assert.match(confirmed, /Server confirmed hold placement/);
      const account = await api('/api/circulation/account');
      assert.ok(account.holds.some(hold => hold.title === title));
      report.transactions.push({ action: 'hold', preview, confirmed });
      assert.match(await chat(`Place a hold on ${title}.`), /already has an active hold/);
      held = true;
      break;
    }
    if (held) break;
  }
  if (!held) report.transactions.push({ action: 'hold', limitation: 'No eligible hold in tested live accounts; shared demo state was not reset.' });
  for (const route of ['/server.js', '/.env', '/pericles/data/circulation.json', '/pericles/evaluation/provenance-live-result.json']) {
    const response = await fetch(backend + route, { method: 'HEAD', signal: AbortSignal.timeout(45000) });
    report.checks.push({ route, status: response.status });
    assert.equal(response.status, 404);
  }
  const page = await fetch(origin + '/Z604/', { signal: AbortSignal.timeout(45000) });
  const html = await page.text();
  report.currentPages = { status: page.status, loadsAPIClient: html.includes('api-client.js') };
  const github = await fetch('https://api.github.com/repos/anjapope/Z604/actions/workflows', { headers: { 'User-Agent': 'PERICLES-classroom-verification' }, signal: AbortSignal.timeout(45000) });
  report.currentRemoteWorkflows = { status: github.status };
  if (github.ok) report.currentRemoteWorkflows.workflows = (await github.json()).workflows.map(({ name, path, state }) => ({ name, path, state }));
  report.passed = true;
})().catch(error => { report.passed = false; report.error = error.message; process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(path.join(__dirname, 'pages-render-live-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});
