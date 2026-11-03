'use strict';
// Opt-in live diagnostics. Never run automatically with npm test.
const fs = require('node:fs');
const phase = process.argv[2] || 'diagnosis';
if (!['diagnosis', 'verification'].includes(phase)) throw new Error('Use diagnosis or verification');
process.env.PERICLES_RESEARCH_DIAGNOSTICS = 'true';
const query = "I'm researching the history of public libraries in Indiana between 1900 and 1950. Can you find three specific, credible sources, preferably including primary sources, and give me links to them?";
const trace = [];
const logs = [];
const info = console.info;
const errorLog = console.error;
const originalFetch = global.fetch;
const safe = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(value) ? value : undefined;
for (const level of ['info', 'error']) console[level] = line => {
  try { logs.push({ level, ...JSON.parse(String(line)) }); } catch (_) { /* Do not record arbitrary text. */ }
};
const inspection = require('../source-inspection');
const originalEnrich = inspection.enrichSources;
let attempt = 0;
inspection.enrichSources = async (...args) => {
  const started = performance.now();
  const event = { stage: 'page_inspection', attempt, executed: true };
  trace.push(event);
  try {
    const count = await originalEnrich(...args);
    Object.assign(event, { completed: true, attemptedCount: count,
      inspectedCount: args[1].filter(record => args[0].records.get(record.sourceId)?.metadata.pageText).length });
    return count;
  } catch (error) { event.errorCategory = 'server_exception'; event.errorName = safe(error?.name); throw error; }
  finally { event.durationMs = Math.round(performance.now() - started); }
};
global.fetch = async (url, options) => {
  if (String(url) !== 'https://api.openai.com/v1/responses') return originalFetch(url, options);
  const body = JSON.parse(options.body);
  const isRetrieval = Boolean(body.tools);
  if (isRetrieval) attempt += 1;
  const event = { operation: `research_${attempt === 1 ? 'initial' : 'recovery'}${isRetrieval ? '' : '_evaluation'}`,
    stage: isRetrieval ? 'retrieval' : 'relevance_evaluation', attempt, executed: true,
    maxOutputTokens: body.max_output_tokens };
  trace.push(event);
  const started = performance.now();
  try {
    const response = await originalFetch(url, options);
    event.httpStatus = response.status;
    let payload;
    try { payload = await response.clone().json(); }
    catch (error) { event.errorCategory = 'parsing_error'; event.errorName = safe(error?.name); return response; }
    event.providerStatus = safe(payload.status);
    event.providerErrorCode = safe(payload.error?.code);
    event.providerErrorType = safe(payload.error?.type);
    event.incompleteReason = safe(payload.incomplete_details?.reason);
    event.outputTokens = payload.usage?.output_tokens;
    event.completed = response.ok && payload.status === 'completed';
    if (!response.ok) event.errorCategory = 'upstream_api_error';
    if (payload.status === 'incomplete') event.errorCategory = 'incomplete_provider_response';
    const text = (payload.output || []).filter(item => item.type === 'message' && item.role === 'assistant')
      .flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n\n');
    if (isRetrieval) {
      const urls = new Set();
      for (const item of payload.output || []) {
        for (const source of item.action?.sources || []) if (source.url) urls.add(source.url);
        for (const content of item.content || []) for (const annotation of content.annotations || []) if (annotation.type === 'url_citation' && annotation.url) urls.add(annotation.url);
      }
      event.retrievedCount = urls.size;
    } else {
      const sourcesSchema = body.text.format.schema.properties.sources;
      const allowed = sourcesSchema.type === 'object' ? sourcesSchema.required : sourcesSchema.items.properties.sourceId.enum;
      event.expectedCount = allowed.length;
      try {
        const sources = JSON.parse(text).sources;
        event.parsed = true;
        const ids = Array.isArray(sources) ? sources.map(source => source?.sourceId)
          : sources && typeof sources === 'object' ? Object.keys(sources) : [];
        event.returnedCount = ids.length;
        event.uniqueIdCount = new Set(ids).size;
        event.missingIdCount = allowed.filter(id => !ids.includes(id)).length;
        event.unknownIdCount = ids.filter(id => !allowed.includes(id)).length;
        event.completeIdReview = ids.length === allowed.length && event.uniqueIdCount === allowed.length && event.unknownIdCount === 0;
        if (!event.completeIdReview) event.errorCategory = 'source_review_validation_error';
      } catch (error) { event.parsed = false; if (!event.errorCategory) event.errorCategory = 'parsing_error'; event.errorName = safe(error?.name); }
    }
    return response;
  } catch (error) {
    event.errorCategory = ['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : 'network_error';
    event.errorName = safe(error?.name); throw error;
  } finally { event.durationMs = Math.round(performance.now() - started); }
};
const { app } = require('../../server');
const started = performance.now();
const server = app.listen(0, '127.0.0.1', async () => {
  try {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: query, history: [] })
    });
    const patronResponse = await response.json();
    const report = { phase, query, httpStatus: response.status, durationMs: Math.round(performance.now() - started), trace, logs, patronResponse };
    fs.writeFileSync(`pericles/evaluation/reliability-${phase}.json`, JSON.stringify(report, null, 2) + '\n');
    info(JSON.stringify(report, null, 2));
    if (!response.ok) process.exitCode = 1;
  } finally {
    console.info = info; console.error = errorLog; global.fetch = originalFetch;
    inspection.enrichSources = originalEnrich; server.close();
  }
});
