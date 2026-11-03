'use strict';

// Shared by routing and response dispatch. A policy/capability question is not
// authorization to start a transaction, even when it contains an action verb.
function circulationIntent(message) {
  const text = String(message).replace(/[’]/g, "'").trim();
  if (/\b(?:recommend\w*|suggest\w*|looking for|books? (?:about|by|on))\b|\b(?:search|browse)\b.*\bcatalog(?:ue)?\b|\b(?:find|locate|research)\b.*\b(?:sources?|citations?|evidence)\b/i.test(text)) return null;
  const command = /^(?:(?:please|can you|could you|would you|will you|i want to|i'd like to)\s+)?(?:please\s+)?/i.source;
  if (new RegExp(command + 'renew\\b', 'i').test(text)) return { kind: 'action', operation: 'renew' };
  if (new RegExp(command + '(?:place|put|add|request)\\b.*\\bhold\\b', 'i').test(text)) return { kind: 'action', operation: 'hold' };
  if (new RegExp(command + '(?:cancel|remove|delete)\\b.*\\bhold\\b', 'i').test(text)) return { kind: 'action', operation: 'cancel_hold' };
  if (/\b(?:privacy|private|confidential\w*|rights?|responsibilit\w*|policy|policies|library card)\b/i.test(text)) return null;
  const personal = /\b(?:my|our)\s+(?:(?:current|active|overdue|checked[- ]out)\s+)?(?:books?|loans?|items?|materials?|holds?|checkouts?|account|borrowing history)\b|\b(?:do i have|i (?:currently |already )?have|have i|am i)\b|\bchecked[- ]out to me\b/i.test(text);
  const state = /\b(?:checked[- ]out|checkouts?|loans?|borrow\w*|books?|materials?|items?|holds?|due|renew\w*|eligib\w*)\b/i.test(text);
  if (personal && state) {
    let question = /\bholds?\b/i.test(text) ? 'holds'
      : /\b(?:when|due|how long.*(?:left|keep))\b/i.test(text) ? 'due'
      : /\b(?:renew\w*|eligib\w*)\b/i.test(text) ? 'eligibility'
      : /\b(?:how many|count|number of)\b/i.test(text) ? 'count'
      : /\b(?:history|transactions?)\b/i.test(text) ? 'history' : 'loans';
    return { kind: 'information', question, books: /\bbooks?\b/i.test(text) };
  }
  if (/\b(?:why.*(?:can't|cannot|unable).*renew|renewal eligibility|which.*(?:loans?|items?|books?).*(?:renew|eligible)|(?:loans?|books?).*eligible)\b/i.test(text)) return { kind: 'information', question: 'eligibility' };
  return null;
}
function accountFollowup(message) {
  const text = message.trim().replace(/[?.!]+$/, '');
  if (/^(?:the )?titles(?: please)?$|^which (?:ones|books|titles)$|^what are they$/i.test(text)) return { kind: 'information', question: 'loans' };
  if (/^(?:and |the |their )?(?:due dates|dates)(?: please)?$|^when are they due$/i.test(text)) return { kind: 'information', question: 'due' };
  if (/^how many (?:in total|altogether)$/i.test(text)) return { kind: 'information', question: 'count', books: false };
  return null;
}
module.exports = { circulationIntent, accountFollowup };
