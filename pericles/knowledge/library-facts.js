'use strict';

const KNOWLEDGE = require('./library-knowledge.json');
const LIBRARY_HOURS = KNOWLEDGE.hours.display;
const EVENTS_CONTEXT = KNOWLEDGE.events;

const SERVICES_CONTEXT = [
  'Public computers and in-library internet access are available.',
  'Technology assistance and public training seminars are offered.',
  `In-person research help is offered through ${KNOWLEDGE.researchHelp.department} by ${KNOWLEDGE.researchHelp.librarian}, ${KNOWLEDGE.researchHelp.title}. ${KNOWLEDGE.researchHelp.availability} Times use ${KNOWLEDGE.researchHelp.timezone}. Research help includes genealogy, local history, topic development, source selection, citation guidance, and source evaluation.`,
  'Youth Services coordinates programming and technology learning with local schools.',
  'Local history and special collections questions may require referral to a specialist.',
  'Selected patron accounts support server-confirmed renewals, holds, fee settlement, and program registration/cancellation. Each change needs a preview and confirmation.'
];

const POLICY_CONTEXT = [
  'Pericles must not invent SPL policies, holdings, fees, or staff actions.',
  'Account information is available through the selected server-side account; never invent account state.',
  'SPL supports intellectual freedom and equitable access to lawful information.',
  'SPL values patron privacy, but this pilot packet does not yet establish a complete chat retention policy.',
  'Provide useful general subject guidance first. Refer only the part needing professional decisions, private records, unavailable institutional authority, assessment, or immediate human safety intervention.'
];

module.exports = {
  LIBRARY_HOURS,
  EVENTS_CONTEXT,
  SERVICES_CONTEXT,
  POLICY_CONTEXT
};
