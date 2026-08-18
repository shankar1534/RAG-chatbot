const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

// Multer — store uploaded files in /uploads, accept PDF/DOCX/TXT only
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${ext}. Only PDF, DOCX, and TXT are allowed.`));
  }
});

// ── Session persistence ───────────────────────────────────────────────────────
// sessions: Map<sessionId, { threads: Map<threadId, thread>, activeThreadId }>
// Persisted to data/sessions.json on every write.

const SESSIONS_FILE = path.join(dataDir, 'sessions.json');

// Convert the nested Map structure → plain JSON-serialisable object
function sessionsToJSON(map) {
  const obj = {};
  for (const [sid, sd] of map.entries()) {
    obj[sid] = {
      activeThreadId: sd.activeThreadId,
      updatedAt: sd.updatedAt,
      threads: {}
    };
    for (const [tid, thread] of sd.threads.entries()) {
      obj[sid].threads[tid] = thread;
    }
  }
  return obj;
}

// Restore plain JSON object → nested Map structure
function sessionsFromJSON(obj) {
  const map = new Map();
  for (const [sid, sd] of Object.entries(obj || {})) {
    const threadsMap = new Map();
    for (const [tid, thread] of Object.entries(sd.threads || {})) {
      threadsMap.set(tid, thread);
    }
    map.set(sid, {
      activeThreadId: sd.activeThreadId || null,
      updatedAt: sd.updatedAt || Date.now(),
      threads: threadsMap
    });
  }
  return map;
}

// Load sessions from disk on startup
function loadSessionsFromDisk() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
      return sessionsFromJSON(JSON.parse(raw));
    }
  } catch (e) {
    console.error('[WARN] Could not load sessions.json, starting fresh:', e.message);
  }
  return new Map();
}

// Write sessions to disk (synchronous — keeps it simple, file is small)
function flushSessionsToDisk() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsToJSON(sessions), null, 2), 'utf8');
  } catch (e) {
    console.error('[WARN] Could not save sessions.json:', e.message);
  }
}

const sessions = loadSessionsFromDisk();

function getSessionData(sessionId) {
  if (!sessionId) return { history: [], threads: new Map(), activeThreadId: null };
  return sessions.get(sessionId) || { history: [], threads: new Map(), activeThreadId: null };
}

function saveSessionData(sessionId, data) {
  if (!sessionId) return;
  const existing = getSessionData(sessionId);
  sessions.set(sessionId, {
    threads:        data.threads        ?? existing.threads,
    activeThreadId: data.activeThreadId !== undefined ? data.activeThreadId : existing.activeThreadId,
    updatedAt: Date.now()
  });
  flushSessionsToDisk();
}

function getOrCreateActiveThread(sessionId) {
  const sd = getSessionData(sessionId);
  if (sd.activeThreadId && sd.threads.has(sd.activeThreadId)) {
    return sd.threads.get(sd.activeThreadId);
  }
  // Create a brand-new thread
  const threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const thread = {
    id: threadId,
    title: '',
    messages: [],
    source: 'general',
    sources: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  sd.threads.set(threadId, thread);
  saveSessionData(sessionId, { threads: sd.threads, activeThreadId: threadId });
  return thread;
}

// Serialize threads Map → sorted array for API responses
function serializeThreads(threads) {
  return Array.from(threads.values()).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}


const { extractTextFromPdf } = require('./services/pdfReader');
const { extractTextFromDocx } = require('./services/docReader');
const { chunkText } = require('./services/chunkService');
const { addChunksToStore, searchRelevantChunks, getDocumentStats, clearStore } = require('./services/searchService');
const { generateAnswer } = require('./services/ollamaService');

function log(message, level = 'info') {
  const prefix = level.toUpperCase();
  console.log(`[${prefix}] ${message}`);
}

function isIdentityQuestion(message) {
  const normalized = message.toLowerCase().trim();
  return /^(who|what)\s+(are|is)\s+(you|u)\b/i.test(normalized)
    || /^who\s+u\s+are\b/i.test(normalized)
    || /^who\s+are\s+you\b/i.test(normalized)
    || /^who\s+are\s+u\b/i.test(normalized)
    || /^what\s+is\s+(your|ur)\s+name\b/i.test(normalized)
    || /^introduce\s+yourself\b/i.test(normalized)
    || /^tell\s+me\s+about\s+yourself\b/i.test(normalized)
    || /^what\s+can\s+you\s+do\b/i.test(normalized);
}

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Offline AI assistant is running.' });
});

// ── New Chat ─────────────────────────────────────────────────────────────────
// Clears the activeThreadId so the next message automatically creates a new thread.
app.post('/api/new-chat', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
  const sd = getSessionData(sessionId);
  saveSessionData(sessionId, { threads: sd.threads, activeThreadId: null });
  res.json({ success: true, sessionId });
});

// ── Add Text ─────────────────────────────────────────────────────────────────
app.post('/api/add-text', async (req, res) => {
  try {
    const { content, sourceName } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Document content is required.' });
    }

    clearStore();
    const text = content.trim();
    const fileName = `pasted-document-${Date.now()}.txt`;
    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, text, 'utf8');

    const metadata = {
      sourceName: sourceName || 'pasted-document',
      pageNumber: 1,
      filePath
    };

    const chunks = chunkText(text, metadata);
    if (chunks.length === 0) {
      return res.status(400).json({ error: 'No valid text was found to index.' });
    }

    addChunksToStore({
      sourceName: metadata.sourceName,
      filePath: metadata.filePath,
      chunks
    });

    log(`Indexed pasted document content (${chunks.length} chunks) from ${fileName}.`);
    res.json({ success: true, document: { sourceName: metadata.sourceName, chunkCount: chunks.length, fileName }, stats: getDocumentStats() });
  } catch (error) {
    log(error.message, 'error');
    res.status(500).json({ error: error.message || 'Unable to index text content.' });
  }
});

// ── File Upload ───────────────────────────────────────────────────────────────
app.post('/api/upload', upload.array('files', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files were uploaded.' });
    }

    // Do NOT clear the store — new files are added on top of existing index
    const results = [];

    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const sourceName = file.originalname;
      let extracted;

      try {
        if (ext === '.pdf') {
          extracted = await extractTextFromPdf(file.path);
        } else if (ext === '.docx') {
          extracted = await extractTextFromDocx(file.path);
        } else {
          // TXT
          const raw = fs.readFileSync(file.path, 'utf8');
          extracted = { text: raw, pages: [{ pageNumber: 1, text: raw }] };
        }
      } catch (extractErr) {
        log(`Failed to extract text from ${sourceName}: ${extractErr.message}`, 'error');
        results.push({ sourceName, success: false, error: extractErr.message });
        continue;
      }

      // Index page-by-page so page numbers are preserved
      let totalChunks = 0;
      for (const page of extracted.pages) {
        if (!page.text || !page.text.trim()) continue;
        const metadata = {
          sourceName,
          pageNumber: page.pageNumber,
          filePath: file.path
        };
        const chunks = chunkText(page.text, metadata);
        if (chunks.length > 0) {
          addChunksToStore({ sourceName, filePath: file.path, chunks });
          totalChunks += chunks.length;
        }
      }

      log(`Indexed "${sourceName}" — ${totalChunks} chunks.`);
      results.push({ sourceName, success: true, chunkCount: totalChunks });
    }

    const anySuccess = results.some(r => r.success);
    if (!anySuccess) {
      return res.status(422).json({ error: 'No text could be extracted from the uploaded file(s).', results });
    }

    res.json({ success: true, results, stats: getDocumentStats() });
  } catch (error) {
    log(error.message, 'error');
    res.status(500).json({ error: error.message || 'Upload failed.' });
  }
});

// ── Indexed files list ────────────────────────────────────────────────────────
app.get('/api/indexed-files', (req, res) => {
  const { getIndexedFilePaths } = require('./services/searchService');
  const stats = getDocumentStats();
  const filePaths = getIndexedFilePaths();
  // Extract original file names from paths
  const fileNames = Array.from(new Set(filePaths.map(fp => path.basename(fp))));
  res.json({ files: fileNames, totalChunks: stats.totalChunks });
});

// ── Chat ──────────────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'A non-empty message is required.' });
    }

    const activeSessionId = sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Get or create the active thread for this session
    const thread = getOrCreateActiveThread(activeSessionId);

    // Build history context from this thread's messages only
    const historyContext = thread.messages.slice(-8).map(m => `${m.role}: ${m.content}`).join('\n');

    log(`[${thread.id}] Received: ${message}`);

    // Add user message to thread
    thread.messages.push({ role: 'user', content: message });
    if (!thread.title) {
      thread.title = message.slice(0, 60);
    }

    let reply;
    let answerSource = 'general';
    let sources = [];
    // Minimum relevance score for a chunk to be considered truly on-topic (Tier 1)
    const RELEVANCE_THRESHOLD = parseFloat(process.env.RELEVANCE_THRESHOLD || '0.3');

    if (isIdentityQuestion(message)) {
      reply = 'I am Sana AI Assistant, your offline AI assistant. I can help you chat, answer questions, and work with your uploaded documents locally.';
    } else {
      const allChunks = searchRelevantChunks(message, { topK: 4 });
      // Only keep chunks that are genuinely relevant
      const relevantChunks = allChunks.filter(c => c.score >= RELEVANCE_THRESHOLD);

      let prompt;

      if (relevantChunks.length > 0) {
        // ── TIER 1: Try to answer from the uploaded document first ─────────────
        // If the document context does not cover the question, the LLM must fall
        // back to general knowledge (Tier 2) or admit it doesn't know (Tier 3).
        const contextText = relevantChunks
          .map((chunk, index) => `[Source ${index + 1}] ${chunk.sourceName} (page ${chunk.pageNumber || 'unknown'})\n${chunk.text}`)
          .join('\n\n');
        prompt = `You are an offline AI assistant. Answer the user's question using the following 3-tier strategy:

TIER 1 — If the document context below clearly answers the question, answer from it concisely and cite the source.
TIER 2 — If the document context does NOT answer the question, answer from your general knowledge directly and naturally without any prefix or disclaimer.
TIER 3 — If neither the document context nor your general knowledge can answer reliably (niche, legacy, or uncertain topic), respond with exactly: "I don't have verified information about this. Please share relevant documentation so I can give you an accurate answer."

Remember the conversation context when the user refers to earlier turns.

Conversation context:
${historyContext}

Document context:
${contextText}

User question: ${message}`;
        answerSource = 'documents';
        sources = relevantChunks.map(chunk => ({ fileName: chunk.sourceName, pageNumber: chunk.pageNumber || null }));
        // Deduplicate sources
        const seen = new Set();
        sources = sources.filter(s => {
          const key = `${s.fileName}::${s.pageNumber || ''}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      } else {
        // ── TIER 2 / TIER 3: No document chunks at all ────────────────────────
        prompt = `You are an offline AI assistant. Answer the user's question using the following 2-tier strategy:

TIER 2 — Answer from your general knowledge directly and naturally if you are confident the answer is accurate. Do not add any prefix or disclaimer.
TIER 3 — If the topic is niche, legacy, specialised, or you are not confident, respond with exactly: "I don't have verified information about this. Please share relevant documentation so I can give you an accurate answer."

Remember the conversation context when the user refers to earlier turns.

Conversation context:
${historyContext}

User question: ${message}`;
        answerSource = 'general';
      }

      try {
        reply = await generateAnswer(prompt, { model: process.env.OLLAMA_CHAT_MODEL || 'llama3.2' });
      } catch (ollamaError) {
        reply = `I could not generate a response from Ollama. ${ollamaError.message}`;
      }
    }

    // Persist assistant reply in thread
    thread.messages.push({ role: 'assistant', content: reply });
    thread.source = answerSource;
    thread.sources = sources.map(s => s.fileName);
    thread.updatedAt = new Date().toISOString();

    // Save thread back into session
    const sd = getSessionData(activeSessionId);
    sd.threads.set(thread.id, thread);
    saveSessionData(activeSessionId, { threads: sd.threads });

    // Derive the tier number for the client
    const tier = answerSource === 'documents' ? 1 : 2;

    res.json({
      answer: reply,
      source: answerSource,
      tier,
      sources,
      threadId: thread.id,
      sessionId: activeSessionId,
      message: 'Response generated successfully.'
    });
  } catch (error) {
    log(error.message, 'error');
    res.status(500).json({ error: error.message || 'Unable to generate a response.' });
  }
});

// ── History (all threads) ────────────────────────────────────────────────────
app.get('/api/history', (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
  const sd = getSessionData(sessionId);
  res.json({
    threads: serializeThreads(sd.threads),
    activeThreadId: sd.activeThreadId || null
  });
});

// ── Get a single thread's messages ──────────────────────────────────────────
app.get('/api/thread', (req, res) => {
  const { sessionId, threadId } = req.query;
  if (!sessionId || !threadId) return res.status(400).json({ error: 'sessionId and threadId are required' });
  const sd = getSessionData(sessionId);
  const thread = sd.threads.get(threadId);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });
  res.json({ thread });
});

// ── Switch to an existing thread ─────────────────────────────────────────────
app.post('/api/switch-thread', (req, res) => {
  const { sessionId, threadId } = req.body;
  if (!sessionId || !threadId) return res.status(400).json({ error: 'sessionId and threadId are required' });
  const sd = getSessionData(sessionId);
  if (!sd.threads.has(threadId)) return res.status(404).json({ error: 'Thread not found' });
  saveSessionData(sessionId, { threads: sd.threads, activeThreadId: threadId });
  const thread = sd.threads.get(threadId);
  res.json({ success: true, thread });
});

// ── Delete a single thread ───────────────────────────────────────────────────
app.delete('/api/thread', (req, res) => {
  const { sessionId, threadId } = req.query;
  if (!sessionId || !threadId) return res.status(400).json({ error: 'sessionId and threadId are required' });
  const sd = getSessionData(sessionId);
  sd.threads.delete(threadId);
  const newActiveId = sd.activeThreadId === threadId ? null : sd.activeThreadId;
  saveSessionData(sessionId, { threads: sd.threads, activeThreadId: newActiveId });
  res.json({ success: true });
});

// ── Clear all history ────────────────────────────────────────────────────────
app.delete('/api/history', (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
  saveSessionData(sessionId, { threads: new Map(), activeThreadId: null });
  res.json({ success: true });
});

// ── SPA fallback ─────────────────────────────────────────────────────────────
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  log(`Server listening on http://localhost:${PORT}`);
  log('Make sure Ollama is installed and running locally if you want full model-backed responses.');
});
