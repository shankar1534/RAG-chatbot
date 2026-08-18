const { searchRelevantChunks, getDocumentStats } = require('../services/searchService');
(async () => {
  try {
    const query = 'What did Shankar do at SANA Software (BEL)?';
    const stats = getDocumentStats();
    console.log('STATS', stats);
    const results = searchRelevantChunks(query, { topK: 4 });
    console.log('RESULTS', JSON.stringify(results, null, 2));
  } catch (err) {
    console.error('ERROR', err);
  }
})();
