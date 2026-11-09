'use strict';

function integer(env, name, fallback, max = 100000) {
  const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name]);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}.`);
  return value;
}
function lifetimeCeiling(env, name, fallback) {
  // Only these two ceilings accept the explicit sentinel; other protections
  // continue to require bounded positive integers. Null means no lifetime cap.
  if (typeof env[name] === 'string' && env[name].trim().toLowerCase() === 'unlimited') return null;
  return integer(env, name, fallback);
}
function exactOrigin(value) {
  const url = new URL(value);
  if (url.origin !== value || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Origins must be exact scheme://host[:port] values, with no paths or trailing slash.');
  return url;
}
function configuration(env = process.env) {
  const publicMode = env.NODE_ENV === 'production' || env.RENDER === 'true';
  const origins = new Set(['http://localhost:4000', 'http://127.0.0.1:4000', 'http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:5173', 'http://127.0.0.1:5173']);
  if (publicMode && !env.FRONTEND_ORIGIN) throw new Error('FRONTEND_ORIGIN is required for public deployment.');
  if (env.FRONTEND_ORIGIN) {
    const url = exactOrigin(env.FRONTEND_ORIGIN);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.github\.io$/i.test(url.hostname)) throw new Error('FRONTEND_ORIGIN must be the approved HTTPS GitHub Pages origin.');
    origins.add(url.origin);
  }
  for (const value of (env.LOCAL_DEV_ORIGINS || '').split(',').filter(Boolean)) {
    const url = exactOrigin(value.trim());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('LOCAL_DEV_ORIGINS must be loopback origins.');
    origins.add(url.origin);
  }
  const host = env.HOST || (publicMode ? '0.0.0.0' : '127.0.0.1');
  if (!['0.0.0.0', '127.0.0.1', '::1'].includes(host)) throw new Error('Invalid HOST.');
  return {
    host, port: integer(env, 'PORT', 4000, 65535), origins,
    trustProxy: env.RENDER === 'true' ? 1 : false,
    apiLimit: integer(env, 'API_REQUESTS_PER_MINUTE', 300),
    aiLimit: integer(env, 'AI_REQUESTS_PER_CLIENT', publicMode ? 3 : 30),
    aiWindowMs: integer(env, 'AI_CLIENT_WINDOW_SECONDS', 600, 86400) * 1000,
    classroomLimit: lifetimeCeiling(env, 'CLASSROOM_AI_REQUEST_LIMIT', 50),
    providerLimit: lifetimeCeiling(env, 'CLASSROOM_PROVIDER_CALL_LIMIT', 200),
    concurrentLimit: integer(env, 'AI_MAX_CONCURRENT', 2, 20),
    providerTimeoutMs: integer(env, 'AI_PROVIDER_TIMEOUT_MS', 45000, 60000),
    responseTimeoutMs: integer(env, 'AI_RESPONSE_TIMEOUT_MS', 180000, 300000)
  };
}

function createGuard(config, now = Date.now) {
  const clients = new Map();
  let jobs = 0, providerCalls = 0, active = 0;
  function reject(res, message, retry = 60) {
    res.setHeader('Retry-After', String(retry));
    res.status(429).json({ error: message });
    return null;
  }
  function client(req) {
    const time = now();
    for (const [key, value] of clients) if (value.last + Math.max(60000, config.aiWindowMs) <= time) clients.delete(key);
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    let value = clients.get(key);
    if (!value) {
      if (clients.size >= 10000) return null; // Fail closed rather than evicting active counters.
      value = { apiStart: time, api: 0, aiStart: time, ai: 0, last: time };
      clients.set(key, value);
    }
    value.last = time;
    if (value.apiStart + 60000 <= time) { value.apiStart = time; value.api = 0; }
    if (value.aiStart + config.aiWindowMs <= time) { value.aiStart = time; value.ai = 0; }
    return value;
  }
  function middleware(req, res, next) {
    const origin = req.headers.origin;
    if (origin && !config.origins.has(origin)) return res.status(403).json({ error: 'This frontend origin is not approved.' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Expose-Headers', 'X-Demo-Session, Retry-After');
    }
    if (req.method === 'OPTIONS') {
      const method = req.headers['access-control-request-method'];
      const headers = (req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(h => h.trim()).filter(Boolean);
      if (!['GET', 'POST', 'HEAD'].includes(method) || headers.some(h => !['content-type', 'x-demo-session'].includes(h))) return res.status(403).json({ error: 'Preflight method or headers are not approved.' });
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Demo-Session');
      res.setHeader('Access-Control-Max-Age', '600');
      return res.status(204).end();
    }
    const value = client(req);
    if (!value || ++value.api > config.apiLimit) return reject(res, 'Too many requests. Please wait a minute and try again.');
    next();
  }
  function tryAcquireAI(req) {
    const value = client(req);
    if ((config.classroomLimit !== null && jobs >= config.classroomLimit) || (config.providerLimit !== null && providerCalls >= config.providerLimit)) return { error: 'The classroom AI allowance has been reached. Catalog and account services remain available.', retry: 600 };
    if (!value || value.ai >= config.aiLimit) return { error: 'Please pause before another AI research request. Catalog and account services remain available.', retry: Math.ceil(config.aiWindowMs / 1000) };
    if (active >= config.concurrentLimit) return { error: 'The AI service is busy. Please try again shortly.', retry: 15 };
    value.ai++;
    if (config.classroomLimit !== null) jobs++;
    active++;
    let released = false;
    return { release: () => { if (!released) { released = true; active--; } } };
  }
  function acquireAI(req, res) {
    const result = tryAcquireAI(req);
    return result.error ? reject(res, result.error, result.retry) : result.release;
  }
  function admitProviderCall() {
    if (config.providerLimit !== null) {
      if (providerCalls >= config.providerLimit) return false;
      providerCalls++;
    }
    return true;
  }
  return { middleware, acquireAI, tryAcquireAI, admitProviderCall };
}
module.exports = { configuration, createGuard };
