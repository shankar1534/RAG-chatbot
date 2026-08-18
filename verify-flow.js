const fs = require('fs');
const path = require('path');

async function main() {
  const filePath = path.join(__dirname, 'sample.txt');
  const content = 'This is a test document for indexing.';
  fs.writeFileSync(filePath, content, 'utf8');

  // Use /api/add-text (the actual indexing endpoint) with JSON body
  const uploadRes = await fetch('http://127.0.0.1:3000/api/add-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, sourceName: 'sample.txt' })
  });
  const uploadText = await uploadRes.text();
  console.log('UPLOAD_STATUS', uploadRes.status);
  console.log(uploadText);

  const chatRes = await fetch('http://127.0.0.1:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'what is in the document', sessionId: 'verify-session' })
  });
  const chatText = await chatRes.text();
  console.log('CHAT_STATUS', chatRes.status);
  console.log(chatText);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
