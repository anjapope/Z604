'use strict';

const {
  LIBRARY_HOURS,
  EVENTS_CONTEXT,
  SERVICES_CONTEXT,
  POLICY_CONTEXT
} = require('../knowledge/library-facts');
const { INSTITUTIONAL_CONTEXT } = require('../knowledge/institutional-context');
const { CATALOG_ENTRIES } = require('../catalog-service');
const { lendingLimitsText } = require('../lending-policy');

function formatCatalogMatches(catalogMatches) {
  if (!catalogMatches.length) {
    return 'Relevant Collection Matches:\n- No relevant records were found in the demonstration catalog for this prompt.';
  }

  const lines = catalogMatches.map((entry, index) => {
    return `${index + 1}. Record ${entry.recordId}: ${entry.title} by ${entry.author} (${entry.year}) | ${entry.format} | Call No: ${entry.callNumber} | Location: ${entry.location} | Subjects: ${(entry.subjects || []).join(', ')}`;
  });

  return `Verified Demonstration Catalog Records (record existence only; availability is not tracked):\n${lines.join('\n')}`;
}

function buildGroundingContext({ catalogMatches = [] } = {}) {
  const sections = [
    `Verified Library Identity:\n- ${INSTITUTIONAL_CONTEXT.identity.library}\n- Assistant: ${INSTITUTIONAL_CONTEXT.identity.assistant}\n- Vendor: ${INSTITUTIONAL_CONTEXT.identity.vendor}`,
    `Library Hours:\n- ${LIBRARY_HOURS.join('\n- ')}`,
    `Events Calendar Context:\n- ${EVENTS_CONTEXT.join('\n- ')}`,
    `Services Context:\n- ${SERVICES_CONTEXT.join('\n- ')}`,
    `Policy Context:\n- ${POLICY_CONTEXT.join('\n- ')}`,
    `Lending limits:\n${lendingLimitsText()}`,
    `Fee policy:\n${require('../knowledge/library-knowledge.json').circulation.fines}`,
    'New checkout rule: any outstanding balance blocks new checkouts until settled in full. This does not change renewal, hold, or program eligibility. Apply it only to a verified account balance; do not infer a debt from the patron’s messages.',
    `Community Context:\n- ${INSTITUTIONAL_CONTEXT.community.join('\n- ')}`,
    formatCatalogMatches(catalogMatches),
    `Catalog Scope Note:\n- The demonstration catalog contains ${CATALOG_ENTRIES.length} generated records; this is not a verified inventory of the library's complete real-world holdings.\n- Catalog records do not indicate current availability, checkout status, or whether an item is on the shelf.\n- A missing match does not prove that a real library would not own the item.`
  ];

  return sections.join('\n\n');
}

module.exports = { buildGroundingContext };
