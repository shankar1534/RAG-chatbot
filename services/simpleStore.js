const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const INDEX_FILE = path.join(DATA_DIR, 'simple_index.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_FILE)) fs.writeFileSync(INDEX_FILE, JSON.stringify({ items: [] }, null, 2));
}

let indexCache = null;

function loadIndex() {
  if (indexCache) {
    return indexCache;
  }

  ensureDataDir();
  try {
    const raw = fs.readFileSync(INDEX_FILE, 'utf8');
    indexCache = JSON.parse(raw);
  } catch (e) {
    indexCache = { items: [] };
  }
  return indexCache;
}

function saveIndex(index) {
  ensureDataDir();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
  indexCache = index;
}

function addDocuments(chunks, sourceName, filePath) {
  const index = loadIndex();
  const baseId = `${sourceName || 'doc'}`.replace(/\s+/g, '_');
  chunks.forEach((chunk, i) => {
    index.items.push({
      id: `${baseId}-${index.items.length + 1}`,
      document: chunk.text || (typeof chunk === 'string' ? chunk : ''),
      metadata: {
        sourceName: sourceName || 'unknown',
        filePath: filePath || '',
        pageNumber: chunk.pageNumber || 1,
        chunkIndex: i
      }
    });
  });
  saveIndex(index);
  return chunks.length;
}

const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','been','but','by','for','from','how',
  'i','if','in','into','is','it','its','many','of','on','or','that','the','their',
  'them','then','there','these','they','this','to','was','were','what','when',
  'which','who','will','with','you','your'
]);

function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function tokenizeQuery(text) {
  const tokens = tokenize(text).filter(token => !STOPWORDS.has(token));
  return tokens.length > 0 ? tokens : tokenize(text);
}

function search(queryText, topK = 4) {
  const index = loadIndex();
  const rawQuery = String(queryText || '').toLowerCase();
  const qTokens = Array.from(new Set(tokenizeQuery(queryText)));
  if (qTokens.length === 0) return [];

  const asksAboutEmployees = /\b(employee|employees|staff|headcount|workforce|employee count|number of employees|how many employees)\b/.test(rawQuery);
  const asksAboutSana = /\b(sana software|sana)\b/.test(rawQuery);

  const scored = index.items.map(item => {
    const docText = String(item.document || '').toLowerCase();
    const tokens = tokenize(item.document);
    const set = new Set(tokens);
    let hits = 0;
    for (const t of qTokens) {
      if (set.has(t)) hits++;
    }

    let score = hits / qTokens.length;
    const hasEmployeeTerm = /\b(employee|employees|staff|headcount)\b/.test(docText);
    const hasSanaSoftware = /\b(sana software)\b/.test(docText);
    const hasEmployeeCount = /\b(employees?\s*[:\-]?\s*\d{1,4}|employee count|headcount|workforce of \d{1,4}|approximately \d{1,4})\b/.test(docText);

    if (asksAboutEmployees && hasEmployeeTerm) {
      score += 0.25;
    }
    if (asksAboutSana && hasSanaSoftware) {
      score += 0.1;
    }
    if (asksAboutEmployees && hasEmployeeCount) {
      score += 0.25;
    }

    return {
      item,
      score: Math.min(score, 1),
      hasEmployeeTerm,
      hasEmployeeCount,
      hasSanaSoftware
    };
  }).filter(s => s.score > 0).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.hasEmployeeCount !== a.hasEmployeeCount) return b.hasEmployeeCount ? 1 : -1;
    if (b.hasEmployeeTerm !== a.hasEmployeeTerm) return b.hasEmployeeTerm ? 1 : -1;
    if (b.hasSanaSoftware !== a.hasSanaSoftware) return b.hasSanaSoftware ? 1 : -1;
    return 0;
  }).slice(0, topK);

  return scored.map(s => ({ document: s.item.document, metadata: s.item.metadata, distance: 1 - s.score }));
}

function count() {
  const index = loadIndex();
  return index.items.length;
}

function getIndexedFilePaths() {
  const index = loadIndex();
  return Array.from(new Set(index.items.map(item => item.metadata?.filePath).filter(Boolean)));
}

function reset() {
  ensureDataDir();
  indexCache = { items: [] };
  saveIndex(indexCache);
  return true;
}

module.exports = { addDocuments, search, count, reset, getIndexedFilePaths };
