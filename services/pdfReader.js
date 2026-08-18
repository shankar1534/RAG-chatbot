const fs = require('fs');

async function extractTextFromPdf(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF file not found: ${filePath}`);
  }

  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjsLib.getDocument({ url: filePath });
  const pdfDocument = await loadingTask.promise;
  const pages = [];

  for (let index = 1; index <= pdfDocument.numPages; index += 1) {
    const page = await pdfDocument.getPage(index);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    pages.push({ pageNumber: index, text: pageText });
  }

  return {
    text: pages.map((page) => page.text).join('\n\n'),
    pages
  };
}

module.exports = { extractTextFromPdf };
