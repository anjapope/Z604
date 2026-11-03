'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { CATALOG_ENTRIES, CATALOG_SEED } = require('./catalog-service');
const { workKey } = require('./readers-advisory');
const { KNOWLEDGE } = require('./institutional-service');
const { circulationIntent, accountFollowup } = require('./circulation-intent');

const POLICIES = Object.freeze({
  fictional: true, timezone: KNOWLEDGE.timezone,
  loanDays: Object.freeze(KNOWLEDGE.circulation.loanDays),
  renewalLimit: KNOWLEDGE.circulation.renewalLimit, holdLimit: KNOWLEDGE.circulation.holdLimit, confirmationMinutes: 5,
  renewalRule: KNOWLEDGE.circulation.renewalRule,
  holdRule: KNOWLEDGE.circulation.holdRule,
  restrictions: 'Only the three fictional accounts are supported. No real sign-in, checkout, return, payment, fines, automatic fulfillment, or real library integration. Confirmations expire after five minutes and are cancelled by an account switch, another chat topic, or cancellation.'
});

const PATRONS = Object.freeze([
  { id: 'A', name: 'Aster Page (fictional)', audience: 'Adult', situation: 'Ordinary loans eligible for renewal' },
  { id: 'B', name: 'Bram Bookmark (fictional)', audience: 'Adult', situation: 'Overdue loan, hold block, renewal limit, existing hold' },
  { id: 'C', name: 'Clover Story (fictional child account)', audience: 'Children', situation: 'Child-oriented loans and holds' }
]);

const works = CATALOG_ENTRIES.slice(0, CATALOG_SEED.length);
const canonical = new Map(works.map(entry => [workKey(entry), entry]));
const records = new Map(CATALOG_ENTRIES.map(entry => [entry.recordId, canonical.get(workKey(entry))]));
function dateAt(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: POLICIES.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function addDays(date, days) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function initialState(today) {
  const book = title => works.find(entry => entry.title === title).recordId;
  const loan = (id, title, days, renewals = 0) => ({ id, recordId: book(title), dueDate: addDays(today, days), renewals });
  return {
    schemaVersion: 1, createdOn: today,
    accounts: {
      A: { loans: [loan('A-1', 'The Midnight Library', 7), loan('A-2', 'Atomic Habits', 10), loan('A-3', 'Project Hail Mary', 12)], holds: [{ id: 'H-A-1', recordId: book('The Great Gatsby'), placedOn: today }] },
      B: { loans: [loan('B-1', 'Educated', -5), loan('B-2', 'The Great Gatsby', 4), loan('B-3', '1984', 6, 2)], holds: [{ id: 'H-B-1', recordId: book('The Hobbit'), placedOn: today }] },
      C: { loans: [loan('C-1', 'Matilda', 8), loan('C-2', 'The Wild Robot', 11)], holds: [] }
    }, transactions: [], receipts: {}
  };
}

function createCirculationService({ filePath = path.join(__dirname, 'data', 'circulation.json'), now = () => new Date() } = {}) {
  let state;
  const sessions = new Map();
  function save(next) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, filePath);
      state = next;
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  function getState() {
    if (state) return state;
    if (!fs.existsSync(filePath)) save(initialState(dateAt(now())));
    else {
      const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (loaded.schemaVersion !== 1 || !loaded.accounts || !Array.isArray(loaded.transactions) || !loaded.receipts ||
        !PATRONS.every(p => Array.isArray(loaded.accounts[p.id]?.loans) && Array.isArray(loaded.accounts[p.id]?.holds))) {
        throw new Error('Invalid circulation store; restore a valid classroom state file before continuing.');
      }
      state = loaded;
    }
    return state;
  }
  function session(req, res) {
    const headerToken = req.headers['x-demo-session'];
    const token = headerToken !== undefined ? (/^[a-f0-9]{64}$/.test(headerToken) ? headerToken : null)
      : /(?:^|;\s*)pericles_demo=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    const time = now().getTime();
    for (const [key, value] of sessions) if (value.expires <= time) sessions.delete(key);
    let current = token && sessions.get(token);
    if (!current) {
      // Bound anonymous in-memory sessions; expire the oldest if a classroom browser floods requests.
      if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value);
      const key = randomBytes(32).toString('hex');
      current = { id: key, accountId: null, pending: null, expires: time + 7200000 };
      sessions.set(key, current);
      res.setHeader('Set-Cookie', `pericles_demo=${key}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${req.secure ? '; Secure' : ''}`);
    }
    res.setHeader('X-Demo-Session', current.id);
    return current;
  }
  function selected(session) {
    if (!PATRONS.some(p => p.id === session.accountId)) fail('Select fictional patron A, B, or C first. No sign-in is required.', 409);
    return getState().accounts[session.accountId];
  }
  function select(session, id) {
    if (id === '') {
      session.pending = null;
      session.accountId = null;
      session.lastWasCirculation = false;
      return { fictional: true, patron: null };
    }
    if (!PATRONS.some(p => p.id === id)) fail('Unknown fictional account. Select A, B, or C.', 404);
    session.pending = null;
    session.accountId = id;
    return summary(session);
  }
  function renewal(accountId, loan, source = getState()) {
    const entry = records.get(loan.recordId);
    const reasons = [];
    if (loan.renewals >= POLICIES.renewalLimit) reasons.push(`renewal limit of ${POLICIES.renewalLimit} reached`);
    if (Object.entries(source.accounts).some(([id, a]) => id !== accountId && a.holds.some(h => h.recordId === entry.recordId))) reasons.push('another fictional patron has an active hold on this work');
    return { ...loan, title: entry.title, format: entry.format, overdue: loan.dueDate < dateAt(now()), renewalLimit: POLICIES.renewalLimit,
      eligible: reasons.length === 0, reasons, newDueDate: addDays(loan.dueDate > dateAt(now()) ? loan.dueDate : dateAt(now()), POLICIES.loanDays[entry.format]) };
  }
  function summary(session) {
    const account = selected(session);
    return { fictional: true, patron: PATRONS.find(p => p.id === session.accountId), today: dateAt(now()), policies: POLICIES,
      loans: account.loans.map(loan => renewal(session.accountId, loan)),
      holds: account.holds.map(hold => ({ ...hold, title: records.get(hold.recordId).title, status: 'Simulated request; no real availability confirmed' })),
      transactions: getState().transactions.filter(t => t.accountId === session.accountId).map(t => ({ ...t })) };
  }
  function holdReasons(accountId, entry, source = getState()) {
    const account = source.accounts[accountId];
    const reasons = [];
    if (account.holds.some(h => h.recordId === entry.recordId)) reasons.push('this account already has an active hold on this work');
    if (account.loans.some(l => l.recordId === entry.recordId)) reasons.push('this account already has this work checked out');
    if (account.holds.length >= POLICIES.holdLimit) reasons.push(`active hold limit of ${POLICIES.holdLimit} reached`);
    if (accountId === 'C' && !/Children|All Ages/.test(entry.audience)) reasons.push('this fictional child account supports Children or All Ages works only');
    return reasons;
  }
  function prepare(session, action, parameters = {}) {
    session.pending = null;
    const account = selected(session);
    if (!['renew', 'hold'].includes(action)) fail('Only fictional renew and hold actions are supported.');
    let eligible = [], blocked = [];
    if (action === 'renew') {
      const ids = parameters.loanIds;
      if (ids !== 'all' && (!Array.isArray(ids) || !ids.length || ids.length > 20 || ids.some(id => typeof id !== 'string'))) fail('Provide loanIds as "all" or a nonempty array of this account’s loan IDs.');
      if (ids !== 'all' && ids.some(id => !account.loans.some(loan => loan.id === id))) fail('Unknown loan for the selected fictional account.', 404);
      for (const loan of account.loans.filter(l => ids === 'all' || ids.includes(l.id))) {
        const result = renewal(session.accountId, loan);
        (result.eligible ? eligible : blocked).push(result);
      }
    } else {
      if (typeof parameters.recordId !== 'string' || !records.has(parameters.recordId)) fail('Unknown catalog record.', 404);
      const entry = records.get(parameters.recordId);
      const item = { recordId: entry.recordId, title: entry.title, reasons: holdReasons(session.accountId, entry) };
      (item.reasons.length ? blocked : eligible).push(item);
    }
    const preview = { fictional: true, action, accountId: session.accountId, eligible, blocked };
    if (eligible.length) {
      session.pending = { ...preview, token: randomUUID(), expiresAt: now().getTime() + POLICIES.confirmationMinutes * 60000 };
      preview.confirmationToken = session.pending.token;
      preview.expiresAt = new Date(session.pending.expiresAt).toISOString();
    }
    return preview;
  }
  function confirm(session, token) {
    selected(session);
    if (typeof token !== 'string' || token.length > 100) fail('A valid pending confirmation token is required.');
    const receipt = getState().receipts[token];
    if (receipt && receipt.sessionId === session.id && receipt.accountId === session.accountId) return { ...receipt.result, replayed: true };
    const pending = session.pending;
    session.pending = null; // A confirmation is consumed once, including failed revalidation.
    if (!pending || pending.token !== token || pending.accountId !== session.accountId || pending.expiresAt <= now().getTime()) fail('There is no current confirmation for this account, or it has expired. Request the action again.', 409);
    const next = structuredClone(getState());
    const account = next.accounts[session.accountId];
    const completed = [];
    for (const item of pending.eligible) {
      if (pending.action === 'renew') {
        const loan = account.loans.find(l => l.id === item.id);
        if (!loan || !renewal(session.accountId, loan, next).eligible || loan.dueDate !== item.dueDate || loan.renewals !== item.renewals || renewal(session.accountId, loan, next).newDueDate !== item.newDueDate) fail('Circulation state changed since the preview. Request a fresh preview before confirming.', 409);
        loan.dueDate = item.newDueDate;
        loan.renewals += 1;
        completed.push({ loanId: loan.id, recordId: loan.recordId, title: item.title, dueDate: loan.dueDate, renewals: loan.renewals });
      } else {
        const entry = records.get(item.recordId);
        const reasons = holdReasons(session.accountId, entry, next);
        if (reasons.length) fail(`Hold rejected: ${reasons.join('; ')}.`, 409);
        const hold = { id: randomUUID(), recordId: item.recordId, placedOn: dateAt(now()) };
        account.holds.push(hold);
        completed.push({ ...hold, title: item.title });
      }
    }
    const result = { fictional: true, transactionId: randomUUID(), accountId: session.accountId, action: pending.action, completed, blocked: pending.blocked, replayed: false };
    next.transactions.push({ ...result, timestamp: now().toISOString() });
    next.receipts[token] = { sessionId: session.id, accountId: session.accountId, result };
    save(next); // Publish in-memory state only after the atomic filesystem replacement succeeds.
    return result;
  }
  function policyText() {
    return `Fictional classroom circulation policies: print and large print loans: 21 days; ebooks and audiobooks: 14 days; DVD and Blu-ray: 7 days. Renewal limit: ${POLICIES.renewalLimit}. ${POLICIES.renewalRule} ${POLICIES.holdRule} Dates use ${POLICIES.timezone}. ${POLICIES.restrictions} These rules do not establish real SPL policies.`;
  }
  function previewText(preview) {
    const eligible = preview.eligible.map(item => preview.action === 'renew' ? `${item.title} (${item.id}): due ${item.dueDate} → ${item.newDueDate}; renewals ${item.renewals} → ${item.renewals + 1}/${POLICIES.renewalLimit}` : `${item.title} (${item.recordId}): one simulated work-level hold`);
    const blocked = preview.blocked.map(item => `${item.title}: ${item.reasons.join('; ')}`);
    return `Fictional demonstration — Patron ${preview.accountId}.\n${eligible.length ? `Eligible for ${preview.action}:\n- ${eligible.join('\n- ')}` : 'No eligible items; nothing will be changed.'}${blocked.length ? `\nBlocked (will remain unchanged):\n- ${blocked.join('\n- ')}` : ''}${eligible.length ? `\nConfirm ${preview.action === 'renew' ? 'renewal of only these eligible loans' : 'placement of this hold'}? Say “yes” or “cancel”. This preview expires in ${POLICIES.confirmationMinutes} minutes.` : ''}`;
  }
  function resultText(result) {
    return `Fictional demonstration — Patron ${result.accountId}. ${result.replayed ? 'This transaction was already completed; no duplicate change was made.' : `Server confirmed ${result.action === 'renew' ? 'renewal' : 'hold placement'}.`}\n${result.completed.map(item => `- ${item.title}: ${result.action === 'renew' ? `due ${item.dueDate}; renewals ${item.renewals}/${POLICIES.renewalLimit}` : `hold ${item.id} placed ${item.placedOn}; simulated request only`}`).join('\n')}${result.blocked.length ? `\nUnchanged: ${result.blocked.map(item => `${item.title} (${item.reasons.join('; ')})`).join('; ')}.` : ''}\nThe account page now reads this same server state. No real library transaction occurred.`;
  }
  function chat(session, message, intent) {
    const text = message.trim();
    const selection = text.match(/^(?:select|switch to|use|open)\s+(?:fictional\s+)?patron\s+([ABC])[.!]?$/i);
    if (selection) {
      const account = select(session, selection[1].toUpperCase());
      return `Fictional demonstration: selected Patron ${account.patron.id}, ${account.patron.name}. No sign-in is required. Ask about checkouts, due dates, renewals, or holds.`;
    }
    const yes = /^(?:yes(?:,?\s+(?:please|renew (?:the )?eligible ones|renew them|place (?:the |that )?hold))?|confirm|confirm (?:renewal|hold))[.!]?$/i.test(text);
    if (yes) {
      if (!session.pending && !['account', 'general'].includes(intent) && !session.lastWasCirculation) return null;
      if (!session.pending) return 'There is no pending fictional transaction to confirm. Select an account and request a renewal or hold first.';
      try { return resultText(confirm(session, session.pending.token)); } catch (error) { if (error.status) return `Fictional demonstration: ${error.message}`; throw error; }
    }
    const hadPending = Boolean(session.pending);
    session.pending = null;
    if ((hadPending || intent === 'account' || session.lastWasCirculation) && /^(?:no|no thanks|cancel|cancel (?:it|that|the (?:renewal|hold)))[.!]?$/i.test(text)) return `Fictional demonstration: ${hadPending ? 'the pending action was cancelled; no changes were made.' : 'there is no pending action; no changes were made.'}`;
    const request = circulationIntent(text) || (intent === 'account' ? accountFollowup(text) : null);
    if (intent !== 'account' && !/\b(?:my books|my loans|patron [ABC]|transaction history)\b/i.test(text)) return null;
    if (!session.accountId) {
      if (request?.kind === 'information' && ['count', 'loans', 'due', 'holds'].includes(request.question)) return 'Please select a fictional patron in My Account first so I can check that for you.';
      return 'I cannot access real accounts or renew real loans. Choose a fictional demonstration patron A, B, or C in the account selector first. No sign-in is required; never share real card numbers, PINs, or passwords.';
    }
    if (/\b(?:pin|password|card number|pay|payment|fines?|fees?|sign[- ]?in)\b/i.test(text)) return 'This fictional demonstration accepts no credentials or payments and assesses no fines. Never share real card numbers, PINs, or passwords.';
    const account = summary(session);
    try {
      if (request?.operation === 'cancel_hold') return 'Cancelling an existing hold is not supported in this demonstration. No hold was changed.';
      if (request?.operation === 'renew') {
        let ids;
        if (/\b(?:all|everything|my books|my loans)\b/i.test(text)) ids = 'all';
        else {
          const matching = account.loans.filter(l => text.toLowerCase().includes(l.title.toLowerCase()) || text.toUpperCase().includes(l.id));
          if (matching.length !== 1) return `Fictional Patron ${session.accountId}: which loan should I renew? ${account.loans.map(l => `${l.title} (${l.id})`).join('; ')}. You can also ask to renew everything.`;
          ids = [matching[0].id];
        }
        return previewText(prepare(session, 'renew', { loanIds: ids }));
      }
      if (request?.operation === 'hold') {
        const id = text.match(/\bCAT-\d+\b/i)?.[0]?.toUpperCase();
        const title = text.match(/\bhold\s+(?:on|for)\s+(.+?)[.!?]*$/i)?.[1]?.replace(/^[“"']|[”"']$/g, '').trim();
        const entry = id ? records.get(id) : title ? works.find(e => e.title.toLowerCase() === title.toLowerCase()) : null;
        if (!entry) return 'I cannot identify an exact demonstration-catalog work for that hold. Give the title or a CAT record ID; nothing was changed.';
        return previewText(prepare(session, 'hold', { recordId: entry.recordId }));
      }
      if (request?.question === 'count') {
        const total = account.loans.length;
        if (!request.books) return `Fictional Patron ${session.accountId}: You have ${total} ${total === 1 ? 'loan' : 'loans'} checked out.`;
        const books = account.loans.filter(loan => ['Print Book', 'Large Print', 'Ebook'].includes(loan.format)).length;
        const audio = account.loans.filter(loan => loan.format === 'Audiobook').length;
        return `Fictional Patron ${session.accountId}: You have ${books} ${books === 1 ? 'book' : 'books'} checked out (print, large print, or ebooks), and ${total} ${total === 1 ? 'loan' : 'loans'} in total.${audio ? ` That includes ${audio} ${audio === 1 ? 'audiobook' : 'audiobooks'}, counted separately from books.` : ''}`;
      }
      if (request?.question === 'eligibility' || /\b(?:why|renew|eligib|blocked)\w*\b/i.test(text)) return `Fictional Patron ${session.accountId} renewal eligibility:\n${account.loans.map(l => `- ${l.title}: ${l.eligible ? `eligible; renewals ${l.renewals}/${l.renewalLimit}` : l.reasons.join('; ')}`).join('\n')}\nNo changes were made.`;
      if (/\b(?:transaction|history)\b/i.test(text)) return `Fictional Patron ${session.accountId} transaction history:\n${account.transactions.length ? account.transactions.map(t => `- ${t.timestamp}: ${t.action} — ${t.completed.map(i => i.title).join('; ')}`).join('\n') : 'No completed transactions.'}`;
      if (request?.question === 'holds' || /\bholds?\b/i.test(text)) return `Fictional Patron ${session.accountId}: ${account.holds.length ? `You have ${account.holds.length} active ${account.holds.length === 1 ? 'hold' : 'holds'}: ${account.holds.map(h => h.title).join('; ')}.` : 'You have no active holds.'}`;
      if (request?.question === 'loans') return `Fictional Patron ${session.accountId}: ${account.loans.length ? `You have ${account.loans.length} loans checked out:\n${account.loans.map(loan => `- ${loan.title} (${loan.format})`).join('\n')}` : 'You have no loans checked out.'}`;
      if (request?.question === 'due') return `Fictional Patron ${session.accountId}:\n${account.loans.map(loan => `- ${loan.title}: due ${loan.dueDate}${loan.overdue ? ' (overdue)' : ''}${loan.eligible ? '' : `; renewal blocked: ${loan.reasons.join('; ')}`}`).join('\n') || 'You have no loans checked out.'}`;
      return `Fictional Patron ${session.accountId}: You have ${account.loans.length} current loans and ${account.holds.length} active ${account.holds.length === 1 ? 'hold' : 'holds'}. Would you like the titles or due dates?`;
    } catch (error) { if (error.status) return `Fictional demonstration: ${error.message}`; throw error; }
  }
  return { session, select, summary, prepare, confirm, chat, policyText, patrons: PATRONS, policies: POLICIES };
}

module.exports = { createCirculationService, POLICIES, PATRONS, dateAt, addDays };
