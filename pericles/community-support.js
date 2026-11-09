'use strict';
const directory = require('./knowledge/community-support.json');
const patterns = {
  veterans: /\b(?:veterans?|VA clinic|military benefits)\b/i,
  housing: /\b(?:homeless|unhoused|shelters?|housing assistance|eviction|sleeping outside|nowhere to (?:sleep|stay)|no (?:place|somewhere) to (?:sleep|stay)|losing (?:my |our )?home)\b/i,
  violence: /\b(?:domestic violence|domestic abuse|abusive (?:partner|husband|wife|relationship)|unsafe at home|sexual assault|middle\s?way(?: house)?|(?:partner|husband|wife|boyfriend|girlfriend) (?:hits|hit|hurts|threatens|controls)|women'?s shelter)\b/i,
  recovery: /\b(?:drug rehab|rehabilitation|addiction|overdose|unconscious|seizure|not breathing|substance (?:use|abuse)|detox|withdrawal|recovery (?:support|groups?|services)|sober|sobriety|harm reduction|stop (?:drinking|using drugs)|alcohol (?:help|treatment|rehab))\b/i,
  food: /\b(?:food (?:pantr(?:y|ies)|banks?|assistance)|hungry|hunger|soup kitchen|free (?:food|meals?|groceries)|can['’]?t afford (?:food|groceries)|no food|need (?:food|groceries)|diapers|period supplies)\b/i,
  earlyLearning: /\b(?:head\s?start|preschool|early (?:childhood|learning)|childcare assistance)\b/i,
  autism: /\b(?:autism|autistic|sensory support|neurodivergent)\b/i,
  disability: /\b(?:disability (?:support|services|benefits)|developmental disabilities|independent living)\b/i,
  legal: /\b(?:legal aid|eviction|tenant rights|benefits appeal)\b/i,
  family: /\b(?:family support|diapers|period supplies|utility assistance|help (?:with|paying) (?:my |our )?utilities)\b/i
};
function communitySupportReply(message, session = {}) {
  const text = String(message).trim();
  // Do not hijack collection discovery or academic source research.
  if (/\b(?:books?|novels?|bibliography|citations?)\b/i.test(text) && !/\b(?:shelter|pantry|service|provider|center)\b/i.test(text)) { session.communitySupportIds = []; return null; }
  const named = directory.providers.filter(p => text.toLowerCase().includes(p.name.toLowerCase()));
  const categories = Object.entries(patterns).filter(([, pattern]) => pattern.test(text)).map(([key]) => key);
  const all = /\b(?:local non-?profits?|community (?:support|resources|services)|social services)\b/i.test(text);
  const followup = session.communitySupportIds?.length && /^(?:and |what about )?(?:where(?: do i go)?|how (?:do i|can i) (?:contact|apply|start|sign up)|what (?:are their|are the) hours|are they open|do i need (?:id|a diagnosis)|tell me more|what should i (?:bring|ask)|which one)[?.!]*$/i.test(text);
  if (!named.length && !categories.length && !all && !followup) { session.communitySupportIds = []; return null; }
  let matches = named.length ? named : followup ? directory.providers.filter(p => session.communitySupportIds.includes(p.id)) : directory.providers.filter(p => all || p.categories.some(c => categories.includes(c)));
  // For families without housing, lead with the family shelter instead of adult services.
  if (categories.includes('housing') && /\b(?:child|children|kids|family|families|baby)\b/i.test(text)) matches.sort((a,b) => Number(b.id === 'family') - Number(a.id === 'family'));
  if (categories.includes('violence')) matches.sort((a,b) => Number(b.id === 'willow') - Number(a.id === 'willow'));
  matches = matches.slice(0, all ? directory.providers.length : 4);
  session.communitySupportIds = matches.map(p => p.id);
  let lead = 'Here are Stapleton services that can help:';
  if (categories.includes('violence')) lead = 'Willow Haven can help you consider safety and support options. You do not need to describe what happened here. If it is unsafe to use this device, use a safer device when you can.';
  if (/\b(?:overdose|not breathing|unconscious|seizure)\b/i.test(text)) lead = 'If someone may be overdosing, is unconscious, or is not breathing normally, contact emergency services immediately. Do not wait for a treatment intake appointment.';
  const reply = lead + '\n\n' + matches.map(p => `**${p.name}** — ${p.services}\nWho it serves: ${p.audience}\nStart here: ${p.access}\nHours: ${p.hours}\n[Service details](/community-support.html#${p.id})`).join('\n\n') + '\n\nThese are regular service hours, not a live availability check. Intake can confirm current spaces, supplies, costs, and eligibility. I can help you prepare questions; I have not contacted or registered you with a provider.';
  return { reply, sources: [], communitySupport: true };
}
function communitySupportContext() {
  return JSON.stringify({ providers: directory.providers, rules: directory.rules });
}
module.exports = { communitySupportReply, communitySupportContext };
