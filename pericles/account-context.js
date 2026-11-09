'use strict';
const knowledge = require('./knowledge/library-knowledge.json');
const { lendingLimitsText } = require('./lending-policy');
function isBorrowingEligibilityQuestion(message) {
  if (/\b(?:how long|loan period|due date)\b/i.test(message)) return false;
  return /\b(?:books?|dvds?|video games?|items?|materials?|checkouts?|borrow|check out)\b/i.test(message)
    && /\b(?:maximum|max|limits?|how many.*(?:can|may|allowed)|can i.*(?:borrow|check out)|may i.*(?:borrow|check out)|borrow (?:more|another))\b/i.test(message);
}
function accountContext(circulation, services) {
  if (circulation.patron.id !== services.accountId) throw new Error('Account context mismatch');
  const threshold = knowledge.circulation.newCheckoutBlockAboveCents;
  const feeBlocked = Number.isInteger(threshold) && services.balanceCents > threshold;
  return {
    fictional: true, accountId: circulation.patron.id,
    balanceCents: services.balanceCents,
    capacity: circulation.borrowingCapacity,
    newCheckouts: { feeBlocked, allowedByAccount: !feeBlocked,
      availableByCategory: Object.fromEntries(Object.entries(circulation.borrowingCapacity).map(([category, c]) => [category, feeBlocked ? 0 : c.remaining])) },
    scope: 'Only new checkouts are blocked by fees. Renewals/holds keep their separate eligibility rules; program access is not blocked. Catalog availability and actual checkout fulfillment are not established.'
  };
}
function borrowingAnswer(context) {
  if (!context) return `${lendingLimitsText()} Select a patron if you want me to apply this to your loans and balance.`;
  const money = `$${(context.balanceCents / 100).toFixed(2)}`;
  const counts = Object.entries(context.capacity).map(([key, c]) => `${c.used}/${c.limit} ${key === 'videoGames' ? 'video games' : key === 'dvds' ? 'DVDs' : 'books'} checked out (${c.remaining} below the category limit)`).join('; ');
  if (context.newCheckouts.feeBlocked) return `For Patron ${context.accountId}, you can borrow 0 additional items right now: your ${money} outstanding balance blocks new checkouts until fully settled. ${counts}. Those unused category capacities become available only AFTER confirmed full settlement, subject to item availability. ${lendingLimitsText()} No payment or checkout was initiated.`;
  return `For Patron ${context.accountId}: ${counts}. Your balance is ${money}; there is no fee block. You may borrow up to the remaining category capacities, subject to actual item availability. ${lendingLimitsText()} No checkout was initiated.`;
}
module.exports = { accountContext, borrowingAnswer, isBorrowingEligibilityQuestion };
