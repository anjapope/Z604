'use strict';

(function demoServiceViews() {
  const accountPanel = document.getElementById('demoServicesAccount');
  const programsPanel = document.getElementById('demoPrograms');
  function element(tag, text, parent) {
    const node = document.createElement(tag);
    node.textContent = text;
    parent.appendChild(node);
    return node;
  }
  async function read(route) {
    const response = await (window.PericlesApi?.fetch || fetch)(route, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Demonstration services are unavailable.');
    return body;
  }
  let generation = 0;
  async function refreshAccount() {
    if (!accountPanel) return;
    const current = ++generation;
    try {
      const a = await read('/api/services/account');
      if (current !== generation) return;
      accountPanel.replaceChildren();
      element('h2', 'Fictional fees and program registrations', accountPanel);
      element('p', `Patron ${a.accountId} — simulated balance $${(a.balanceCents / 100).toFixed(2)}. No overdue fines or real payments.`, accountPanel);
      if (a.feePolicy?.newCheckoutBlocked) element('p', 'New checkouts are blocked until the full balance is settled. Unused category capacity does not override this block. Renewals, holds, and program access retain their separate rules.', accountPanel);
      const fees = element('ul', '', accountPanel);
      for (const charge of a.charges) element('li', `${charge.label}: $${(charge.cents / 100).toFixed(2)}`, fees);
      if (!a.charges.length) element('li', 'No charges.', fees);
      element('p', `${a.feePolicy?.description || 'Ask Pericles about the current fee settlement policy.'} Never enter real payment information.`, accountPanel);
      element('h3', 'Registered demonstration sessions', accountPanel);
      const registrations = element('ul', '', accountPanel);
      for (const r of a.registrations) element('li', `${r.title}: ${r.date} at ${r.time} (America/Indiana/Indianapolis). ID: ${r.eventId}`, registrations);
      if (!a.registrations.length) element('li', 'No registrations yet.', registrations);
      element('p', 'Ask Pericles to register or cancel a place by program title and date. Youth programs may require a caregiver; each registration reserves one simulated place.', accountPanel);
      element('h3', 'Service receipts', accountPanel);
      const receipts = element('ul', '', accountPanel);
      for (const r of a.history.slice(-10).reverse()) element('li', `${r.timestamp}: ${r.action.replace(/_/g, ' ')} — ${r.title || `$${(r.creditedCents / 100).toFixed(2)} credit; $${(r.remainingCents / 100).toFixed(2)} remaining`}. Receipt ${r.id}`, receipts);
      if (!a.history.length) element('li', 'No service transactions yet.', receipts);
    } catch (error) {
      if (current !== generation) return;
      accountPanel.replaceChildren();
      element('p', error.message, accountPanel);
    }
  }
  async function refreshPrograms() {
    if (!programsPanel) return;
    try {
      const { programs } = await read('/api/services/programs');
      programsPanel.replaceChildren();
      element('h2', 'Upcoming demonstration sessions', programsPanel);
      element('p', 'Next sessions in the fictional two-week schedule (America/Indiana/Indianapolis). Pericles can show more dates and register one simulated place. These sessions supplement the recurring program descriptions below.', programsPanel);
      const list = element('ul', '', programsPanel);
      list.className = 'demo-program-grid';
      const seen = new Set();
      for (const p of programs) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const row = element('li', '', list);
        element('strong', `${p.title} — ${p.date} at ${p.time}`, row);
        element('p', `${p.audience}. ${p.remaining} places. ${p.description}`, row);
        element('p', `Ask Pericles: “Register me for ${p.title} on ${p.date}.”`, row);
      }
      const link = element('a', 'Ask Pericles to register', programsPanel);
      link.href = 'index.html';
    } catch (error) { programsPanel.replaceChildren(); element('p', error.message, programsPanel); }
  }
  window.addEventListener('fictional-account-updated', refreshAccount);
  window.addEventListener('focus', () => { refreshAccount(); refreshPrograms(); });
  if (accountPanel || programsPanel) setInterval(() => { if (!document.hidden) { refreshAccount(); refreshPrograms(); } }, 5000);
  refreshAccount();
  refreshPrograms();
})();
