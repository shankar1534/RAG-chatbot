function chunkText(text, metadata = {}) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const normalized = text.replace(/\s+/g, ' ').trim();
  const maxChars = metadata.maxChars || 1200;
  const overlap = metadata.overlap || 180;
  const chunks = [];

  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);

    if (end < normalized.length) {
      const lastSpace = normalized.lastIndexOf(' ', end);
      if (lastSpace > start + Math.floor(maxChars * 0.5)) {
        end = lastSpace;
      }
    }

    const chunkText = normalized.slice(start, end).trim();
    if (chunkText) {
      chunks.push({
        text: chunkText,
        sourceName: metadata.sourceName || 'unknown',
        pageNumber: metadata.pageNumber || null,
        filePath: metadata.filePath || null
      });
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}

module.exports = { chunkText };
