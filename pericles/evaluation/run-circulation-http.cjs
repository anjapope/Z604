'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
require('dotenv').config = () => ({ parsed: {} });
delete process.env.OPENAI_API_KEY;
const { app } = require('../../server');
const { createCirculationService } = require('../circulation-service');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pericles-circulation-http-'));
const clock = () => new Date('2026-11-02T17:00:00Z');
app.locals.circulation = createCirculationService({ filePath: path.join(directory, 'circulation.json'), now: clock });
const browserMode = process.argv.includes('--browser');
const server = app.listen(browserMode ? 4053 : 0, '127.0.0.1', async () => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const steps = [];
  async function request(url, body) {
    const response = await fetch(origin + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, payload };
  }
  async function chat(message, expected) {
    const { status, payload } = await request('/api/chat', { message });
    assert.equal(status, 200);
    assert.match(payload.reply, expected);
    steps.push({ message, status, reply: payload.reply });
  }
  try {
    assert.equal((await request('/api/circulation/selection', { accountId: 'B' })).status, 200);
    await chat('When are my books due?', /2026-10-28/);
    await chat('Can you renew everything?', /Confirm renewal/);
    await chat('Yes, renew the eligible ones.', /Educated: due 2026-11-23/);
    await chat('Yes, renew the eligible ones.', /no pending/);
    await chat("Why can't I renew this book?", /active hold/);
    await chat('Place a hold on Dune.', /Confirm placement/);
    await chat('Yes', /Server confirmed hold placement/);
    await chat('What holds do I already have?', /Dune/);
    await chat('Place a hold on Dune.', /already has an active hold/);
    await chat('Can you renew everything?', /Confirm renewal/);
    await chat('Cancel', /cancelled/);
    await chat('Yes', /no pending/);
    const final = (await request('/api/circulation/account')).payload;
    assert.equal(final.transactions.length, 2);
    assert.equal(final.loans.find(l => l.id === 'B-1').renewals, 1);
    assert.equal(final.loans.find(l => l.id === 'B-2').renewals, 0);
    assert.equal(final.loans.find(l => l.id === 'B-3').renewals, 2);
    assert.ok(final.holds.some(h => h.title === 'Dune'));
    const checks = [];
    for (const url of ['/account.html', '/account-summary.html', '/account.js', '/api/circulation/policies', '/api/catalog/summary', '/pericles/data/circulation.json', '/pericles/circulation-service.js', '/.env']) {
      const { status } = await request(url);
      const expected = url.startsWith('/pericles/') || url === '/.env' ? 404 : 200;
      assert.equal(status, expected);
      checks.push({ url, status });
    }
    const report = { fictional: true, testDate: '2026-11-02', steps, finalAccount: final, checks };
    fs.writeFileSync(path.join(__dirname, 'circulation-http-result.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(__dirname, 'circulation-http-result.md'), '# Pass 3 exact HTTP conversation\n\nFictional Patron B selected through the server session. Isolated temporary JSON store; fixed library date 2026-11-02. No AI credentials or external calls.\n\n' + steps.map(step => `Patron: ${step.message}\n\nHTTP ${step.status}, exact Pericles reply:\n\n\`\`\`text\n${step.reply}\n\`\`\`\n`).join('\n') + '\nAccount API verified: Educated due 2026-11-23, renewal count 1; The Great Gatsby remains due 2026-11-06, count 0; 1984 remains due 2026-11-08, count 2. Holds include The Hobbit and Dune; exactly two completed transactions.\n\nHTTP page/API and protected-file checks:\n\n' + checks.map(check => `- ${check.url}: ${check.status}`).join('\n') + '\n');
    console.log(`PASS: ${steps.length} conversational turns, authoritative final state, and ${checks.length} HTTP checks. Reports: pericles/evaluation/circulation-http-result.md and .json.`);
    if (browserMode) console.log(`Isolated browser verification server: ${origin}`);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    if (!browserMode || process.exitCode) server.close(() => { for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name)); fs.rmdirSync(directory); });
  }
});
