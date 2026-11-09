'use strict';
const KNOWLEDGE = require('./knowledge/library-knowledge.json');
const { circulationIntent } = require('./circulation-intent');
const { lendingLimitsText } = require('./lending-policy');
const PREFIX = 'For fictional Stapleton Public Library: ';

function institutionalTopic(text) {
  if (circulationIntent(text)) return null;
  // Library-related words in a requested book/topic are not policy questions.
  if (/\b(?:recommend\w*|suggest\w*|looking for|books? (?:about|by|on))\b|\b(?:search|browse)\b.*\bcatalog(?:ue)?\b/i.test(text)) return null;
  if (/\b(?:holiday|holidays|exceptional closures?)\b/i.test(text)) return 'holidays';
  if (/\b(?:hours?|open(?:ing)?|clos(?:e|es|ed|ing))\b/i.test(text) && /\b(?:hours?|library|you|tonight|today|tomorrow|now|currently|time|when|sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?)\b/i.test(text) && !/\b(?:account|record|catalog|borrow)\b/i.test(text)) return 'hours';
  if (/\b(?:patron rights|my rights|rights as|rights do|freedom of inquiry|intellectual freedom|book challenges?)\b/i.test(text)) return /challenges?/i.test(text) ? 'challenges' : 'rights';
  if (/\b(?:responsibilit\w*|patron conduct|code of conduct)\b/i.test(text)) return 'responsibilities';
  if (/\b(?:privacy|private|confidential\w*|retention|borrowing history)\b/i.test(text)) return 'privacy';
  if (/\b(?:library cards?|membership|nonresident|residency|identification)\b/i.test(text)) return 'membership';
  if (/\b(?:overdue fines?|replacement charges?|lost or damaged|lost (?:a |my )?book|damaged (?:a |my )?book)\b/i.test(text) && !/\b(?:pay|my (?:fine|balance))\b/i.test(text)) return 'fees';
  if (/\b(?:renewal (?:policy|policies|rules?|limits?)|renew\w*.*(?:another patron|someone else|on hold)|how many (?:times|renewals))\b/i.test(text) || /\bcan i renew (?:a book|an item|something|materials?)[?.!]*$/i.test(text)) return 'renewals';
  if (/\b(?:loan periods?|loan lengths?|how long.*(?:borrow|check out|checkout|keep)|borrowing rules)\b/i.test(text)) return 'loans';
  if (/\bhow many (?:more )?(?:books|items|materials|dvds?|video games?|games)\b.*\b(?:can|may|allowed)\b|\b(?:maximum|max|limit|limits)\b.*\b(?:checkout|checkouts|check out|books?|dvds?|video games?|borrow\w*)\b|\b(?:checkout|checkouts|borrowing)\s+limits?\b/i.test(text)) return 'checkoutLimit';
  if (/\b(?:hold (?:policy|rules?|limits?)|how many.*holds|how (?:do|can) i.*(?:place|request).*hold)\b/i.test(text)) return 'holds';
  if (/\b(?:circulation polic\w*)\b/i.test(text)) return 'circulation';
  if (/\b(?:phone|telephone|email|street address|contact|where is (?:the )?library|where (?:is|are) (?:the )?(?:archive room|reference desk))\b/i.test(text)) return 'contact';
  if (/\b(?:computer|computers|internet|wi-?fi|technology (?:help|assistance)|tech (?:help|support)|device (?:help|support))\b/i.test(text)) return 'technology';
  if (/\b(?:accessib\w*|wheelchair|assistive|screen reader|accommodations?)\b/i.test(text)) return 'accessibility';
  if (/\bmeeting[- ]rooms?\b/i.test(text)) return 'rooms';
  if (/\b(?:what services|library services|services do you|services are|what can the library)\b/i.test(text)) return 'services';
  if (/\b(?:policy|policies|procedures)\b/i.test(text)) return 'unspecified';
  return null;
}

function formatMinutes(value) {
  const hour = Math.floor(value / 60);
  return `${hour % 12 || 12}:${String(value % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}
function localStatus(now = new Date(), tomorrow = false) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: KNOWLEDGE.timezone, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]));
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
  if (tomorrow) date.setUTCDate(date.getUTCDate() + 1);
  const day = tomorrow ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(date) : parts.weekday;
  const hours = KNOWLEDGE.hours.week[day];
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return { day, date: date.toISOString().slice(0, 10), hours, open: Boolean(hours && minute >= hours.open && minute < hours.close), minute };
}
function answerHours(text, now) {
  const exception = KNOWLEDGE.hours.exceptions;
  if (/\b(?:today|tonight|now|currently|tomorrow)\b/i.test(text)) {
    const tomorrow = /\btomorrow\b/i.test(text);
    const status = localStatus(now, tomorrow);
    const scheduled = status.hours ? `${status.day} ${status.date}: ${formatMinutes(status.hours.open)}-${formatMinutes(status.hours.close)}` : `${status.day} ${status.date}: Closed`;
    const current = tomorrow ? '' : ` Based on regular hours, it is ${status.open ? 'open' : 'closed'} now in ${KNOWLEDGE.timezone}.`;
    return `${scheduled}.${current} ${exception}`;
  }
  const requested = [...text.matchAll(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/gi)].map(match => match[1].toLowerCase());
  if (requested.length) return [...new Set(requested)].map(day => {
    const name = day[0].toUpperCase() + day.slice(1);
    const hours = KNOWLEDGE.hours.week[name];
    return `${name}: ${hours ? `${formatMinutes(hours.open)}-${formatMinutes(hours.close)}` : 'Closed'}.`;
  }).join(' ') + ` Regular hours use ${KNOWLEDGE.timezone}. ${exception}`;
  return `${KNOWLEDGE.hours.display.join('\n')}\nTime zone: ${KNOWLEDGE.timezone}. ${exception}`;
}

function answerInstitutional(message, context = message, { now = new Date() } = {}) {
  let topic = institutionalTopic(message);
  if (!topic && /^(?:and |what about )?(?:dvds?|video games?|games|books?)[?.!]*$/i.test(message.trim()) && /\b(?:limit|maximum|how many)\b/i.test(context)) topic = 'checkoutLimit';
  if (!topic && /^(?:and |what about )?(?:audio(?:books?)?|ebooks?|digital|video|print|large print)[?.!]*$/i.test(message.trim()) && /\b(?:borrow|loan|check out)\b/i.test(context)) topic = 'loans';
  if (!topic) return null;
  const c = KNOWLEDGE.circulation;
  let answer;
  switch (topic) {
    case 'hours': answer = answerHours(message, now); break;
    case 'holidays': answer = KNOWLEDGE.hours.exceptions; break;
    case 'membership': answer = `${KNOWLEDGE.membership.known} ${KNOWLEDGE.membership.unknown}`; break;
    case 'rights': answer = `Patron rights include: ${KNOWLEDGE.rights.join('; ')}. Privacy is a commitment, not absolute confidentiality or a legal guarantee. Specific accommodation and policy procedures are not established.`; break;
    case 'responsibilities': answer = `${KNOWLEDGE.responsibilities.join('; ')}. Never share real credentials here; this is a classroom demonstration.`; break;
    case 'privacy': answer = KNOWLEDGE.privacy; break;
    case 'fees': answer = c.fines; break;
    case 'renewals': answer = `You can renew eligible items up to ${c.renewalLimit} times. A hold from another patron blocks renewal. No renewal was initiated.`; break;
    case 'holds': answer = `You can have up to ${c.holdLimit} active holds, one per title. You cannot place a hold on a title you already have checked out. No hold was initiated.`; break;
    case 'loans': answer = `Loan periods: print and large print ${c.loanDays['Print Book']} days; ebooks and audiobooks ${c.loanDays.Ebook} days; DVD and Blu-ray ${c.loanDays.DVD} days. These are general policies; eligibility for a particular loan depends on the selected fictional account. No transaction was initiated.`; break;
    case 'checkoutLimit': answer = `${lendingLimitsText()} Outstanding balances block new checkouts until settled in full. This does not change renewal, hold, or program eligibility.`; break;
    case 'circulation': answer = `At once, per account: ${c.checkoutLimits.books} books, ${c.checkoutLimits.dvds} DVDs, and ${c.checkoutLimits.videoGames} video games. Print/large print: ${c.loanDays['Print Book']} days; ebooks/audio: ${c.loanDays.Ebook} days; DVD/Blu-ray: ${c.loanDays.DVD} days. Up to ${c.renewalLimit} renewals if eligible; another patron’s hold blocks renewal. Up to ${c.holdLimit} active holds. No overdue fines; replacement charges may apply.`; break;
    case 'contact': answer = KNOWLEDGE.contact.unknown; break;
    case 'technology': answer = KNOWLEDGE.technology; break;
    case 'accessibility': answer = KNOWLEDGE.accessibility; break;
    case 'rooms': answer = KNOWLEDGE.rooms; break;
    case 'services': answer = `Services include ${KNOWLEDGE.services.join('; ')}. Specific program dates, computer limits, and equipment availability require confirmation; they are not established here.`; break;
    case 'challenges': answer = KNOWLEDGE.challenges; break;
    default: answer = 'Which policy or procedure would you like to know about: membership, borrowing, privacy, or patron rights?';
  }
  if (topic === 'renewals' && /\b(?:details?|more|explain|calculat\w*)\b/i.test(message)) answer += ' A renewal adds the normal loan period to the later of today or the current due date. Overdue items may still be eligible.';
  return PREFIX + answer;
}
function splitInstitutionalRequest(message) {
  const clauses = message.split(/\?\s*(?:and\s+)?|[.;]\s+(?:and\s+)?|\band\s+(?=(?:can you\s+)?(?:recommend|suggest)|(?:please\s+)?renew\b)/i).map(text => text.trim()).filter(Boolean);
  return clauses.length > 1 && clauses.some(text => institutionalTopic(text)) ? clauses : null;
}
module.exports = { KNOWLEDGE, institutionalTopic, answerInstitutional, localStatus, splitInstitutionalRequest };
