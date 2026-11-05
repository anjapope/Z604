'use strict';

// Subject help is different from a question about the library's own rules.
// Run this before broad keywords such as "computer", "policy", or "book".
function isSubstantiveReference(text) {
  if (/\b(?:tax(?:es|ation)?|tax prep(?:aration)?|3[- ]?d print\w*|makerspace|lexile|reading level|dyslex\w*|phonics|remedial|tutoring|homework|homeschool\w*|learning (?:support|resources?|difficult\w*)|struggling (?:reader|with)|supplement\w* learning)\b/i.test(text)) return true;
  if (/\b(?:teach|explain|compare|understand|troubleshoot|learn|learning|research|essay|thesis|job search|resume|résumé|cover letter)\b/i.test(text)
    && !/\b(?:your (?:policy|policies|hours)|library (?:policy|policies|hours|card))\b/i.test(text)) return true;
  if (/\b(?:how (?:do|can|should) I|help me|walk me through)\b/i.test(text)
    && /\b(?:computer|software|spreadsheet|printer|printing|design|citation|APA|MLA|Chicago|reading|math|science|writing|study|studying|budget|forms?)\b/i.test(text)) return true;
  return false;
}

module.exports = { isSubstantiveReference };
