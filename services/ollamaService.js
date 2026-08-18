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
            reject(new Error(parsed.error || 'Ollama request failed'));
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

async function generateAnswer(prompt, options = {}) {
  const model = options.model || process.env.OLLAMA_CHAT_MODEL || 'llama3.2';
  const url = `${process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'}/api/generate`;
  const response = await postJson(url, {
    model,
    prompt,
    stream: false
  });

  if (response.response) {
    return response.response;
  }

  if (response.raw) {
    return response.raw;
  }

  throw new Error('Ollama returned an empty response.');
}

module.exports = { generateAnswer };
