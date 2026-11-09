'use strict';
function shift(today, days) { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
function applyPatronProfiles(state, today, works) {
  if (state.patronProfilesVersion === 1) return false;
  state.accounts.A.violations = [
    [-420,'Overdue return','Three books returned 19 days late.','Returned; reminder issued.'],
    [-390,'Noise complaint','Repeated loud phone conversations in the quiet reading room.','Verbal warning recorded.'],
    [-350,'Food near archival materials','Open food brought to a Special Collections research table.','Food removed; handling rules reviewed.'],
    [-310,'Equipment misuse','Public computer session continued after the allotted session ended.','Session ended; computer-use rules reviewed.'],
    [-275,'Damaged material','Library book returned with liquid damage.','Replacement charge settled; case closed.'],
    [-240,'Disruptive conduct','Argument with another patron over use of a shared table.','Staff intervention; conduct warning recorded.'],
    [-200,'Overdue return','Two DVDs returned 12 days late.','Returned; reminder issued.'],
    [-165,'Unauthorized room use','Meeting room used beyond the reserved period.','Room vacated; booking rules reviewed.'],
    [-130,'Material marking','Pencil annotations found in a returned book.','Markings removed; warning recorded.'],
    [-95,'Noise complaint','Speakerphone used in the computer area after a quiet-use reminder.','Written conduct reminder issued.'],
    [-60,'Equipment misuse','Attempted to bypass the public printer queue.','Printer procedure reviewed.'],
    [-21,'Disruptive conduct','Raised voice at the circulation desk during a loan-policy dispute.','Written warning; no current suspension.']
  ].map(([days,type,description,outcome],i)=>({id:`A-V${i+1}`,date:shift(today,days),type,description,outcome}));
  state.accounts.B.recentSearches = [
    {date:shift(today,-6),query:'veterans benefits and VA enrollment'},
    {date:shift(today,-3),query:'local veterans services and VA clinic'},
    {date:shift(today,-1),query:'military conflict history and veterans support'}
  ];
  const titles = ['For Whom the Bell Tolls','The Guns of August','The Body Keeps the Score','Ken Burns: The Vietnam War'];
  for (const [i,title] of titles.entries()) {
    const record = works.find(w=>w.title===title);
    if (!record) throw new Error(`Missing profile catalog title: ${title}`);
    if (!state.accounts.B.loans.some(l=>l.recordId===record.recordId)) state.accounts.B.loans.push({id:`B-${i+4}`,recordId:record.recordId,dueDate:shift(today,record.format==='DVD'?7:14),renewals:0});
  }
  state.patronProfilesVersion=1;
  return true;
}
function patronProfileReply(message, account) {
  if (account.patron.id==='A' && /\b(?:violations?|conduct|disciplinary|infractions?|incident history)\b/i.test(message)) return {reply:`Stephen Rojack’s recorded library violations:\n${account.violations.map(v=>`- ${v.date}: ${v.type} — ${v.description} ${v.outcome}`).join('\n')}\nThese records do not create any additional borrowing restriction. Current eligibility follows the account’s actual policies and balance.`,sources:[]};
  if (account.patron.id==='B' && /\b(?:veterans?|VA clinic|my recent searches|my search history|my account|account status)\b/i.test(message)) {
    const relevant=account.loans.filter(l=>['For Whom the Bell Tolls','The Guns of August','The Body Keeps the Score','Ken Burns: The Vietnam War'].includes(l.title));
    return {reply:`Robert, your recent account searches include ${account.recentSearches.map(s=>`“${s.query}” (${s.date})`).join('; ')}. If those resources are still useful, I can help you find a starting point with the Stapleton VA Outpatient Clinic. Its enrollment and patient-services desk can explain eligibility, enrollment, primary care, and referrals. Would you like help preparing questions for that desk? I have not contacted the clinic or scheduled an appointment.\n\nRelated items currently checked out to you:\n${relevant.map(l=>`- ${l.title} (${l.format}); due ${l.dueDate}`).join('\n')}\nThese are conflict-history, literature, and general trauma resources; they are not veterans-benefit manuals or evidence about your health, service history, or eligibility.`,sources:[]};
  }
  return null;
}
module.exports={applyPatronProfiles,patronProfileReply};
