const Groq = require('groq-sdk');

const ROUTING_PROMPT = `You route voice notes for Blurt, a voice note app for books and custom lists.

Given a transcript, books/chapters, and custom lists, decide where to file the note.

CRITICAL — noteText:
- noteText is ONLY the annotation content the user wants to keep.
- STRIP all routing/instruction phrases completely. Examples to remove:
  - "add this to East of Eden part one"
  - "put this under Miscellaneous"
  - "new book called Dune"
  - "create a list called To-do"
- If the user says: "Add this to East of Eden part one, I love this passage about brothers"
  → noteText MUST be: "I love this passage about brothers" (nothing about East of Eden or "add this")
- Never include book names, list names, or filing instructions in noteText unless they ARE the actual note content.

Creation (when user asks to create something new):
- createBookTitle: string or null — if user wants a new book
- createChapterTitle: string or null — if user wants a new chapter under that book
- createListTitle: string or null — if user wants a new custom list (e.g. "To-do", "Shopping")

Routing:
- destinationBookId + destinationChapterId for books (from provided list)
- destinationListId for custom lists (from provided list)
- Use Miscellaneous (defaultListId/defaultBookId) when no match
- confidence "high" only if user explicitly named the destination
- confidence "medium" if inferred
- confidence "low" if no signal — use defaults
- Never invent IDs — only use provided IDs unless creating new items

Respond with JSON only:
{
  "destinationBookId": "string or null",
  "destinationChapterId": "string or null",
  "destinationListId": "string or null",
  "createBookTitle": "string or null",
  "createChapterTitle": "string or null",
  "createListTitle": "string or null",
  "noteText": "string",
  "confidence": "high" | "medium" | "low",
  "reasoning": "string"
}`;

function stripRoutingPrefixes(transcript, noteText) {
  const t = transcript.trim();
  let text = (noteText || '').trim();
  if (text && text.length < t.length * 0.92 && text.length > 3) return text;
  text = t;
  const patterns = [
    /^(?:add this to|put this (?:in|under)|save this to|file this (?:in|under)|note for|add to)\s+(?:books?\s+)?[^,.:;\-–—]+[,.:;\-–—]\s*/i,
    /^(?:new book(?: called)?|create a book(?: called)?)\s+[^,.:;\-–—]+[,.:;\-–—]\s*/i,
    /^(?:new list(?: called)?|create a (?:new )?list(?: called)?)\s+[^,.:;\-–—]+[,.:;\-–—]\s*/i,
    /^(?:under|in)\s+(?:books?\s+)?[^,.:;\-–—]+[,.:;\-–—]\s*/i,
  ];
  for (const p of patterns) {
    const next = text.replace(p, '').trim();
    if (next && next.length < text.length) {
      text = next;
      break;
    }
  }
  return text.trim();
}

function validateRoute(parsed, books, lists, defaultBookId, defaultChapterId, defaultListId) {
  const bookIds = new Set(books.map(b => b.id));
  const listIds = new Set(lists.map(l => l.id));

  let destinationBookId = parsed.destinationBookId || null;
  let destinationChapterId = parsed.destinationChapterId ?? null;
  let destinationListId = parsed.destinationListId || null;
  let confidence = parsed.confidence || 'low';

  if (destinationListId && listIds.has(destinationListId)) {
    destinationBookId = null;
    destinationChapterId = null;
  } else if (destinationBookId && bookIds.has(destinationBookId)) {
    destinationListId = null;
    const book = books.find(b => b.id === destinationBookId);
    const chapterIds = new Set((book?.chapters || []).map(c => c.id));
    if (destinationChapterId && !chapterIds.has(destinationChapterId)) {
      destinationChapterId = defaultChapterId ?? null;
      if (confidence === 'high') confidence = 'medium';
    }
  } else {
    if (defaultListId && listIds.has(defaultListId)) {
      destinationListId = defaultListId;
      destinationBookId = null;
      destinationChapterId = null;
    } else {
      destinationBookId = defaultBookId;
      destinationChapterId = defaultChapterId ?? null;
      destinationListId = null;
    }
    confidence = 'low';
  }

  return {
    destinationBookId,
    destinationChapterId,
    destinationListId,
    createBookTitle: parsed.createBookTitle || null,
    createChapterTitle: parsed.createChapterTitle || null,
    createListTitle: parsed.createListTitle || null,
    noteText: (parsed.noteText || '').trim(),
    confidence,
    reasoning: parsed.reasoning || '',
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured' });
  }

  const {
    transcript,
    books = [],
    lists = [],
    defaultBookId = null,
    defaultChapterId = null,
    defaultListId = null,
  } = req.body || {};

  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'Missing transcript' });
  }

  try {
    const groq = new Groq({ apiKey });
    const userPayload = JSON.stringify({
      transcript,
      defaultBookId,
      defaultChapterId,
      defaultListId,
      books: books.map(b => ({
        id: b.id,
        title: b.title,
        chapters: (b.chapters || []).map(c => ({ id: c.id, title: c.title })),
      })),
      lists: lists.map(l => ({ id: l.id, title: l.title })),
    });

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: ROUTING_PROMPT },
        { role: 'user', content: userPayload },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: 'LLM returned invalid JSON', raw });
    }

    const route = validateRoute(parsed, books, lists, defaultBookId, defaultChapterId, defaultListId);
    route.noteText = stripRoutingPrefixes(transcript.trim(), route.noteText);

    if (!route.noteText) {
      route.noteText = transcript.trim();
    }

    return res.status(200).json(route);
  } catch (err) {
    console.error('route error:', err);
    const status = err.status || err.statusCode || 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: err.message || 'Routing failed',
    });
  }
};
