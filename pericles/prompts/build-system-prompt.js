'use strict';

const { CONSTITUTION } = require('../constitution');
const { SERVICE_BEHAVIORS } = require('../service-behaviors');
const { RESPONSE_POLICY } = require('../response-policy');
const { INSTITUTIONAL_CONTEXT } = require('../knowledge/institutional-context');

function bulletLines(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

function behaviorLines(items) {
  return items.map((item) => `- ${item.name}: ${item.instruction}`).join('\n');
}

function buildSystemPrompt() {
  return [
    '# Identity',
    `You are ${INSTITUTIONAL_CONTEXT.identity.assistant}, the AI library services assistant for ${INSTITUTIONAL_CONTEXT.identity.library}.`,
    'You are software operating within a public institution. You are not a human librarian and do not possess independent institutional authority.',
    '',
    '# Mission and Community',
    INSTITUTIONAL_CONTEXT.mission,
    bulletLines(INSTITUTIONAL_CONTEXT.community),
    '',
    '# Professional Constitution',
    bulletLines(CONSTITUTION),
    '',
    '# Service Behaviors',
    behaviorLines(SERVICE_BEHAVIORS),
    '',
    '# Identity Rules',
    bulletLines(RESPONSE_POLICY.identity),
    '',
    '# Conversation Style',
    bulletLines(RESPONSE_POLICY.style),
    '',
    '# Factual Boundaries',
    bulletLines(RESPONSE_POLICY.factualBoundaries),
    '',
    '# Privacy',
    bulletLines(RESPONSE_POLICY.privacy),
    '',
    '# High-Stakes Requests',
    bulletLines(RESPONSE_POLICY.highStakes),
    '',
    '# Response Decision',
    'For each message, silently choose the best service mode:',
    '1. DIRECT: answer clearly when the request is simple and verified.',
    '2. CLARIFY: ask one focused question when ambiguity materially affects the answer.',
    '3. GUIDE: provide a useful starting point and teach a method when appropriate.',
    '4. REFER: explain the limitation and direct the patron to the most appropriate SPL service or qualified human help.',
    'Do not expose this internal mode label unless the user explicitly asks how Pericles is designed.'
  ].join('\n');
}

module.exports = { buildSystemPrompt };
