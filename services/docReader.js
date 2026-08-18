const mammoth = require('mammoth');
const fs = require('fs');

async function extractTextFromDocx(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`DOCX file not found: ${filePath}`);
  }

  const result = await mammoth.extractRawText({ path: filePath });
  const text = result.value.replace(/\s+/g, ' ').trim();

  return {
    text,
    pages: [{ pageNumber: 1, text }]
  };
}

module.exports = { extractTextFromDocx };
