const path = require('path');
const fs = require('fs');
const vm = require('vm');
const express = require('express');
const dotenv = require('dotenv');

const { buildSystemPrompt } = require('./pericles/prompts/build-system-prompt');
const { buildGroundingContext } = require('./pericles/prompts/build-grounding-context');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function loadCatalogSeedEntries() {
  try {
    const filePath = path.resolve(__dirname, 'catalog-data.js');
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const source = fs.readFileSync(filePath, 'utf8');
    const context = {};
    vm.createContext(context);
    vm.runInContext(`${source}\nglobalThis.__seed = typeof CATALOG_SEED_ENTRIES !== 'undefined' ? CATALOG_SEED_ENTRIES : [];`, context);

    if (!Array.isArray(context.__seed)) {
      return [];
    }

    return context.__seed.map((entry) => {
      const searchableText = [
        entry.title,
        entry.author,
        entry.callNumber,
        entry.genre,
        entry.format,
        entry.audience,
        entry.location,
        ...(entry.subjects || []),
        entry.description
      ].join(' ').toLowerCase();

      return { ...entry, searchableText };
    });
  } catch (_error) {
    return [];
  }
}

const CATALOG_SEED_INDEX = loadCatalogSeedEntries();
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'what', 'when', 'where', 'about', 'have', 'how', 'your', 'you', 'are', 'can', 'into', 'than']);

function tokenizeQuery(query) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function scoreCatalogEntry(entry, query, tokens) {
  let score = 0;
  const normalizedQuery = query.toLowerCase();
  const title = String(entry.title || '').toLowerCase();
  const author = String(entry.author || '').toLowerCase();
  const callNumber = String(entry.callNumber || '').toLowerCase();
  const searchableText = entry.searchableText;

  if (normalizedQuery && title.includes(normalizedQuery)) score += 14;
  if (normalizedQuery && author.includes(normalizedQuery)) score += 10;
  if (normalizedQuery && callNumber.includes(normalizedQuery)) score += 8;

  tokens.forEach((token) => {
    if (title.includes(token)) score += 4;
    if (author.includes(token)) score += 3;
    if (searchableText.includes(token)) score += 2;
  });

  return score;
}

function findCatalogMatches(query, limit = 6) {
  const tokens = tokenizeQuery(query);
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery || (!tokens.length && normalizedQuery.length < 4)) return [];

  return CATALOG_SEED_INDEX
    .map((entry) => ({ entry, score: scoreCatalogEntry(entry, normalizedQuery, tokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.entry);
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.resolve(__dirname)));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    assistant: 'Pericles',
    liveAiConfigured: Boolean(OPENAI_API_KEY),
    model: OPENAI_MODEL,
    catalogSeedCount: CATALOG_SEED_INDEX.length
  });
});

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .slice(-10)
    .map((item) => ({ role: item.role, content: item.content }));
}

app.post('/api/chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const history = normalizeHistory(req.body?.history);

  if (!message) return res.status(400).json({ error: 'Message is required.' });
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured.' });

  const catalogMatches = findCatalogMatches(message, 6);
  const groundingContext = buildGroundingContext({ catalogMatches });

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'system', content: `# Verified SPL Grounding Context\n\n${groundingContext}` },
    ...history,
    { role: 'user', content: message }
  ];

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        temperature: 0.35,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(502).json({ error: `LLM request failed: ${errorText}` });
    }

    const payload = await response.json();
    const reply = payload?.choices?.[0]?.message?.content?.trim();
    if (!reply) return res.status(502).json({ error: 'No reply returned by model.' });

    return res.json({ reply });
  } catch (_error) {
    return res.status(500).json({ error: 'Chat service failed to respond.' });
  }
});

app.listen(PORT, () => {
  console.log(`Stapleton Public Library portal running at http://localhost:${PORT}`);
});
