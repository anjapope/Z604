'use strict';
const { circulation } = require('./knowledge/library-knowledge.json');
const FORMATS = { books: ['Print Book', 'Large Print', 'Ebook'], dvds: ['DVD'], videoGames: ['Video Game'] };
function lendingLimitsText() {
  const l = circulation.checkoutLimits;
  return `You may have up to ${l.books} books, ${l.dvds} DVDs, and ${l.videoGames} video games checked out at once, per account. These are separate category limits. Print books, large print, and ebooks share the book limit; audiobooks and Blu-ray are separate formats whose limits are not specified. Holds are requests, not checkouts.`;
}
function borrowingCapacity(loans) {
  return Object.fromEntries(Object.entries(FORMATS).map(([category, formats]) => {
    const used = loans.filter(loan => formats.includes(loan.format)).length;
    const limit = circulation.checkoutLimits[category];
    return [category, { used, limit, remaining: Math.max(0, limit - used) }];
  }));
}
module.exports = { lendingLimitsText, borrowingCapacity };
