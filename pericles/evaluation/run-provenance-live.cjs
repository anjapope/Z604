'use strict';
// Explicitly invoked only; never part of the offline test suite.
const fs = require('node:fs');
process.env.PERICLES_RESEARCH_DIAGNOSTICS = 'true';
const { app } = require('../../server');
const query = 'Find three credible sources on the history of public libraries in Indiana from 1900 to 1950, preferably primary sources.';
const info = console.info;
const diagnostics = [];
console.info = line => { try { diagnostics.push(JSON.parse(line)); } catch (_) {} };
const server = app.listen(0, '127.0.0.1', async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: query, history: [] })
    });
    const result = await response.json();
    const report = { query, status: response.status, diagnostics, patronResponse: result };
    fs.writeFileSync('pericles/evaluation/provenance-live-result.json', JSON.stringify(report, null, 2) + '\n');
    const counts = diagnostics.find(item => item.event === 'pericles_research_pipeline');
    const lines = ['# Pericles final research quality live test', '', query, '',
      `HTTP ${response.status}. Retrieved: ${counts?.retrievedCount ?? 'unavailable'}; evaluated: ${counts?.evaluatedCount ?? 'unavailable'}; accepted: ${counts?.acceptedCount ?? 'unavailable'}.`,
      '', '## Exact patron-facing response', '', result.reply || result.error, ''];
    for (const source of result.sources || []) {
      lines.push(`${source.category === 'direct' ? 'Direct source' : 'Supplementary lead'}: [${source.title || source.url}](${source.url})`, '', source.relevance, '');
    }
    fs.writeFileSync('pericles/evaluation/provenance-live-result.md', lines.join('\n'));
    info(JSON.stringify(report, null, 2));
    if (!response.ok) process.exitCode = 1;
  } finally { console.info = info; server.close(); }
});
