'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assets = require('../pericles/public-assets');
const root = path.resolve(__dirname, '..');
function buildFrontend({ output = path.join(root, 'dist-frontend'), backendUrl = '' } = {}) {
  if (backendUrl) {
    const url = new URL(backendUrl);
    if (url.origin !== backendUrl || url.protocol !== 'https:' || url.username || url.password) throw new Error('PUBLIC_BACKEND_URL must be an HTTPS origin with no path, credentials, or trailing slash.');
  }
  // Never publish stale/unreviewed files from a pre-existing directory.
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Frontend output is not empty. Choose a new empty output directory.');
  fs.mkdirSync(output, { recursive: true });
  for (const asset of assets) {
    const target = path.join(output, asset);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, asset), target);
  }
  if (backendUrl) fs.writeFileSync(path.join(output, 'frontend-config.js'), `window.PERICLES_CONFIG = ${JSON.stringify({ backendUrl })};\n`);
  fs.writeFileSync(path.join(output, '.nojekyll'), '');
  return output;
}
if (require.main === module) {
  const outputIndex = process.argv.indexOf('--output');
  const output = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : undefined;
  console.log(`Prepared frontend only: ${buildFrontend({ output, backendUrl: process.env.PUBLIC_BACKEND_URL || '' })}. Nothing was deployed.`);
}
module.exports = { buildFrontend };
