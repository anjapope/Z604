'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { communitySupportReply: answer } = require('../community-support');
const providers = require('../knowledge/community-support.json').providers;
test('practical needs match appropriate providers without invented contacts or actions', () => {
  for (const [question, expected] of [
    ['I am homeless with two kids', 'Family Bridge'],
    ['My husband hits me. I need somewhere safe.', 'Willow Haven'],
    ['Where can I find drug rehab?', 'Open Door'],
    ['I cannot afford groceries. Is there a food pantry?', 'Community Table'],
    ['Who provides Head Start?', 'Bright Beginnings'],
    ['My child is autistic. What support is available?', 'Autism and Family Resource Center'],
    ['I need help paying utilities', 'Family Resource Exchange']
  ]) {
    const r = answer(question, {});
    assert.ok(r, question); assert.match(r.reply, new RegExp(expected));
    assert.match(r.reply, /Start here:.*\nHours:/);
    assert.doesNotMatch(r.reply, /555-|https?:|I have (?:booked|registered|called)/);
  }
});
test('support followups use the selected provider and unrelated topics clear context', () => {
  const session = {};
  answer('Tell me about Willow Haven Survivor Services', session);
  assert.match(answer('What are their hours?', session).reply, /Willow Haven/);
  assert.equal(answer('Find books about autism', session), null);
  assert.equal(answer('What are their hours?', session), null);
});
test('directory links identify real page sections and full directory is available', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const page = fs.readFileSync(path.join(__dirname, '../../community-support.html'), 'utf8');
  const reply = answer('List local nonprofits', {}).reply;
  assert.equal(providers.length, 13);
  for (const p of providers) { assert.ok(page.includes(`id="${p.id}"`)); assert.ok(reply.includes(p.name)); }
  assert.match(answer('drug rehab after an overdose', {}).reply, /^If someone may be overdosing/);
});
test('HTTP chat routes support and followups through conversational generation without an account', async () => {
  require('dotenv').config = () => ({ parsed: {} });
  const { app } = require('../../server');
  const originalComposer = app.locals.composeServiceReply;
  let calls = 0;
  app.locals.composeServiceReply = async ({ payload }) => { calls++; return payload; };
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
    let token;
    async function chat(message) {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, { method:'POST', headers:{'Content-Type':'application/json', ...(token ? {'X-Demo-Session': token} : {})}, body:JSON.stringify({message}) });
      token = r.headers.get('x-demo-session') || token;
      assert.equal(r.status,200); return r.json();
    }
    assert.match((await chat('My husband hits me. Where can I get help?')).reply,/Willow Haven/);
    assert.match((await chat('What are their hours?')).reply,/Willow Haven/);
    assert.equal(calls,2);
    const page = await fetch(`http://127.0.0.1:${server.address().port}/community-support.html`);
    assert.equal(page.status,200);
  } finally {
    app.locals.composeServiceReply = originalComposer;
    await new Promise(resolve => server.close(resolve));
  }
});
