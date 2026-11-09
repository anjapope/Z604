'use strict';

const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const { AsyncLocalStorage } = require('node:async_hooks');
const { configuration, createGuard } = require('./pericles/deployment');

const { buildSystemPrompt } = require('./pericles/prompts/build-system-prompt');
const { buildGroundingContext } = require('./pericles/prompts/build-grounding-context');
const {
  CATALOG_ENTRIES,
  answerCatalogQuestion,
  getCatalogSummary,
  searchCatalog
} = require('./pericles/catalog-service');
const {
  createSourceRegistry,
  buildEvaluationInstructions,
  buildRecoveryInstructions,
  buildResearchInstructions,
  extractResearchCriteria,
  formatResearchResult,
  validateResearchSources
} = require('./pericles/research-quality');

const { enrichSources } = require('./pericles/source-inspection');
const { routeServiceRequest, answerLocalService } = require('./pericles/service-router');
const { createCirculationService } = require('./pericles/circulation-service');
const { answerInstitutional, splitInstitutionalRequest, institutionalTopic } = require('./pericles/institutional-service');
const { createPatronServices, isFeeRequest } = require('./pericles/patron-services');
const { feePersonaInstructions } = require('./pericles/fee-persona');
const { accountContext, borrowingAnswer, isBorrowingEligibilityQuestion } = require('./pericles/account-context');
const { answerReadingLevel, readingMetadata } = require('./pericles/learning-service');
const { isSubstantiveReference } = require('./pericles/reference-intent');
const { serviceReplyMessages, protectsAction } = require('./pericles/conversational-reply');

dotenv.config();

const app = express();
const deployment = configuration();
app.set('trust proxy', deployment.trustProxy);
app.disable('x-powered-by');
app.locals.deploymentGuard = createGuard(deployment);
const aiRequestScope = new AsyncLocalStorage();
app.locals.circulation = createCirculationService();
app.locals.patronServices = createPatronServices();
const PORT = deployment.port;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARACTERS = 16000;
const OPENAI_REQUEST_TIMEOUT_MS = deployment.providerTimeoutMs;
app.locals.composeServiceReply = composeServiceReply;

app.use('/api', (req, res, next) => app.locals.deploymentGuard.middleware(req, res, next));
app.use(express.json({ limit: '32kb' }));
// Only these browser assets are public. Never serve the workspace as a directory.
const PUBLIC_ASSETS = new Map([
  ['/', 'index.html'],
  ...require('./pericles/public-assets').map(file => [`/${file}`, file])
]);
app.use((req, res, next) => {
  const file = PUBLIC_ASSETS.get(req.path);
  if (!file || !['GET', 'HEAD'].includes(req.method)) return next();
  return res.sendFile(path.resolve(__dirname, file));
});

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  const normalized = history
    .filter((item) => item
      && (item.role === 'user' || item.role === 'assistant')
      && typeof item.content === 'string')
    .slice(-MAX_HISTORY_MESSAGES)
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, MAX_MESSAGE_LENGTH) }));

  let totalCharacters = 0;
  const bounded = [];
  for (const item of normalized.reverse()) {
    if (!item.content) continue;
    const remaining = MAX_HISTORY_CHARACTERS - totalCharacters;
    if (remaining <= 0) break;
    const content = item.content.slice(0, remaining);
    bounded.unshift({ role: item.role, content });
    totalCharacters += content.length;
  }
  return bounded;
}

function isGenealogyQuestion(text) {
  return /\b(genealogy|genealogical|family history|grandfather|grandmother|ancestor|ancestry|great[- ]grandparent)\b/i.test(text);
}

function hasLikelyFullName(text) {
  return /\b(?:name\s+(?:is|was)\s+|(?:is|was)\s+(?:named|called)\s+)?[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(text);
}

function hasUsefulTimeOrPlace(text) {
  return /\b(?:18|19|20)\d{2}s?\b|\b(?:19|20)\d{2}\b|\b(?:Indiana|Indianapolis|county|township|parish|city)\b/i.test(text);
}

function needsGenealogyClarification(text) {
  return isGenealogyQuestion(text) && (!hasLikelyFullName(text) || !hasUsefulTimeOrPlace(text));
}

function shouldUseWebSearch(message, userContext = '') {
  return routeServiceRequest(message, userContext ? [{ role: 'user', content: userContext }] : []).intent === 'advanced_research';
}

function formatCatalogRecord(entry) {
  return {
    recordId: entry.recordId,
    title: entry.title,
    author: entry.author,
    year: entry.year,
    genre: entry.genre,
    format: entry.format,
    callNumber: entry.callNumber,
    location: entry.location,
    subjects: entry.subjects,
    audience: entry.audience,
    readingLevel: readingMetadata(entry)
  };
}

function extractResponseText(payload) {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  return output
    .filter((item) => item.type === 'message' && item.role === 'assistant')
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

function extractUrlCitations(payload) {
  return createSourceRegistry().ingest(payload);
}

const SOURCE_EVALUATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    category: { type: 'string', enum: ['direct', 'supplementary', 'excluded'] },
    evidence: { type: 'string' },
    coverageStart: { type: ['integer', 'null'] },
    coverageEnd: { type: ['integer', 'null'] },
    coverageEvidence: { type: 'string' },
    researchUse: { type: 'string', enum: ['contemporary_report', 'institutional_record', 'finding_aid', 'historical_study', 'background'] }
  },
  required: ['category', 'evidence', 'coverageStart', 'coverageEnd', 'coverageEvidence', 'researchUse']
};

function buildResearchResponseSchema(records) {
  const ids = records.map(record => record.sourceId);
  return {
    type: 'object', additionalProperties: false, required: ['sources'],
    properties: { sources: {
      type: 'object', additionalProperties: false, required: ids,
      properties: Object.fromEntries(ids.map(id => [id, SOURCE_EVALUATION_SCHEMA]))
    } }
  };
}

function extractStructuredResearch(payload, query, records = []) {
  try {
    return formatResearchResult(JSON.parse(extractResponseText(payload)), records, extractResearchCriteria(query));
  } catch (_error) {
    return { reply: 'I could not reliably evaluate the retrieved sources.', sources: [] };
  }
}

function researchDiagnosticsEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.PERICLES_RESEARCH_DIAGNOSTICS === 'true';
}

function safeProviderIdentifier(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(value)
    ? value
    : undefined;
}

async function logOpenAIHttpFailure(operation, response) {
  let providerError;
  try {
    providerError = (await response.clone().json())?.error;
  } catch (_error) {
    providerError = null;
  }
  console.error(JSON.stringify({
    event: 'openai_request_failure',
    operation,
    status: response.status,
    providerErrorCode: safeProviderIdentifier(providerError?.code),
    providerErrorType: safeProviderIdentifier(providerError?.type)
  }));
}

async function callOpenAI(body, operation, responses = true) {
  try {
    if (!app.locals.deploymentGuard.admitProviderCall()) return null;
    const deadline = aiRequestScope.getStore();
    const response = await fetch(responses ? 'https://api.openai.com/v1/responses' : 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: deadline ? AbortSignal.any([deadline, AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) { await logOpenAIHttpFailure(operation, response); return null; }
    return await response.json();
  } catch (error) {
    console.error(JSON.stringify({ event: 'openai_request_failure', operation,
      errorType: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'request_timeout' : 'network_or_parse_error' }));
    return null;
  }
}

async function requestOpenAI(messages, useWebSearch, researchQuery = '') {
  if (!useWebSearch) {
    const payload = await callOpenAI({ model: OPENAI_MODEL, messages, temperature: 0.35, max_tokens: 1000 }, 'chat_completion', false);
    const reply = payload?.choices?.[0]?.message?.content?.trim();
    return reply ? { reply } : { error: true };
  }
  const registry = createSourceRegistry();
  const criteria = extractResearchCriteria(researchQuery);
  const evaluations = [];
  let evaluatedCount = 0;
  let inspectionCount = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const operation = attempt ? 'research_recovery' : 'research_initial';
    const payload = await callOpenAI({
      model: OPENAI_MODEL,
      input: attempt ? [...messages.slice(0, -1), { role: 'system', content: buildRecoveryInstructions(researchQuery) }, messages.at(-1)] : messages,
      tools: [{ type: 'web_search' }], tool_choice: 'required',
      include: ['web_search_call.action.sources'], max_output_tokens: 2200
    }, operation);
    if (!payload) {
      if (attempt && evaluations.length) break;
      return { error: true };
    }
    const previouslyEvaluated = new Set(evaluations.map(item => item.sourceId));
    let discovered = registry.ingest(payload).filter(record => !previouslyEvaluated.has(record.sourceId));
    // Inspect at most four promising institutional pages across this request.
    inspectionCount += await enrichSources(registry, discovered, Math.min(2, 4 - inspectionCount));
    discovered = discovered.map(record => registry.records.get(record.sourceId));
    // Discovery prose and its model-generated URLs never enter evaluation.
    if (discovered.length) {
      // Required ID-keyed properties guarantee one evaluation per retrieved record.
      const schema = buildResearchResponseSchema(discovered);
      const review = await callOpenAI({
        model: OPENAI_MODEL,
        input: [messages[0], { role: 'system', content: buildEvaluationInstructions(researchQuery, discovered) }],
        text: { format: { type: 'json_schema', name: 'pericles_source_evaluations', strict: true, schema } },
        max_output_tokens: Math.min(16000, 700 + discovered.length * 260)
      }, `${operation}_evaluation`);
      if (!review) { if (evaluations.length) break; return { error: true }; }
      try {
        const reviewsById = JSON.parse(extractResponseText(review)).sources;
        if (!reviewsById || typeof reviewsById !== 'object' || Array.isArray(reviewsById)) throw new Error('Invalid evaluations');
        const candidates = Object.entries(reviewsById).map(([sourceId, evaluation]) => ({ ...evaluation, sourceId }));
        const allowed = new Set(discovered.map(record => record.sourceId));
        const ids = new Set(candidates.map(candidate => candidate?.sourceId));
        if (candidates.length !== allowed.size || ids.size !== allowed.size || [...ids].some(id => !allowed.has(id))) {
          throw new Error('Incomplete source review');
        }
        evaluations.push(...candidates);
        evaluatedCount = new Set(evaluations.map(item => item.sourceId)).size;
      } catch (_error) {
        // Keep future failed reviews diagnosable without logging prompts, source text or credentials.
        console.error(JSON.stringify({ event: 'openai_request_failure', operation: `${operation}_evaluation`,
          errorType: 'source_review_validation_error', retrievedCount: registry.records.size,
          evaluatedCount, batchCount: discovered.length,
          responseStatus: safeProviderIdentifier(review.status),
          incompleteReason: safeProviderIdentifier(review.incomplete_details?.reason) }));
        if (!evaluations.length) return { error: true };
      }
    }
    const current = formatResearchResult({ sources: evaluations }, registry.records, criteria);
    if (current.sources.filter(source => source.category === 'direct').length >= (criteria.requestedCount || 3)) break;
  }
  const decisions = [];
  const accepted = validateResearchSources(evaluations, registry.records, criteria, decisions);
  const result = formatResearchResult({ sources: evaluations }, registry.records, criteria);
  if (researchDiagnosticsEnabled()) console.info(JSON.stringify({
    event: 'pericles_research_pipeline', retrievedCount: registry.records.size, evaluatedCount, inspectionCount,
    acceptedCount: accepted.length, recommendedCount: result.sources.length,
    inspectedCount: [...registry.records.values()].filter(record => record.metadata.pageText).length,
    metadataCount: [...registry.records.values()].filter(record => Object.keys(record.metadata).length).length,
    exclusionReasons: decisions.filter(item => item.reason).reduce((counts, item) => ({ ...counts, [item.reason]: (counts[item.reason] || 0) + 1 }), {}),
    classificationCounts: { direct: accepted.filter(item => item.category === 'direct').length,
      supplementary: accepted.filter(item => item.category === 'supplementary').length,
      excluded: decisions.filter(item => item.category === 'excluded').length }
  }));
  return result;
}

app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
});
app.get('/api/chat/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ aiConfigured: Boolean(OPENAI_API_KEY) });
});

async function composeServiceReply({ payload, message, history, req }) {
  const fallback = notice => ({ ...payload, responseMode: 'local', notice });
  if (!OPENAI_API_KEY) return fallback('AI is not configured. This answer uses local library information.');
  const admission = app.locals.deploymentGuard.tryAcquireAI(req);
  if (admission.error) return fallback(`${admission.error} This answer uses local library information.`);
  const protectedAction = protectsAction(payload, req.demoSession);
  try {
    const messages = serviceReplyMessages({ systemPrompt: buildSystemPrompt(), message, history, facts: payload.reply, protectedAction, feeRelated: payload.feeRelated, account: payload.accountContext });
    const result = await aiRequestScope.run(AbortSignal.timeout(deployment.responseTimeoutMs), () => requestOpenAI(messages, false));
    if (result.error) return fallback('AI is unavailable. This answer uses the server’s library information; any transaction details below remain authoritative.');
    const blocked = payload.borrowingQuestion && payload.accountContext?.newCheckouts?.feeBlocked;
    const decision = blocked ? `Right now, you can check out 0 additional items. Your $${(payload.accountContext.balanceCents / 100).toFixed(2)} balance must be settled in full first.\n\n` : '';
    return { ...payload, reply: decision + (protectedAction ? `${result.reply}\n\n${payload.reply}` : result.reply), responseMode: 'ai' };
  } catch (_error) {
    return fallback('AI is unavailable. This answer uses local library information.');
  } finally { admission.release(); }
}

app.get('/api/catalog/search', (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query || query.length > 500) {
    return res.status(400).json({ error: 'A catalog query of 1-500 characters is required.' });
  }

  const limitValue = Number(req.query.limit);
  const limit = Number.isInteger(limitValue) ? Math.min(50, Math.max(1, limitValue)) : 10;
  return res.json({
    scope: 'Stapleton demonstration catalog',
    availabilityTracked: false,
    results: searchCatalog(query, { limit }).map(formatCatalogRecord)
  });
});

app.get('/api/catalog/summary', (_req, res) => {
  res.json({
    scope: 'Stapleton demonstration catalog',
    availabilityTracked: false,
    ...getCatalogSummary()
  });
});

// Fictional account state is never a public static asset. A random browser session
// carries only a selected demo identity and a server-held, expiring action preview.
app.use(['/api/circulation', '/api/chat'], (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST') {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Use application/json.' });
  }
  req.demoSession = app.locals.circulation.session(req, res);
  next();
});
function circulationRoute(handler) {
  return (req, res) => {
    try { res.json(handler(app.locals.circulation, req)); }
    catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : 'Fictional circulation storage is unavailable. No success is confirmed; reload the account before retrying.' }); }
  };
}
function circulationBody(req, keys) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key))) {
    const error = new Error('Invalid circulation parameters.'); error.status = 400; throw error;
  }
  return body;
}
app.get('/api/circulation/patrons', circulationRoute(service => ({ fictional: true, patrons: service.patrons })));
app.get('/api/circulation/policies', circulationRoute(service => ({ ...service.policies, explanation: service.policyText() })));
app.get('/api/circulation/account', circulationRoute((service, req) => service.summary(req.demoSession)));
app.post('/api/circulation/selection', circulationRoute((service, req) => {
  req.demoSession.servicePending = null;
  req.demoSession.suggestedProgram = null;
  req.demoSession.programAction = null;
  req.demoSession.lastProgramRecommendation = false;
  req.demoSession.programProfile = null;
  req.demoSession.programRecommendations = null;
  req.demoSession.lastFeeTopic = false;
  req.demoSession.lastBorrowingQuestion = false;
  return service.select(req.demoSession, circulationBody(req, ['accountId']).accountId);
}));
app.post('/api/circulation/preview', circulationRoute((service, req) => {
  const body = circulationBody(req, ['action', 'loanIds', 'recordId']);
  req.demoSession.servicePending = null;
  if ((body.action === 'renew' && body.recordId !== undefined) || (body.action === 'hold' && body.loanIds !== undefined)) {
    const error = new Error('Parameters do not match the requested action.'); error.status = 400; throw error;
  }
  return service.prepare(req.demoSession, body.action, body);
}));
app.post('/api/circulation/confirm', circulationRoute((service, req) => service.confirm(req.demoSession, circulationBody(req, ['confirmationToken']).confirmationToken)));
app.post('/api/circulation/cancel', circulationRoute((_service, req) => {
  circulationBody(req, []);
  req.demoSession.pending = null;
  req.demoSession.servicePending = null;
  return { fictional: true, cancelled: true };
}));

// Services share the same fictional selection, origin controls, and session token.
app.use('/api/services', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Use application/json.' });
  req.demoSession = app.locals.circulation.session(req, res);
  next();
});
function serviceRoute(handler) {
  return (req, res) => {
    try { res.json(handler(app.locals.patronServices, req)); }
    catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : 'Demonstration services storage is unavailable. No success is confirmed.' }); }
  };
}
app.get('/api/services/programs', serviceRoute(service => ({ fictional: true, programs: service.events() })));
app.get('/api/services/account', serviceRoute((service, req) => service.summary(req.demoSession)));
app.post('/api/services/preview', serviceRoute((service, req) => {
  const body = circulationBody(req, ['action', 'eventId']);
  return service.prepare(req.demoSession, body.action, { eventId: body.eventId });
}));
app.post('/api/services/confirm', serviceRoute((service, req) => service.confirm(req.demoSession, circulationBody(req, ['confirmationToken']).confirmationToken)));
app.post('/api/services/cancel', serviceRoute((_service, req) => {
  circulationBody(req, []);
  req.demoSession.servicePending = null;
  return { fictional: true, cancelled: true };
}));

app.post('/api/chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const history = normalizeHistory(req.body?.history);
  const feeRelated = isFeeRequest(message) || institutionalTopic(message) === 'fees'
    || /_fees$/.test(req.demoSession.servicePending?.action || '')
    || (req.demoSession.lastFeeTopic && /^(?:(?:that|this|it|these|they) (?:seems?|is|are|isn['’]t|aren['’]t)|(?:but )?i (?:can['’]t|cannot) afford|why(?: not)?[?.!]*$|(?:can|could) you (?:make an exception|waive))/i.test(message));
  req.demoSession.lastFeeTopic = Boolean(feeRelated);
  const sendServiceReply = async payload => {
    let snapshot = payload.accountContext;
    if (!snapshot && req.demoSession.accountId && /\b(?:my|borrow|borrowing|check out|checkout|renew\w*|holds?|fees?|balance)\b/i.test(message)) {
      try { snapshot = accountContext(app.locals.circulation.summary(req.demoSession), app.locals.patronServices.summary(req.demoSession)); }
      catch (_error) { snapshot = { unavailable: true, instruction: 'Current account context could not be verified. Do not invent a balance, fee block, or borrowing permission.' }; }
    }
    return res.json(await app.locals.composeServiceReply({ payload: { ...payload, ...(snapshot ? { accountContext: snapshot } : {}), feeRelated: Boolean(payload.feeRelated || feeRelated || (snapshot?.newCheckouts?.feeBlocked && isBorrowingEligibilityQuestion(message))) }, message, history, req }));
  };

  if (!message) return res.status(400).json({ error: 'Message is required.' });
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(413).json({ error: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.` });
  }

  const service = routeServiceRequest(message, history);
  const { userContext } = service;
  const borrowingFollowup = req.demoSession.lastBorrowingQuestion && /^(?:(?:and |what about )?(?:books?|dvds?|video games?|games)|how many more|what if i pay)[?.!]*$/i.test(message.trim());
  req.demoSession.lastBorrowingQuestion = false;
  if (service.intent !== 'advanced_research' && (isBorrowingEligibilityQuestion(message) || borrowingFollowup)) {
    req.demoSession.pending = null;
    req.demoSession.servicePending = null;
    req.demoSession.lastWasCirculation = false;
    try {
      const snapshot = req.demoSession.accountId ? accountContext(app.locals.circulation.summary(req.demoSession), app.locals.patronServices.summary(req.demoSession)) : null;
      req.demoSession.lastFeeTopic = Boolean(snapshot?.newCheckouts.feeBlocked);
      req.demoSession.lastBorrowingQuestion = true;
      return sendServiceReply({ reply: borrowingAnswer(snapshot), sources: [], borrowingQuestion: true, feeRelated: Boolean(snapshot?.newCheckouts.feeBlocked), ...(snapshot ? { accountContext: snapshot } : {}) });
    } catch (_error) {
      return res.status(503).json({ error: 'I could not verify your current loans and balance, so I cannot confirm what you may borrow right now. Please try again.' });
    }
  }
  // Handle authoritative simulations before policy/general-language routing.
  try {
    const reply = app.locals.patronServices.chat(req.demoSession, message);
    if (reply) return sendServiceReply({ reply, sources: [], fictionalServices: true });
  } catch (error) {
    if (error.status) return sendServiceReply({ reply: `Fictional demonstration: ${error.message}`, sources: [], fictionalServices: true });
    return res.status(503).json({ error: 'Demonstration services storage is unavailable. No success is confirmed.' });
  }
  const learningReply = answerReadingLevel(message);
  if (learningReply && !/\b(?:practice|plan|teach|struggl\w*|phonics|learn\w*|dyslex\w*|homework)\b/i.test(message)) {
    req.demoSession.pending = null;
    return sendServiceReply({ reply: learningReply + app.locals.patronServices.suggestion(req.demoSession, message, history), sources: [] });
  }
  // Policy explanations never pass through transaction parsing. Explicit action
  // clauses still use the selected account's existing preview/confirmation flow.
  if (!['advanced_research', 'reference', 'general'].includes(service.intent)) {
    const clauses = splitInstitutionalRequest(message);
    if (clauses) {
      req.demoSession.pending = null;
      req.demoSession.lastWasCirculation = false;
      const answers = [];
      let accountReply = false;
      try {
        for (const clause of clauses) {
          const context = routeServiceRequest(clause, history);
          const institutional = context.intent === 'account' ? null : answerInstitutional(clause, context.userContext);
          if (institutional) { answers.push(institutional); continue; }
          if (context.intent === 'account') {
            const reply = app.locals.circulation.chat(req.demoSession, clause, context.intent);
            if (reply) { answers.push(reply); accountReply = true; }
          } else {
            answers.push(answerLocalService(context.intent, clause, context.userContext)
              || (context.intent === 'catalog' ? answerCatalogQuestion(clause, context.userContext) : null)
              || 'Which library service would you like help with for that part of your question?');
          }
        }
        req.demoSession.lastWasCirculation = accountReply;
        return sendServiceReply({ reply: answers.join('\n\n'), sources: [], ...(accountReply ? { fictionalCirculation: true } : {}) });
      } catch (_error) {
        req.demoSession.pending = null;
        return res.status(503).json({ error: 'Fictional circulation is unavailable. No transaction success is confirmed.' });
      }
    }
    if (['policies', 'library_information'].includes(service.intent)) {
      const reply = answerInstitutional(message, userContext);
      if (reply) {
        req.demoSession.pending = null;
        req.demoSession.lastWasCirculation = false;
        return sendServiceReply({ reply, sources: [] });
      }
    }
  }
  try {
    const reply = app.locals.circulation.chat(req.demoSession, message, service.intent);
    req.demoSession.lastWasCirculation = Boolean(reply);
    if (reply) return sendServiceReply({ reply, sources: [], fictionalCirculation: true });
  } catch (_error) {
    return res.status(503).json({ error: 'Fictional circulation storage is unavailable. No success is confirmed; reload the account before retrying.' });
  }
  const localReply = service.intent === 'reference' && isSubstantiveReference(userContext) && service.history.length
    ? null : answerLocalService(service.intent, message, userContext);
  if (localReply) return sendServiceReply({ reply: localReply, sources: [] });

  if (service.intent === 'catalog') {
    const reply = answerCatalogQuestion(message, userContext)
      || 'I could not establish matching demonstration-catalog records. What title, author, or subject should I search?';
    return sendServiceReply({ reply, sources: [] });
  }
  if (service.intent === 'advanced_research' && needsGenealogyClarification(userContext)) {
    return sendServiceReply({ reply: 'Could you share the full name of the ancestor and either an approximate decade or a more specific city or county? Those details help narrow the records to search.', sources: [] });
  }

  if (!OPENAI_API_KEY) {
    return res.status(503).json({ error: 'Live reference research is unavailable because the OpenAI service is not configured.' });
  }
  const releaseAI = app.locals.deploymentGuard.acquireAI(req, res);
  if (!releaseAI) return;

  const catalogMatches = searchCatalog(userContext, { limit: 6 }).map(formatCatalogRecord);
  const groundingContext = buildGroundingContext({ catalogMatches });
  const useWebSearch = service.intent === 'advanced_research';
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'system', content: `# Verified SPL Grounding Context\n\n${groundingContext}` },
    { role: 'system', content: `# Current classroom service context\nLibrary date: ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Indiana/Indianapolis' }).format(new Date())}.\n${JSON.stringify(require('./pericles/knowledge/service-offerings.json'))}\nOnly the separate server service can confirm balances, registrations, credits, renewals, and holds. You have no transaction tools in this response. Never assert that an action or referral occurred. Provide practical topic assistance first; when relevant the server appends one dated program suggestion.` },
    { role: 'system', content: 'Curated official external resource: IRS free tax return preparation programs, https://www.irs.gov/individuals/irs-free-tax-return-preparation-programs (reviewed 2026-11-04). VITA/TCE offer free preparation to qualifying taxpayers. Use its current site locator and eligibility details; no local provider or current threshold is verified in this chat. The fictional Tax Preparation Readiness program is educational, not tax filing or VITA affiliation.' },
    ...(learningReply ? [{ role: 'system', content: `Sourced reading context for this question:\n${learningReply}\nUse this metadata while answering the patron’s substantive learning/practice question. Do not just repeat the book list.` }] : []),
    ...(feePersonaInstructions(feeRelated) ? [{ role: 'system', content: feePersonaInstructions(feeRelated) }] : []),
    ...(useWebSearch ? [{ role: 'system', content: buildResearchInstructions(userContext) }] : []),
    ...(feeRelated ? history.filter((item, i) => !(i === history.length - 1 && item.role === 'user' && item.content === message)) : service.history),
    { role: 'user', content: message }
  ];

  const deadline = AbortSignal.timeout(deployment.responseTimeoutMs);
  const responseTimer = setTimeout(() => {
    if (!res.headersSent) res.status(503).json({ error: 'The AI service took too long. Please try again later; catalog and fictional accounts remain available.' });
  }, deployment.responseTimeoutMs);
  responseTimer.unref();
  try {
    const result = await aiRequestScope.run(deadline, () => requestOpenAI(messages, useWebSearch, userContext));
    if (res.headersSent) return;
    if (result.error) {
      return res.status(502).json({ error: 'The reference service could not return a verified response. Please try again.' });
    }
    return res.json({ reply: result.reply + app.locals.patronServices.suggestion(req.demoSession, message, history), sources: result.sources || [], responseMode: 'ai' });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'openai_request_failure',
      operation: useWebSearch ? 'research_initial' : 'chat_completion',
      errorType: error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'request_timeout'
        : 'unexpected_error',
      errorName: safeProviderIdentifier(error?.name)
    }));
    if (!res.headersSent) return res.status(502).json({ error: 'The reference service could not be reached. Please try again later; catalog and fictional accounts remain available.' });
  } finally {
    clearTimeout(responseTimer);
    releaseAI();
  }
});

app.use((error, _req, res, _next) => {
  const status = error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
  res.status(status).json({ error: status === 413 ? 'The request is too large.' : status === 400 ? 'The request must contain valid JSON.' : 'The service is temporarily unavailable.' });
});

if (require.main === module) {
  const server = app.listen(PORT, deployment.host, () => {
    console.log(`Stapleton Public Library portal listening on ${deployment.host}:${PORT}`);
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 5000;
}

module.exports = {
  app,
  normalizeHistory,
  shouldUseWebSearch,
  extractResponseText,
  extractUrlCitations,
  extractStructuredResearch
};
