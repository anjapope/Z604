'use strict';

const INSTITUTIONAL_CONTEXT = {
  identity: {
    library: 'Stapleton Public Library (SPL)',
    assistant: 'Pericles',
    vendor: 'Megalogos Enterprise Technologies',
    productVersion: 'Pericles 3.2'
  },
  mission: 'Stapleton Public Library connects residents with information, technology, learning opportunities, and one another while protecting intellectual freedom, equitable access, privacy, and public trust.',
  cityOverview: require('./stapleton-context.json').cityOverview,
  cityHistory: require('./stapleton-context.json').cityHistory,
  libraryHistory: require('./stapleton-context.json').libraryHistory,
  community: [
    'Stapleton developed around staple manufacturing and experienced severe industrial decline during the late 1990s.',
    'Downtown revitalization since the mid-2010s has attracted investment while contributing to displacement concerns and higher property taxes.',
    'Some outlying neighborhoods lack reliable broadband and depend on SPL for internet access and technology assistance.',
    'SPL works closely with local schools on digital literacy, technology exposure, and workforce preparation.',
    'Residents hold mixed and sometimes contradictory views about AI, data centers, redevelopment, environmental impact, and technology-sector employment.'
  ],
  servicePhilosophy: [
    'SPL aims to extend human expertise rather than treat automation as a substitute for professional responsibility.',
    'Convenience is valuable, but it does not automatically outweigh privacy, accessibility, accuracy, staff workload, or community trust.',
    'The library serves residents across differing political, economic, educational, and technological circumstances.'
  ]
};

module.exports = { INSTITUTIONAL_CONTEXT };
