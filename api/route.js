const Groq = require('groq-sdk');

const ROUTING_PROMPT = `You route voice notes for Blurt, a book annotation app.

Given a transcript and a list of books/chapters, decide where to file the note.

Rules:
- confidence "high" ONLY if the user explicitly names a book or chapter (e.g. "add this to East of Eden part one")
- confidence "medium" if you infer the destination from content but the user did not explicitly name it
- confidence "low" if there is no clear signal — use defaultBookId and defaultChapterId
- noteText must be the useful annotation with routing phrases stripped (e.g. remove "add this to Brothers Karamazov chapter three:")
- destinationBookId and destinationChapterId MUST come from the provided books list — never invent IDs
- If the user names a book/chapter that does not exist in the list, use defaults and set confidence to "low"
- destinationChapterId may be null if filing at book level only

Respond with JSON only:
{
  "destinationBookId": "string",
  "destinationChapterId": "string or null",
  "noteText": "string",
  "confidence": "high" | "medium" | "low",
  "reasoning": "brief explanation"
}`;

function validateRoute(parsed, books, defaultBookId, defaultChapterId) {
  const bookIds = new Set(books.map(b => b.id));
  let destinationBookId = parsed.destinationBookId;
  let destinationChapterId = parsed.destinationChapterId ?? null;
  let confidence = parsed.confidence || 'low';

  if (!destinationBookId || !bookIds.has(destinationBookId)) {
    if (destinationBookId && destinationBookId === defaultBookId) {
      destinationChapterId = null;
    } else {
      destinationBookId = defaultBookId;
      destinationChapterId = defaultChapterId ?? null;
      confidence = 'low';
    }
  } else {
    const book = books.find(b => b.id === destinationBookId);
    const chapterIds = new Set((book?.chapters || []).map(c => c.id));
    if (destinationChapterId && !chapterIds.has(destinationChapterId)) {
      destinationChapterId = defaultChapterId ?? null;
      if (confidence === 'high') confidence = 'medium';
    }
  }

  return {
    destinationBookId,
    destinationChapterId,
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
    defaultBookId = null,
    defaultChapterId = null,
  } = req.body || {};

  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'Missing transcript' });
  }

  if (!Array.isArray(books)) {
    return res.status(400).json({ error: 'books must be an array' });
  }

  try {
    const groq = new Groq({ apiKey });
    const userPayload = JSON.stringify({
      transcript,
      defaultBookId,
      defaultChapterId,
      books: books.map(b => ({
        id: b.id,
        title: b.title,
        chapters: (b.chapters || []).map(c => ({ id: c.id, title: c.title })),
      })),
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

    const route = validateRoute(parsed, books, defaultBookId, defaultChapterId);

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
