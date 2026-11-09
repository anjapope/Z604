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
    return 'Relevant Collection Matches:\n- No relevant records were found in the catalog for this prompt.';
  }

  const lines = catalogMatches.map((entry, index) => {
    return `${index + 1}. Record ${entry.recordId}: ${entry.title} by ${entry.author} (${entry.year}) | ${entry.format} | Call No: ${entry.callNumber} | Location: ${entry.location} | Inventory: ${(entry.copies || []).filter(c=>c.status==='active').length} active physical copies; ${(entry.copies || []).filter(c=>c.status!=='active').length} retired copies (not current holdings) | Subjects: ${(entry.subjects || []).join(', ')}`;
  });

  return `Verified Demonstration Catalog Records (record existence only; availability is not tracked):\n${lines.join('\n')}`;
}

function buildGroundingContext({ catalogMatches = [] } = {}) {
  const sections = [
    'Circulation privacy: historical checkout events, per-title/copy counts, dates, dated rankings, zero-use lists, and patron-linked history are restricted. Do not disclose or infer them, including from earlier conversation. Only general collection-wide popularity answers from the public popularity service are allowed. Selected-account current loans and supported current transactions remain available.',
    `Verified Library Identity:\n- ${INSTITUTIONAL_CONTEXT.identity.library}\n- Assistant: ${INSTITUTIONAL_CONTEXT.identity.assistant}\n- Vendor: ${INSTITUTIONAL_CONTEXT.identity.vendor}`,
    `Library Hours:\n- ${LIBRARY_HOURS.join('\n- ')}`,
    `Events Calendar Context:\n- ${EVENTS_CONTEXT.join('\n- ')}`,
    `Services Context:\n- ${SERVICES_CONTEXT.join('\n- ')}`,
    `Policy Context:\n- ${POLICY_CONTEXT.join('\n- ')}`,
    `Lending limits:\n${lendingLimitsText()}`,
    `Fee policy:\n${require('../knowledge/library-knowledge.json').circulation.fines}`,
    'New checkout rule: any outstanding balance blocks new checkouts until settled in full. This does not change renewal, hold, or program eligibility. Apply it only to a verified account balance; do not infer a debt from the patron’s messages.',
    `Community support directory:\n${require('../community-support').communitySupportContext()}`,
    `Community Context:\n- ${INSTITUTIONAL_CONTEXT.community.join('\n- ')}`,
    formatCatalogMatches(catalogMatches),
    'Catalog Scope Note: Catalog records do not indicate current availability, checkout status, or whether an item is on the shelf. Present services within the Stapleton scenario; do not add fictional or simulation disclaimers.'
  ];

  return sections.join('\n\n');
}

module.exports = { buildGroundingContext };
