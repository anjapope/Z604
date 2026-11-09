'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const offerings = require('./knowledge/service-offerings.json');
const { dateAt, addDays } = require('./circulation-service');
const { childAge, recommendPrograms } = require('./program-advisory');
const knowledge = require('./knowledge/library-knowledge.json');
const waiversAllowed = () => knowledge.circulation.feeWaiversAllowed !== false;
const feeOptions = () => waiversAllowed()
  ? 'You may request a one-time courtesy credit up to $15 or a payment. Ask “waive my fees” or “pay my fees” for a preview.'
  : 'The full outstanding balance must be settled. Waivers, reductions, courtesy credits, and installment plans are not available under this policy. Ask “pay my fees” for a settlement preview; confirmation is required.';

function fail(message, status = 409) { const error = new Error(message); error.status = status; throw error; }
function localMinute(now) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: offerings.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return parts;
}
function namedProgram(text) {
  const normalize = value => value.toLowerCase().replace(/\bstory\s+time\b/g, 'storytime').replace(/[^a-z0-9]+/g, ' ').trim();
  const query = ` ${normalize(text)} `;
  return offerings.programs.find(p => [p.title, ...(p.aliases || [])].some(name => query.includes(` ${normalize(name)} `))) || null;
}
function upcomingPrograms(now = new Date()) {
  const today = dateAt(now);
  const events = [];
  for (let offset = 0; offset < 14; offset++) {
    const date = addDays(today, offset);
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    for (const program of offerings.programs) {
      if (!program.days.includes(day) || (offset === 0 && program.time <= localMinute(now))) continue;
      events.push({ ...program, eventId: `${program.id}@${date}`, date });
    }
  }
  return events.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}
function programMatches(message, now = new Date()) {
  const today = dateAt(now);
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = addDays(today, -((day + 6) % 7));
  const events = upcomingPrograms(now).filter(e => {
    if (/\btomorrow\b/i.test(message)) return e.date === addDays(today, 1);
    if (/\btoday\b/i.test(message)) return e.date === today;
    if (/\bthis week\b/i.test(message)) return e.date < addDays(monday, 7);
    if (/\bnext week\b/i.test(message)) return e.date >= addDays(monday, 7) && e.date < addDays(monday, 14);
    return true;
  });
  const named = namedProgram(message);
  const direct = events.filter(e => e.id === named?.id || message.includes(e.eventId));
  if (direct.length) return direct;
  const terms = message.match(/storytime|tax|3[- ]?d|maker|phonics|remedial|reading|comprehension|homework|study|math|writing|tech|computer|book club|youth|child|kid|teen/gi) || [];
  const matches = events.filter(e => terms.some(term => `${e.title} ${e.tags.join(' ')} ${e.audience}`.toLowerCase().includes(/3[- ]?d/i.test(term) ? '3d' : /remedial/i.test(term) ? 'learning support' : /child|kid|teen/i.test(term) ? 'youth' : term.toLowerCase())));
  return terms.length ? matches : events;
}
function isProgramRequest(message) {
  if (namedProgram(message)) return true;
  if (/\b(?:explain|teach|troubleshoot|research|how (?:does|do|can|should))\b/i.test(message)
    && !/\b(?:sign|register|enroll|book|upcoming|when)\b/i.test(message)) return false;
  return /\b(?:events?|programs?|storytime|book club|workshops?|classes|seminars?|lego lab|monster prom|frontiers and folktales|board meeting|summer reading|reading (?:confidence )?lab|homework (?:and study )?studio|tax preparation readiness|3d printing: first design|sign me up|register me|enroll me|my registrations|my sign[- ]?ups)\b/i.test(message)
    && !/\b(?:programming language|computer programs?|program in (?:python|javascript)|school programs? in)\b/i.test(message);
}
function isFeeRequest(message) {
  return /\b(?:my|our|these|the|library)\s+(?:(?:overdue|replacement)\s+)?(?:fees?|fines?|charges?|penalt\w*|balance)\b|\b(?:waiv\w*|disput\w*|pay|clear|settle|resolv\w*|appeal)\b.*\b(?:fees?|fines?|charges?|balance|penalt\w*)\b|\b(?:what|which) (?:fees?|fines?|charges?) do (?:i|we) owe\b|\bhow much do (?:i|we) owe\b/i.test(message)
    && !/\b(?:tax|3[- ]?d|printing)\b/i.test(message);
}
function serviceInterest(message) {
  if (/\b(?:tax|taxes)\b/i.test(message)) return 'tax-ready';
  if (/\b(?:3[- ]?d|maker|STEM)\b/i.test(message)) return 'maker-start';
  if (/\b(?:phonics|lexile|remedial|reading level|struggling reader|dyslex\w*|reading practice)\b/i.test(message)) return 'reading-lab';
  if (/\b(?:homework|study skills|tutoring|math practice)\b/i.test(message)) return 'homework-studio';
  if (/\b(?:spreadsheet|computer|digital skills)\b/i.test(message)) return 'tech-team';
  return null;
}

function createPatronServices({ filePath = path.join(__dirname, 'data', 'patron-services.json'), now = () => new Date() } = {}) {
  let state;
  function save(next) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, filePath); state = next; }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  function load() {
    if (state) return state;
    if (!fs.existsSync(filePath)) save({ version: 1, accounts: Object.fromEntries(['A', 'B', 'C'].map(id => [id, {
      charges: id === 'B' ? [{ id: 'B-F1', label: 'Lost-material replacement', cents: 1200 }, { id: 'B-F2', label: 'Damaged-material charge', cents: 400 }] : [],
      courtesyUsed: false, registrations: [], history: []
    }])) });
    else {
      const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (loaded.version !== 1 || !['A', 'B', 'C'].every(id => {
        const a = loaded.accounts?.[id];
        return a && Array.isArray(a.charges) && a.charges.every(c => typeof c.id === 'string' && typeof c.label === 'string' && Number.isSafeInteger(c.cents) && c.cents >= 0)
          && typeof a.courtesyUsed === 'boolean' && Array.isArray(a.registrations) && a.registrations.every(r => typeof r.eventId === 'string' && typeof r.title === 'string' && typeof r.date === 'string' && typeof r.time === 'string') && Array.isArray(a.history);
      })) throw new Error('Invalid patron services store');
      state = loaded;
    }
    return state;
  }
  const money = cents => `$${(cents / 100).toFixed(2)}`;
  function account(session) {
    if (!['A', 'B', 'C'].includes(session.accountId)) fail('Choose patron A, B, or C first. No sign-in is needed.');
    return load().accounts[session.accountId];
  }
  function events() {
    return upcomingPrograms(now()).map(e => ({ ...e, remaining: e.capacity - Object.values(load().accounts).filter(a => a.registrations.some(r => r.eventId === e.eventId)).length }));
  }
  function summary(session) {
    const a = account(session);
    const balanceCents = a.charges.reduce((sum, c) => sum + c.cents, 0);
    const threshold = knowledge.circulation.newCheckoutBlockAboveCents;
    return { fictional: true, accountId: session.accountId, balanceCents, feePolicy: { waiversAllowed: waiversAllowed(), description: feeOptions(), newCheckoutBlocked: Number.isInteger(threshold) && balanceCents > threshold }, ...structuredClone(a) };
  }
  function prepare(session, action, parameters = {}) {
    session.servicePending = null;
    session.pending = null; // One conversational preview across all demo services.
    const a = account(session);
    let payload;
    if (action === 'register') {
      const event = events().find(e => e.eventId === parameters.eventId);
      if (!event) fail('That session is no longer upcoming. Ask for the current program list.');
      if (a.registrations.some(r => r.eventId === event.eventId)) fail('This patron is already registered for that session.');
      if (session.accountId === 'C' && event.audience === 'Adults') fail('This adult session is not available on child account C.');
      if (event.remaining <= 0) fail('That session is full; choose another date.');
      payload = { eventId: event.eventId, title: event.title, date: event.date, time: event.time };
    } else if (action === 'cancel_registration') {
      const registration = a.registrations.find(r => r.eventId === parameters.eventId);
      if (!registration) fail('There is no matching registration on this account.');
      payload = { ...registration };
    } else if (action === 'waive_fees') {
      const balance = a.charges.reduce((sum, c) => sum + c.cents, 0);
      if (!balance) fail('Your balance is already $0.00. No adjustment is needed.');
      if (!waiversAllowed()) fail(`The full balance of ${money(balance)} remains due. I cannot waive or reduce it. ${feeOptions()} `);
      if (a.courtesyUsed) fail('The one-time courtesy credit has already been used. The remaining balance can be settled with a payment; ');
      payload = { balance, creditCents: Math.min(balance, 1500), remainingCents: Math.max(0, balance - 1500) };
    } else if (action === 'settle_fees') {
      const balance = a.charges.reduce((sum, c) => sum + c.cents, 0);
      if (!balance) fail('Your balance is already $0.00. No payment is needed.');
      payload = { balance, creditCents: balance, remainingCents: 0 };
    } else fail('Unknown demonstration service action.', 400);
    const preview = { fictional: true, action, accountId: session.accountId, ...payload, token: randomUUID(), expiresAt: now().getTime() + 300000 };
    session.servicePending = preview;
    return preview;
  }
  function confirm(session, token) {
    const a = account(session);
    const p = session.servicePending;
    session.servicePending = null;
    if (!p || p.token !== token || p.accountId !== session.accountId || p.expiresAt <= now().getTime()) fail('No current service preview remains. Ask for a fresh preview.');
    if (p.action === 'register') {
      const e = events().find(e => e.eventId === p.eventId);
      if (!e || e.remaining <= 0 || a.registrations.some(r => r.eventId === p.eventId)) fail('Registration state changed; ask for a fresh preview.');
    }
    if (p.action === 'cancel_registration' && !a.registrations.some(r => r.eventId === p.eventId)) fail('The registration has already changed. Ask for a fresh preview.');
    const balance = a.charges.reduce((sum, c) => sum + c.cents, 0);
    if (p.action.endsWith('_fees') && (balance !== p.balance || (p.action === 'waive_fees' && a.courtesyUsed))) fail('The balance changed; ask for a fresh preview.');
    if (p.action === 'waive_fees' && !waiversAllowed()) fail('Waivers are not available under the current policy. The balance was not changed.');
    const next = structuredClone(load()), target = next.accounts[session.accountId];
    if (p.action === 'register') target.registrations.push({ eventId: p.eventId, title: p.title, date: p.date, time: p.time });
    else if (p.action === 'cancel_registration') target.registrations = target.registrations.filter(r => r.eventId !== p.eventId);
    else {
      let credit = p.creditCents;
      for (const charge of target.charges) { const applied = Math.min(credit, charge.cents); charge.cents -= applied; credit -= applied; }
      if (p.action === 'waive_fees') target.courtesyUsed = true;
    }
    const receipt = { id: randomUUID(), action: p.action, timestamp: now().toISOString(), ...(p.action.endsWith('_fees') ? { creditedCents: p.creditCents, remainingCents: p.remainingCents } : { eventId: p.eventId, title: p.title, date: p.date, time: p.time }) };
    target.history.push(receipt);
    save(next);
    return { fictional: true, accountId: session.accountId, ...receipt };
  }
  function previewText(p) {
    const detail = p.action === 'register' ? `Register one place for ${p.title} on ${p.date} at ${p.time} (${offerings.timezone})`
      : p.action === 'cancel_registration' ? `Cancel your place for ${p.title} on ${p.date} at ${p.time}`
      : `${p.action === 'waive_fees' ? 'Apply the one-time courtesy credit' : 'Record a payment'} of ${money(p.creditCents)}; balance ${money(p.balance)} → ${money(p.remainingCents)}`;
    return `Patron ${p.accountId}. ${detail}.\nConfirm with “yes” or say “cancel”. Expires in five minutes. `;
  }
  function resultText(r) {
    return `Patron ${r.accountId}. Server confirmed ${r.action === 'register' ? `one program place: ${r.title}, ${r.date} at ${r.time}` : r.action === 'cancel_registration' ? `cancellation: ${r.title}, ${r.date}` : `a ${money(r.creditedCents)} credit; remaining balance ${money(r.remainingCents)}`}. Receipt ${r.id}. `;
  }
  function chat(session, message) {
    let text = message.trim();
    const pending = session.servicePending;
    const recommended = session.lastProgramRecommendation ? session.programRecommendations || [] : [];
    const named = namedProgram(text);
    const detailsFollowup = session.focusedProgram && /^(?:tell me more|what (?:does it include|happens|should (?:we|i) bring)|how long|does (?:a |the )?caregiver|is it (?:good|suitable)|what about (?:the )?(?:cost|age))[\s\S]*$/i.test(text);
    const detailsProgram = named || (detailsFollowup ? offerings.programs.find(p => p.id === session.focusedProgram) : null);
    session.focusedProgram = null;
    if (detailsProgram && !/\b(?:register|enroll|sign.*up|book|cancel)\b/i.test(text)
      && (detailsFollowup || /\b(?:tell|explain|include\w*|involv\w*|about|bring|how long|what happens|caregiver|cost)\b/i.test(text))) {
      session.pending = null;
      session.servicePending = null;
      session.focusedProgram = detailsProgram.id;
      session.lastProgramRecommendation = false;
      const next = upcomingPrograms(now()).find(e => e.id === detailsProgram.id);
      const activities = detailsProgram.activities?.length ? `\n\nA session includes:\n${detailsProgram.activities.map(a => `- ${a}`).join('\n')}` : '';
      return `${detailsProgram.title}: ${detailsProgram.description}${activities}\n\nIt runs for ${detailsProgram.durationMinutes} minutes and is intended for ${detailsProgram.audience.toLowerCase()}.${detailsProgram.preparation ? ` ${detailsProgram.preparation}` : ''}${next ? ` The next demo session is ${next.date} at ${next.time}, library local time.` : ' There is no dated session in the next two weeks.'}\n\n${detailsProgram.caregiverRequired ? 'You can join in with your child. ' : ''}Would you like to see the upcoming dates?`;
    }
    if (recommended.length && /\b(?:sign|register|enroll|book)\b/i.test(text) && !/\b(?:how|can i)\b/i.test(text)) {
      const ordinal = /\bfirst\b/i.test(text) ? 0 : /\bsecond\b/i.test(text) ? 1 : /\bthird\b/i.test(text) ? 2 : -1;
      const choice = ordinal >= 0 ? recommended[ordinal] : recommended.find(e => text.toLowerCase().includes(e.title.toLowerCase()));
      if (choice && !/\b\d{4}-\d{2}-\d{2}\b/.test(text)) text = `Register me for ${choice.title} on ${choice.date}`;
    }
    const advisoryFollowup = session.lastProgramRecommendation && /^(?:(?:he|she|they) (?:likes?|loves?|enjoys?|is|are)|(?:what|how) about|(?:stories|reading|making|building|games|math)\b)/i.test(text);
    const previousProfile = advisoryFollowup ? session.programProfile : null;
    session.lastProgramRecommendation = false;
    if (!pending && session.suggestedProgram && /^(?:yes(?:,? please)?|show me|registration options)[.!]?$/i.test(text)) {
      const title = session.suggestedProgram;
      session.suggestedProgram = null;
      return chat(session, `What upcoming programs for ${title}?`);
    }
    session.suggestedProgram = null;
    if (/\b(?:no (?:suggestions|programs)|don['’]t (?:suggest|promote|recommend)|stop suggesting)\b/i.test(text)) {
      session.suggestionsDisabled = true;
      if (!serviceInterest(text)) { session.pending = null; return 'I’ll stop suggesting library programs. What would you like help with next?'; }
    }
    if (pending && /^(?:yes(?:,? please)?|confirm|confirm (?:registration|payment|waiver|cancellation))[.!]?$/i.test(text)) return resultText(confirm(session, pending.token));
    session.servicePending = null;
    if (pending && /^(?:no|no thanks|cancel|cancel it)[.!]?$/i.test(text)) return 'the service preview was cancelled; no change was made.';
    if (isFeeRequest(text)) {
      session.pending = null;
      if (/\b(?:policy|policies|do you charge)\b/i.test(text) && !/\b(?:my|our)\b/i.test(text)) return `The library charges no overdue fines. Replacement and damage charges may apply. ${feeOptions()} `;
      const a = summary(session);
      if (/\b(?:waiv\w*|resolv\w*|clear|appeal|disput\w*)\b/i.test(text) && !/\b(?:how|policy|policies|can i|do you)\b/i.test(text)) return previewText(prepare(session, 'waive_fees'));
      if (/\b(?:pay|settle)\b/i.test(text) && !/\b(?:how|policy|policies|can i|do you)\b/i.test(text)) return previewText(prepare(session, 'settle_fees'));
      return `Patron ${session.accountId}: balance ${money(a.balanceCents)}.\n${a.charges.map(c => `- ${c.label}: ${money(c.cents)}`).join('\n') || 'No charges.'}\nNo overdue fines are charged. ${a.balanceCents ? feeOptions() : 'No payment or adjustment is needed.'}`;
    }
    if (session.programAction && /^(?:\d{4}-\d{2}-\d{2}|[a-z-]+@\d{4}-\d{2}-\d{2}|the next one|next)[.!]?$/i.test(text)) {
      const choices = session.programAction;
      session.programAction = null;
      const matches = choices.events.filter(e => /^(?:the next one|next)[.!]?$/i.test(text) || text.includes(e.eventId) || text.includes(e.date));
      if (matches.length === 1 || (/next/i.test(text) && new Set(matches.map(e => e.title)).size === 1)) return previewText(prepare(session, choices.action, { eventId: matches[0].eventId }));
      return 'More than one program matches that date. Please include the program title and date or its event ID.';
    }
    session.programAction = null;
    if (!isProgramRequest(text) && !advisoryFollowup) return null;
    session.pending = null;
    if (/\bmy (?:registrations|sign[- ]?ups|programs|bookings)\b/i.test(text)) {
      const a = summary(session);
      return `Patron ${session.accountId} registrations:\n${a.registrations.map(r => `- ${r.title}: ${r.date} ${r.time}; ${r.eventId}`).join('\n') || 'None yet.'}\n`;
    }
    const wantsAction = /\b(?:sign me up|register me|enroll me|sign up for|register for|enroll in|book (?:me |a |one )?(?:place|spot)|cancel (?:my )?(?:registration|booking|place))\b/i.test(text)
      && !/\b(?:how (?:do|can)|can i|do you|policy|rules)\b/i.test(text);
    if (wantsAction) {
      account(session);
      const cancel = /\bcancel\b/i.test(text);
      let matches = cancel ? account(session).registrations : programMatches(text, now());
      const exactId = text.match(/\b[a-z-]+@\d{4}-\d{2}-\d{2}\b/i)?.[0];
      const date = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
      if (exactId) matches = matches.filter(e => e.eventId === exactId);
      else {
        const named = matches.filter(e => text.toLowerCase().includes(e.title.toLowerCase()));
        if (named.length) matches = named;
        if (date) matches = matches.filter(e => e.date === date);
        // "Next" explicitly chooses the next occurrence of a named program.
        if (/\bnext\b/i.test(text) && new Set(matches.map(e => e.title)).size === 1) matches = matches.slice(0, 1);
      }
      if (matches.length !== 1) {
        session.programAction = { action: cancel ? 'cancel_registration' : 'register', events: matches.slice(0, 6) };
        return `Which session should I use? ${matches.length ? matches.slice(0, 6).map(e => `${e.title} — ${e.date} ${e.time} (${e.eventId})`).join('; ') : 'No matching session is available; ask for upcoming programs.'} Nothing was changed. Use the program name and date or its event ID.`;
      }
      return previewText(prepare(session, cancel ? 'cancel_registration' : 'register', { eventId: matches[0].eventId }));
    }
    const chosen = programMatches(text, now());
    if (childAge(text) !== null || advisoryFollowup) {
      const recommendation = recommendPrograms(text, events().filter(e => chosen.some(c => c.eventId === e.eventId)), previousProfile);
      if (recommendation) {
        session.programProfile = recommendation.profile;
        session.programRecommendations = recommendation.options.map(e => ({ title: e.title, date: e.date }));
        session.lastProgramRecommendation = true;
        return recommendation.reply;
      }
    }
    const legacy = require('./knowledge/library-facts').EVENTS_CONTEXT;
    const unmodeled = legacy.filter(line => text.toLowerCase().includes(line.split(':')[0].toLowerCase()) && !offerings.programs.some(p => line.startsWith(p.title + ':')));
    if (unmodeled.length) return `${unmodeled.join('\n')}\nThese programs recur regularly; registration dates are not yet available.`;
    const available = new Map(events().map(e => [e.eventId, e]));
    return `${offerings.notice}\nUpcoming sessions (${offerings.timezone}):\n${chosen.slice(0, 8).map(e => `- ${e.title}: ${e.date}, ${e.time}; ${e.audience}; ${available.get(e.eventId).remaining} places. ${e.description} ID: ${e.eventId}`).join('\n') || 'No matching sessions in the next 14 days.'}\nSelect patron A, B, or C, then ask “register me for [program] on [date]”. Each registration is one place; caregiver rules apply.`;
  }
  function suggestion(session, message, history = []) {
    if (/\b(?:suicid\w*|kill myself|emergency|immediate danger)\b/i.test(message)) return '';
    if (/\b(?:no (?:suggestions|programs)|don['’]t (?:suggest|promote|recommend)|stop suggesting)\b/i.test(message)) { session.suggestionsDisabled = true; return ''; }
    if (/\b(?:suggest programs again|turn on suggestions)\b/i.test(message)) session.suggestionsDisabled = false;
    const interest = serviceInterest(message);
    if (session.suggestionsDisabled || !interest || history.slice(-4).some(h => h.role === 'assistant' && /You might also try the (?:fictional )?/.test(h.content))) return '';
    const event = upcomingPrograms(now()).find(e => e.id === interest);
    if (event) session.suggestedProgram = event.title;
    return event ? `\n\nYou might also try the ${event.title} (${event.date}, ${event.time}). ${event.description} Want to see registration options?` : '';
  }
  return { chat, summary, prepare, confirm, events, suggestion };
}

module.exports = { createPatronServices, upcomingPrograms, isProgramRequest, isFeeRequest, serviceInterest };
