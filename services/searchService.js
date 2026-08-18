const simpleStore = require('./simpleStore');

function addChunksToStore(payload) {
  const stored = simpleStore.addDocuments(payload.chunks || [], payload.sourceName || 'unknown', payload.filePath || '');
  return { stored: true, output: `simpleStore:${stored}` };
}

function searchRelevantChunks(queryText, options = {}) {
  const topK = options.topK || 4;
  try {
    const results = simpleStore.search(queryText || '', topK);
    return results.map(item => ({
      text: item.document,
      sourceName: item.metadata?.sourceName || 'unknown',
      pageNumber: item.metadata?.pageNumber || 1,
      filePath: item.metadata?.filePath || null,
      score: item.distance != null ? 1 - item.distance : 0
    }));
  } catch (e) {
    console.error('[ERROR] simpleStore search failed:', e && e.message ? e.message : e);
    return [];
  }
}

function getDocumentStats() {
  const count = simpleStore.count();
  return { totalChunks: count, documents: [] };
}

function getIndexedFilePaths() {
  return simpleStore.getIndexedFilePaths();
}

function clearStore() {
  simpleStore.reset();
}

module.exports = { addChunksToStore, searchRelevantChunks, getDocumentStats, clearStore, getIndexedFilePaths };
