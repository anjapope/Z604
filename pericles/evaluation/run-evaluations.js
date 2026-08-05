'use strict';

const fs = require('fs');
const path = require('path');

const scenariosPath = path.resolve(__dirname, 'scenarios.json');
const scenarios = JSON.parse(fs.readFileSync(scenariosPath, 'utf8'));

console.log(`Loaded ${scenarios.length} Pericles evaluation scenarios.`);
console.log('This v0.1 runner is intentionally manual: submit each prompt through the UI and record whether expected behaviors and failure signals appear.');
console.log('A later version can add automated model calls and rubric scoring after the prompt architecture stabilizes.');

scenarios.forEach((scenario) => {
  console.log(`\n[${scenario.id}] ${scenario.user}`);
  console.log(`Expected: ${scenario.expected_behaviors.join('; ')}`);
  console.log(`Watch for: ${scenario.failure_signals.join('; ')}`);
});
