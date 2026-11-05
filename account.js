'use strict';

(function fictionalAccountInterface() {
  const selector = document.getElementById('demoAccount');
  if (!selector) return;
  const details = document.getElementById('demoAccountDetails');
  const status = document.getElementById('demoAccountStatus');
  const transactionStatus = document.getElementById('demoTransactionStatus');
  const confirmation = document.getElementById('demoConfirmation');
  const actions = document.getElementById('demoAccountActions');
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('pericles-fictional-accounts') : null;
  let token = null;
  let refreshing = 0;
  let expiryTimer;
  let actionBusy = false;
  async function request(url, body) {
    const response = await (window.PericlesApi?.fetch || fetch)(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) { const error = new Error(payload.error || 'Fictional circulation is unavailable.'); error.status = response.status; throw error; }
    return payload;
  }
  function element(tag, text, parent) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }
  function clearPreview() {
    token = null;
    clearTimeout(expiryTimer);
    if (confirmation) confirmation.hidden = true;
  }
  function render(account) {
    selector.value = account.patron.id;
    status.textContent = `Selected fictional Patron ${account.patron.id}: ${account.patron.name}. Shared classroom state; no real account is connected.`;
    if (!details) return;
    details.replaceChildren();
    element('h2', `Fictional Patron ${account.patron.id} — ${account.patron.name}`, details);
    element('p', `As of ${account.today}. Dates use ${account.policies.timezone}.`, details);
    element('h3', 'Current checkouts and renewal eligibility', details);
    const loans = element('ul', '', details);
    for (const loan of account.loans) element('li', `${loan.title} (${loan.id}) — ${loan.format}; due ${loan.dueDate}${loan.overdue ? ' (overdue)' : ''}; renewals ${loan.renewals}/${loan.renewalLimit}; ${loan.eligible ? 'eligible for renewal' : `blocked: ${loan.reasons.join('; ')}`}`, loans);
    element('h3', 'Existing fictional holds', details);
    const holds = element('ul', '', details);
    if (!account.holds.length) element('li', 'No active holds.', holds);
    for (const hold of account.holds) element('li', `${hold.title} — placed ${hold.placedOn}. ${hold.status}`, holds);
    element('h3', 'Completed fictional transactions', details);
    const history = element('ul', '', details);
    if (!account.transactions.length) element('li', 'No completed transactions.', history);
    for (const transaction of account.transactions.slice().reverse()) element('li', `${transaction.timestamp} — ${transaction.action}: ${transaction.completed.map(item => `${item.title}${item.dueDate ? `; due ${item.dueDate}; renewals ${item.renewals}` : `; hold placed ${item.placedOn}`}`).join(' | ')}`, history);
    element('h3', 'Fictional circulation policies', details);
    element('p', `Print and large print: 21 days; ebooks and audiobooks: 14 days; DVD and Blu-ray: 7 days. ${account.policies.renewalRule} ${account.policies.holdRule} ${account.policies.restrictions}`, details);
    actions.hidden = false;
    if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event('fictional-account-updated'));
  }
  async function refresh() {
    const generation = ++refreshing;
    try {
      const account = await request('/api/circulation/account');
      if (generation === refreshing) render(account);
    } catch (error) {
      if (generation !== refreshing) return;
      status.textContent = error.message;
      if (error.status === 409) selector.value = '';
      if (details) details.replaceChildren();
      if (actions) actions.hidden = true;
      clearPreview();
      if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event('fictional-account-updated'));
    }
  }
  function changed() {
    clearPreview();
    channel?.postMessage('changed');
    refresh();
  }
  async function run(action) {
    if (actionBusy) return;
    actionBusy = true;
    const buttons = document.querySelectorAll('#demoAccountActions button, #demoConfirmation button');
    buttons.forEach(button => { button.disabled = true; });
    try { await action(); }
    catch (error) { clearPreview(); if (transactionStatus) transactionStatus.textContent = error.message; }
    finally { actionBusy = false; buttons.forEach(button => { button.disabled = false; }); }
  }
  async function preview(body) {
    clearPreview();
    const result = await request('/api/circulation/preview', body);
    const lines = [`Fictional Patron ${result.accountId}; action: ${result.action}.`, ...result.eligible.map(item => `${item.title}: ${result.action === 'renew' ? `due ${item.dueDate} → ${item.newDueDate}; renewals ${item.renewals} → ${item.renewals + 1}` : 'eligible for one simulated hold'}`), ...result.blocked.map(item => `Blocked; unchanged: ${item.title} — ${item.reasons.join('; ')}`)];
    if (!result.confirmationToken) { transactionStatus.textContent = `${lines.join('\n')} No eligible items; nothing changed.`; return; }
    token = result.confirmationToken;
    document.getElementById('demoPreviewText').textContent = `${lines.join('\n')}\nConfirm only the eligible items? Expires ${result.expiresAt}.`;
    confirmation.hidden = false;
    expiryTimer = setTimeout(() => { clearPreview(); transactionStatus.textContent = 'Fictional confirmation expired. Request a fresh preview.'; }, Math.max(0, new Date(result.expiresAt) - Date.now()));
  }
  selector.addEventListener('change', () => run(async () => {
    clearPreview();
    if (!selector.value) { await request('/api/circulation/selection', { accountId: '' }); changed(); return; }
    render(await request('/api/circulation/selection', { accountId: selector.value }));
    channel?.postMessage('changed');
  }));
  document.getElementById('demoRenewAll')?.addEventListener('click', () => run(() => preview({ action: 'renew', loanIds: 'all' })));
  document.getElementById('demoConfirm')?.addEventListener('click', () => run(async () => {
    if (!token) return;
    const confirmationToken = token;
    clearPreview();
    const result = await request('/api/circulation/confirm', { confirmationToken });
    transactionStatus.textContent = `Fictional server-confirmed ${result.action}: ${result.completed.map(item => item.title).join('; ')}. ${result.blocked.length} blocked item(s) unchanged. No real transaction occurred.`;
    changed();
  }));
  document.getElementById('demoCancel')?.addEventListener('click', () => run(async () => {
    clearPreview();
    await request('/api/circulation/cancel', {});
    transactionStatus.textContent = 'Fictional action cancelled; nothing changed.';
  }));
  document.getElementById('demoFindHold')?.addEventListener('click', () => run(async () => {
    clearPreview();
    await request('/api/circulation/cancel', {});
    const query = document.getElementById('demoHoldTitle').value.trim();
    const results = document.getElementById('demoHoldResults');
    results.replaceChildren();
    if (!query) { transactionStatus.textContent = 'Enter a catalog title.'; return; }
    const payload = await request(`/api/catalog/search?q=${encodeURIComponent(query)}&limit=50`);
    const seen = new Set();
    for (const record of payload.results) {
      const title = record.title.replace(/ \(Copy \d+\)$/i, '');
      const key = `${title}|${record.author}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const button = element('button', `Preview hold: ${title} — ${record.author}`, results);
      button.type = 'button';
      button.addEventListener('click', () => run(() => preview({ action: 'hold', recordId: record.recordId })));
    }
    if (!seen.size) element('p', 'No matching catalog records.', results);
  }));
  channel?.addEventListener('message', () => { clearPreview(); refresh(); });
  window.addEventListener('focus', refresh);
  // Poll visible summaries so transactions from another classroom session appear too.
  if (details) setInterval(() => { if (!document.hidden) refresh(); }, 5000);
  window.FictionalAccounts = { refresh, changed, clearPreview };
  request('/api/circulation/patrons').then(payload => {
    for (const patron of payload.patrons) { const option = element('option', `Patron ${patron.id}: ${patron.name} — ${patron.situation}`, selector); option.value = patron.id; }
    refresh();
  }).catch(error => { status.textContent = error.message; });
})();
