'use strict';

const {
  LIBRARY_HOURS,
  EVENTS_CONTEXT,
  SERVICES_CONTEXT,
  POLICY_CONTEXT
} = require('../knowledge/library-facts');
const { INSTITUTIONAL_CONTEXT } = require('../knowledge/institutional-context');

function formatCatalogMatches(catalogMatches) {
  if (!catalogMatches.length) {
    return 'Relevant Collection Matches:\n- No confident title matches found for this prompt in the catalog seed index.';
  }

  const lines = catalogMatches.map((entry, index) => {
    return `${index + 1}. ${entry.title} by ${entry.author} (${entry.year}) | ${entry.format} | Call No: ${entry.callNumber} | Location: ${entry.location} | Subjects: ${(entry.subjects || []).join(', ')}`;
  });

  return `Relevant Collection Matches:\n${lines.join('\n')}`;
}

function buildGroundingContext({ catalogMatches = [] } = {}) {
  const sections = [
    `Verified Library Identity:\n- ${INSTITUTIONAL_CONTEXT.identity.library}\n- Assistant: ${INSTITUTIONAL_CONTEXT.identity.assistant}\n- Vendor: ${INSTITUTIONAL_CONTEXT.identity.vendor}`,
    `Library Hours:\n- ${LIBRARY_HOURS.join('\n- ')}`,
    `Events Calendar Context:\n- ${EVENTS_CONTEXT.join('\n- ')}`,
    `Services Context:\n- ${SERVICES_CONTEXT.join('\n- ')}`,
    `Policy Context:\n- ${POLICY_CONTEXT.join('\n- ')}`,
    `Community Context:\n- ${INSTITUTIONAL_CONTEXT.community.join('\n- ')}`,
    formatCatalogMatches(catalogMatches),
    'Catalog Scope Note:\n- The demonstration catalog is generated from a seed title list. A missing match does not prove that a real library would not own the item. Suggest the Card Catalog page when the supplied matches are insufficient.'
  ];

  return sections.join('\n\n');
}

module.exports = { buildGroundingContext };
