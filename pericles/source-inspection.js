'use strict';

const https = require('node:https');
const dns = require('node:dns').promises;
const { BlockList } = require('node:net');

// Bounded public-institution inspection, never a general URL-fetch endpoint.
const INSPECTION_HOSTS = new Set([
  'www.in.gov', 'in.gov', 'archives.iu.edu', 'webapp1.dlib.indiana.edu',
  'indianamemory.contentdm.oclc.org', 'dmr.bsu.edu', 'digitalcollections.library.iu.edu',
  'archive.org', 'www.archive.org', 'babel.hathitrust.org', 'catalog.hathitrust.org',
  'www.gutenberg.org', 'www.loc.gov', 'www.digitalindy.org'
]);
const privateAddresses = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) privateAddresses.addSubnet(address, prefix, 'ipv4');

function canInspect(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && INSPECTION_HOSTS.has(url.hostname);
  } catch (_) { return false; }
}

function htmlText(html) {
  return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/g, entity => ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' })[entity])
    .replace(/&#(\d+);/g, (_, code) => Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : ' ')
    .replace(/\s+/g, ' ').trim();
}

async function inspectSource(url, redirects = 0) {
  if (!canInspect(url)) return '';
  try {
    const target = new URL(url);
    const addresses = await dns.lookup(target.hostname, { family: 4, all: true });
    const address = addresses.find(item => !privateAddresses.check(item.address, 'ipv4'));
    if (!address) return '';
    const result = await new Promise(resolve => {
      // Pin the validated public address; do not re-resolve during connection.
      const request = https.get(target, {
        headers: { Accept: 'text/html,text/plain', 'User-Agent': 'Pericles-Library-Research/1.0' },
        lookup: (_host, options, callback) => callback(null, options.all ? [address] : address.address, options.all ? undefined : 4)
      }, response => {
        if (response.statusCode >= 300 && response.statusCode < 400) {
          response.resume(); resolve({ redirect: response.headers.location }); return;
        }
        if (response.statusCode !== 200 || !/^text\/(html|plain)/i.test(response.headers['content-type'] || '')) {
          response.resume(); resolve({}); return;
        }
        const chunks = []; let bytes = 0;
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 512000) { response.destroy(); resolve({}); } else chunks.push(chunk);
        });
        response.on('end', () => resolve({ text: htmlText(Buffer.concat(chunks).toString('utf8')).slice(0, 24000) }));
        response.on('error', () => resolve({}));
      });
      const deadline = setTimeout(() => { request.destroy(); resolve({}); }, 7000);
      request.on('close', () => clearTimeout(deadline));
      request.on('error', () => resolve({}));
    });
    if (result.redirect && redirects < 2) return inspectSource(new URL(result.redirect, url).href, redirects + 1);
    return result.text || '';
  } catch (_) { return ''; }
}

async function enrichSources(registry, records, remaining, inspect = inspectSource) {
  const ranked = records.filter(record => canInspect(record.url)).sort((a, b) => {
    const score = record => /commission|annual|biennial|report/i.test(JSON.stringify(record)) ? 2 : /librar|archive|history/i.test(JSON.stringify(record)) ? 1 : 0;
    return score(b) - score(a);
  }).slice(0, remaining);
  for (const record of ranked) {
    const pageText = await inspect(record.url);
    if (pageText) registry.records.set(record.sourceId, Object.freeze({ ...record,
      metadata: Object.freeze({ ...record.metadata, pageText }) }));
  }
  return ranked.length;
}

module.exports = { canInspect, htmlText, inspectSource, enrichSources };
