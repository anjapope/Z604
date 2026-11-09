'use strict';

const { LIBRARY_HOURS, EVENTS_CONTEXT, SERVICES_CONTEXT } = require('./knowledge/library-facts');
const { isAdvisoryRequest, answerAdvisory } = require('./readers-advisory');
const { isCatalogQuestion, isCollectionQuestion } = require('./catalog-service');
const { institutionalTopic, answerInstitutional } = require('./institutional-service');
const { circulationIntent, accountFollowup } = require('./circulation-intent');
const { isSubstantiveReference } = require('./reference-intent');

function isHoursQuestion(text) {
  return /\bhours?\b/i.test(text) || (/\b(?:open(?:ing)?|clos(?:e|es|ing|ed))\b/i.test(text)
    && /\b(?:library|you|today|tomorrow|time|when|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)
    && !/\b(?:account|record|catalog(?:ue)?|book)\b/i.test(text));
}

// This dispatcher selects a service; research retrieval and evaluation remain separate.
function classifyServiceIntent(message) {
  const text = String(message).trim();
  if (circulationIntent(text)) return 'account';
  if (isCollectionQuestion(text)) return 'catalog';
  // Explicit source discovery retains the evidence-checked research pipeline.
  if (/\b(?:sources?|citations?|evidence)\b/i.test(text) && /\b(?:find|give|provide|need|identify|locate|research|support|opposing|credible|primary)\b/i.test(text)) return 'advanced_research';
  if (isSubstantiveReference(text)) return 'reference';
  if (/\b(?:do|can|could) you (?:help|assist)\b.*\b(?:citat|research|sources?|reference)|\b(?:citation help|research help|reference help|start (?:my |a )?research)\b/i.test(text)) return 'reference';
  if (/\b(?:genealog\w*|family history|grandfather|grandmother|ancestor|ancestry|census)\b/i.test(text)) return 'advanced_research';
  if (/\b(?:sources?|citations?|evidence)\b/i.test(text) && /\b(?:find|give|provide|need|identify|locate|research|support|opposing|credible|primary)\b/i.test(text)) return 'advanced_research';
  const topic = institutionalTopic(text);
  if (topic) return ['hours', 'holidays', 'contact', 'technology', 'accessibility', 'rooms', 'services'].includes(topic) ? 'library_information' : 'policies';
  if (isHoursQuestion(text)) return 'library_information';
  if (/\b(?:policy|policies|circulation policies|borrowing rules|loan (?:periods?|lengths?|limits?)|renewal (?:rules|limits?)|how long|library card|overdue (?:policy|fees?)|book challenges?)\b/i.test(text)) return 'policies';
  if (/\b(?:my account|my (?:books|loans)|patron [ABC]|transaction history|account (?:status|balance|summary)|checked[- ]out|due dates?|renew\w*|holds?|fines?|fees?|pay(?:ments?)?|card number|pin|password|sign[- ]?in|log[- ]?in)\b/i.test(text)) return 'account';
  if (/\b(?:accessib\w*|wheelchair|assistive|screen reader|contact|address|phone|email|location|where (?:is|are) (?:the )?(?:library|reference desk|archive room)|meeting rooms?|public computers?|internet|wi-?fi|technology (?:help|assistance)|tech (?:help|support)|device (?:help|support))\b/i.test(text)) return 'library_information';
  if (isAdvisoryRequest(text)) return 'readers_advisory';
  if (/\b(?:recommend\w*|suggest\w*|read[- ]?alikes?|what (?:should|could|can) I read|(?:do not|don't|don’t|not|avoid|no)\s+(?:want\s+)?fiction)\b/i.test(text) && !/\b(?:events?|programs?|workshops?|classes)\b/i.test(text)) return 'readers_advisory';
  if (/\b(?:events?|programs?|storytime|book club|workshops?|classes|lego lab|board meeting|summer reading|monster prom)\b/i.test(text)) return 'events';
  if (isCatalogQuestion(text) || isCollectionQuestion(text) || /\b(?:catalog(?:ue)?|books?|novels?|authors?|genres?|fantasy|mystery|nonfiction)\b/i.test(text)) return 'catalog';
  if (/\b(?:research|reference|citations?|archives?|databases?|search strateg\w*|evaluat\w* sources?)\b/i.test(text)) return 'reference';
  return null;
}

function isContextualFollowup(message) {
  return /^(?:(?:yes|no|please|thanks)\b|(?:and )?(?:what|how|where|which) (?:should I|do I|about|else|next|first)|I (?:prefer|enjoy|like)\b|(?:can|could) you (?:give|show|tell) me (?:more|another)|(?:his|her|their|my) name (?:is|was)|(?:he|she|they) (?:lived|was|were)|(?:in|around|during) \d{4}|(?:print|audio(?:books?)?|ebooks?|large print|fiction|nonfiction|fantasy|mystery|history|science|cooking|children|teen|adult|APA|MLA|Chicago|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)/i.test(message.trim());
}

function routeServiceRequest(message, history = []) {
  // The browser may include the current message as its last history entry.
  const prior = history.filter((item, index) => !(index === history.length - 1 && item.role === 'user' && item.content === message));
  const current = classifyServiceIntent(message);
  const previousIndex = prior.findLastIndex(item => item.role === 'user');
  let previous = previousIndex >= 0 ? (prior.slice(0, previousIndex + 1).filter(item => item.role === 'user').map(item => classifyServiceIntent(item.content)).filter(Boolean).at(-1) || 'general') : null;
  if (previous === 'catalog') {
    for (const turn of prior.filter(item => item.role === 'user').reverse()) {
      const intent = classifyServiceIntent(turn.content);
      if (intent === 'readers_advisory') { previous = intent; break; }
      if (intent && intent !== 'catalog') break;
      if (/\b(?:search|browse|do you have|books? by)\b/i.test(turn.content)) break;
    }
  }
  const advisoryFollowup = previous === 'readers_advisory' && !/\b(?:search|browse)\s+(?:the\s+)?catalog|\b(?:do you have|books? by|new topic|start over|recommend\w*|suggest\w*)\b/i.test(message) && (!current || ['readers_advisory', 'catalog'].includes(current));
  const policyFollowup = previous === 'policies' && /^(?:and |what about )?(?:audio(?:books?)?|ebooks?|digital|video|print|large print)[?.!]*$/i.test(message.trim());
  const accountContinuation = previous === 'account' && accountFollowup(message);
  const referenceFollowup = ['reference', 'general'].includes(previous) && (!current || current === previous) && !/\b(?:new topic|start over|unrelated question)\b/i.test(message);
  const continuing = previous && (referenceFollowup || isContextualFollowup(message) || advisoryFollowup || policyFollowup || accountContinuation) && (!current || current === previous
    || (previous === 'readers_advisory' && current === 'catalog')
    || (policyFollowup && current === 'catalog') || (accountContinuation && current === 'catalog'));
  if (!continuing) return { intent: current || 'general', history: [], userContext: message };

  // Keep only the contiguous same-service conversation, stopping at a topic switch.
  let start = previousIndex;
  for (let index = previousIndex - 1; index >= 0; index -= 1) {
    if (prior[index].role !== 'user') continue;
    const intent = classifyServiceIntent(prior[index].content);
    if (intent && intent !== previous && !(previous === 'readers_advisory' && intent === 'catalog')) break;
    start = index;
  }
  const relevant = prior.slice(start);
  return { intent: previous, history: relevant,
    userContext: [...relevant.filter(item => item.role === 'user').map(item => item.content), message].slice(-6).join('\n') };
}

function answerLocalService(intent, message, userContext = message) {
  if (['library_information', 'policies'].includes(intent)) {
    const institutional = answerInstitutional(message, userContext);
    if (institutional) return institutional;
    if (intent === 'library_information' && !classifyServiceIntent(message) && isHoursQuestion(userContext)) {
      const hours = answerInstitutional(`${message} hours`);
      if (hours) return hours;
    }
  }
  if (intent === 'library_information') {
    if (isHoursQuestion(message) || (!classifyServiceIntent(message) && isHoursQuestion(userContext))) {
      const days = message.match(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi) || [];
      const indices = new Set(days.map(day => /saturday/i.test(day) ? 1 : /sunday/i.test(day) ? 2 : 0));
      const hours = indices.size ? [...indices].map(index => LIBRARY_HOURS[index]) : LIBRARY_HOURS;
      return `${hours.join('\n')}\nThese are regular SPL hours. Holiday hours and exceptional closures are not established here; please confirm those with library staff.`;
    }
    if (/\b(?:accessib\w*|wheelchair|assistive|screen reader)\b/i.test(message)) return 'Specific SPL accessibility services and accommodations are not established in the supplied library information. Please ask library staff about the accommodation you need. The catalog can be searched for Large Print and Audiobook formats; those records do not establish current availability.';
    if (/\bmeeting rooms?\b/i.test(message)) return 'Meeting-room availability, booking procedures, and rules are not established in the supplied SPL information. Please ask library staff; I cannot reserve a room.';
    if (/\b(?:public computers?|internet|wi-?fi|technology|tech |device)\b/i.test(message)) return `${SERVICES_CONTEXT[0]} ${SERVICES_CONTEXT[1]} Please ask library staff about specific equipment or an appointment; those details are not established here.`;
    return 'SPL’s street address, public contact details, and service-desk locations are not established in the supplied library information. Please consult library staff for confirmation. You can browse the About and Programs pages for the established service information.';
  }
  if (intent === 'policies') {
    return answerInstitutional('What policies?');
  }
  if (intent === 'account') return `${SERVICES_CONTEXT[5]} Choose a patron in My Account for the classroom simulation. No sign-in or real library credentials are needed. For actual loans, due dates, renewals, holds, or balances, please contact library staff; do not share card numbers or passwords here.`;
  if (intent === 'events') {
    const terms = message.toLowerCase().match(/storytime|teen|children|youth|adult|book club|lego|board meeting|tech|digital citizenship|summer reading|monster prom|frontiers|folktales/g) || [];
    const matches = EVENTS_CONTEXT.filter(event => terms.some(term => event.toLowerCase().includes(term)));
    return `For Stapleton Public Library:\n${(matches.length ? matches : EVENTS_CONTEXT).join('\n')}\nThese are recurring program descriptions, not confirmed dated bookings. See the Events calendar and confirm cancellations or registration details with library staff.`;
  }
  if (intent === 'readers_advisory') {
    return answerAdvisory(userContext);
  }
  if (intent === 'reference') {
    const citationStyle = message.match(/\b(?:APA|MLA|Chicago)\b/i)?.[0];
    if (citationStyle && /^(?:APA|MLA|Chicago)[.!?]*$/i.test(message.trim()) && /\bcitat/i.test(userContext)) return `What source do you need to cite in ${citationStyle}? I can help identify the details needed for the citation.`;
    if (/^(?:(?:do|can|could) you (?:help|assist)(?: me)? with )?(?:citations?|citation help)[.!?]*$/i.test(message.trim())) return `${SERVICES_CONTEXT[2]} Which citation style or citation question would you like help with?`;
    if (/^(?:Help me develop a research topic|research help|reference help|start (?:my |a )?research)[.!?]*$/i.test(message.trim())) return `${SERVICES_CONTEXT[2]} What topic or task would you like help with?`;
    return null;
  }
  return null;
}

module.exports = { classifyServiceIntent, routeServiceRequest, answerLocalService };
