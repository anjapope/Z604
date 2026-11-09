'use strict';

(function configureAPI(root) {
  const configured = String(root.PERICLES_CONFIG?.backendUrl || '').replace(/\/$/, '');
  if (configured) {
    const url = new URL(configured);
    if (url.origin !== configured || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Configure a public HTTPS backend origin, or a localhost HTTP origin.');
  }
  const key = `pericles-demo-session:${configured || root.location.origin}`;
  let token;
  try { token = root.sessionStorage.getItem(key); } catch (_error) { /* Memory-only fallback. */ }
  async function apiFetch(route, options = {}) {
    if (typeof route !== 'string' || !route.startsWith('/api/') || /[\\#]/.test(route) || !new URL(route, root.location.origin).pathname.startsWith('/api/')) throw new Error('Invalid API route.');
    if (!configured && /\.github\.io$/.test(root.location.hostname)) throw new Error('The service backend URL has not been configured.');
    const headers = new Headers(options.headers || {});
    if (token) headers.set('X-Demo-Session', token);
    const timeout = AbortSignal.timeout(route === '/api/chat' ? 195000 : 30000);
    let response;
    try {
      response = await root.fetch(configured + route, { ...options, headers, credentials: configured && configured !== root.location.origin ? 'omit' : 'same-origin', signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
    } catch (error) {
      throw new Error(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'The service took too long. Please try again later.' : 'The service backend is unavailable. Please try again shortly; no transaction success is confirmed.');
    }
    const next = response.headers.get('X-Demo-Session');
    if (next && /^[a-f0-9]{64}$/.test(next)) {
      token = next;
      try { root.sessionStorage.setItem(key, token); } catch (_error) { /* Memory-only fallback. */ }
    }
    return response;
  }
  root.PericlesApi = {
    fetch: apiFetch,
    catalogUrl: route => new URL(route.replace(/^\//, ''), new URL('.', root.location.href)).href
  };
})(window);
