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

dotenv.config();

const app = express();
const deployment = configuration();
app.set('trust proxy', deployment.trustProxy);
app.disable('x-powered-by');
app.locals.deploymentGuard = createGuard(deployment);
const aiRequestScope = new AsyncLocalStorage();
app.locals.circulation = createCirculationService();
const PORT = deployment.port;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARACTERS = 16000;
const OPENAI_REQUEST_TIMEOUT_MS = deployment.providerTimeoutMs;

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
    subjects: entry.subjects
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
app.post('/api/circulation/selection', circulationRoute((service, req) => service.select(req.demoSession, circulationBody(req, ['accountId']).accountId)));
app.post('/api/circulation/preview', circulationRoute((service, req) => {
  const body = circulationBody(req, ['action', 'loanIds', 'recordId']);
  if ((body.action === 'renew' && body.recordId !== undefined) || (body.action === 'hold' && body.loanIds !== undefined)) {
    const error = new Error('Parameters do not match the requested action.'); error.status = 400; throw error;
  }
  return service.prepare(req.demoSession, body.action, body);
}));
app.post('/api/circulation/confirm', circulationRoute((service, req) => service.confirm(req.demoSession, circulationBody(req, ['confirmationToken']).confirmationToken)));
app.post('/api/circulation/cancel', circulationRoute((_service, req) => {
  circulationBody(req, []);
  req.demoSession.pending = null;
  return { fictional: true, cancelled: true };
}));

app.post('/api/chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const history = normalizeHistory(req.body?.history);

  if (!message) return res.status(400).json({ error: 'Message is required.' });
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(413).json({ error: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.` });
  }

  const service = routeServiceRequest(message, history);
  const { userContext } = service;
  try {
    const reply = app.locals.circulation.chat(req.demoSession, message, service.intent);
    req.demoSession.lastWasCirculation = Boolean(reply);
    if (reply) return res.json({ reply, sources: [], fictionalCirculation: true });
  } catch (_error) {
    return res.status(503).json({ error: 'Fictional circulation storage is unavailable. No success is confirmed; reload the account before retrying.' });
  }
  const localReply = answerLocalService(service.intent, message, userContext);
  if (localReply) return res.json({ reply: localReply, sources: [] });

  if (service.intent === 'catalog') {
    const reply = answerCatalogQuestion(message, userContext)
      || 'I could not establish matching demonstration-catalog records. What title, author, or subject should I search?';
    return res.json({ reply, sources: [] });
  }
  if (service.intent === 'advanced_research' && needsGenealogyClarification(userContext)) {
    return res.json({ reply: 'Could you share the full name of the ancestor and either an approximate decade or a more specific city or county? Those details help narrow the records to search.', sources: [] });
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
    ...(useWebSearch ? [{ role: 'system', content: buildResearchInstructions(userContext) }] : []),
    ...service.history,
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
    return res.json({ reply: result.reply, sources: result.sources || [] });
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
