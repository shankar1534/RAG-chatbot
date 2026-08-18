const https = require('https');
const http = require('http');

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const payload = JSON.stringify(body);
    const req = client.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        const trimmed = data.trim();
        if (!trimmed) {
          resolve({});
          return;
        }

        try {
          const parsed = JSON.parse(trimmed);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error || 'Embedding request failed'));
            return;
          }
          resolve(parsed);
        } catch (error) {
          resolve({ raw: trimmed });
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function createEmbedding(text) {
  const model = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
  const url = `${process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'}/api/embeddings`;
  const response = await postJson(url, {
    model,
    prompt: text
  });

  if (response.embedding && Array.isArray(response.embedding)) {
    return response.embedding;
  }

  if (response.raw && response.raw.includes('embedding')) {
    try {
      const parsed = JSON.parse(response.raw);
      if (parsed.embedding && Array.isArray(parsed.embedding)) {
        return parsed.embedding;
      }
    } catch (error) {
      // fall through to a friendly error below
    }
  }

  throw new Error('Ollama did not return an embedding array.');
}

module.exports = { createEmbedding };
