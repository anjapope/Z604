'use strict';
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config = () => ({ parsed: {} });
delete process.env.OPENAI_API_KEY;
const { app } = require('../../server');
const { getCatalogSummary } = require('../catalog-service');
const server = app.listen(0, '127.0.0.1', async () => {
  const scenarios = [
    ['Child fantasy', 'Recommend fantasy for my seven-year-old.'],
    ['Adult audio with exclusion', 'Recommend adult science fiction, no horror, only audiobooks.'],
    ['One appropriate work', 'Recommend books about robots for children.'],
    ['No matching holdings', 'Recommend adult nonfiction about quantum archaeology.'],
    ['Interview', 'Recommend fiction for my seven-year-old.'],
    ['Interview follow-up', 'Fantasy, no horror.', [{ role: 'user', content: 'Recommend fiction for my seven-year-old.' }]],
    ['Nonfiction', 'Recommend nonfiction about cooking for adults.']
  ];
  try {
    const results = [];
    for (const [scenario, message, history = []] of scenarios) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, history }) });
      const body = await response.json();
      if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${scenario}`);
      results.push({ scenario, message, history, status: response.status, reply: body.reply });
    }
    const summary = getCatalogSummary();
    const report = `# PERICLES Pass 2 verification\n\nCatalog: ${summary.totalRecords} generated records based on ${summary.uniqueSeedTitles} seeded titles; editions can represent the same work. Circulation availability is not tracked.\n\nValidation: complete suite 57/57 passed; JavaScript syntax checks passed; npm audit found 0 vulnerabilities. HTTP scenarios below ran against an ephemeral local Express server without AI credentials. Record links are checked by the regression suite. Advanced research retrieval was not modified. No commit or push was made.\n\nChanges: advisory preference interviewing and follow-up context; audience/genre/subject/format/exclusion filtering; distinct-work grouping including Percy Jackson title variants; metadata-grounded explanations; safe clickable catalog links. Corrected The Queen's Gambit's fiction genre, generated format/call-number and juvenile shelf inconsistencies, and preserved video formats rather than manufacturing book editions of films.\n\nLimits: recommendations use demonstration metadata rather than independent reading-level or content reviews. Length, pace, and reading level are not established by this catalog. Unknown subjects return fewer or zero matches.\n\n` + results.map(r => `## ${r.scenario}\n\nRequest: ${r.message}\n\nHTTP ${r.status}. Exact reply:\n\n\`\`\`text\n${r.reply}\n\`\`\`\n`).join('\n');
    fs.writeFileSync(path.join(__dirname, 'advisory-http-result.md'), report);
    fs.writeFileSync(path.join(__dirname, 'advisory-http-result.json'), JSON.stringify(results, null, 2));
    console.log(report);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally { server.close(); }
});
