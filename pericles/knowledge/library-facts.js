'use strict';

const KNOWLEDGE = require('./library-knowledge.json');
const LIBRARY_HOURS = KNOWLEDGE.hours.display;
const EVENTS_CONTEXT = KNOWLEDGE.events;

const SERVICES_CONTEXT = [
  'Public computers and in-library internet access are available.',
  'Technology assistance and public training seminars are offered.',
  'Research help includes topic development, source selection, citation guidance, and source evaluation.',
  'Youth Services coordinates programming and technology learning with local schools.',
  'Local history and special collections questions may require referral to a specialist.',
  'Pericles cannot access real individual patron accounts, renew real loans, collect payments, or view confidential borrowing records. Separately, three explicitly fictional classroom accounts support server-confirmed demonstration renewals and holds.'
];

const POLICY_CONTEXT = [
  'Pericles must not invent SPL policies, holdings, fees, or staff actions.',
  'Real patron account information is not available to Pericles; fictional demonstration records are available only through the selected server-side account.',
  'SPL supports intellectual freedom and equitable access to lawful information.',
  'SPL values patron privacy, but this pilot packet does not yet establish a complete chat retention policy.',
  'Complex legal, medical, archival, accessibility, or crisis questions should be referred to appropriate human assistance.'
];

module.exports = {
  LIBRARY_HOURS,
  EVENTS_CONTEXT,
  SERVICES_CONTEXT,
  POLICY_CONTEXT
};
