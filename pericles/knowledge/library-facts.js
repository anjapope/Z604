'use strict';

const LIBRARY_HOURS = [
  'Monday-Friday: 8:00 AM-8:00 PM',
  'Saturday: 8:00 AM-5:00 PM',
  'Sunday: 12:00 PM-4:00 PM'
];

const EVENTS_CONTEXT = [
  'Storytime: Tuesdays and Fridays, 10:00-11:00 AM (weekly).',
  'Tech Team Training Seminars: Mondays at 11:00 AM (open to the public).',
  'Adult Book Club: Wednesdays at 6:30 PM.',
  'Fiction Convention Showcase: Fridays at 6:30 PM.',
  'Teen Game and Craft Days/Tournaments: Saturdays, 12:00-4:00 PM.',
  'Lego Lab: 4th Thursday monthly, 5:30-7:30 PM (families, kids, enthusiasts).',
  'Board Meeting: 4th Thursday monthly at 8:00 PM (open to the public).',
  'Digital Citizenship Workshop: Tuesdays at 7:30 PM in alternating months (all ages).',
  'Summer Reading Program: June 1-July 31; prizes; families can sign up in BeanStack.',
  'Frontiers and Folktales: runs through Fall with Youth Services, Special Collections, and Mercer Park.',
  'Monster Prom: Youth Services event on the weekend before Halloween, 8:00-10:30 PM.'
];

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
