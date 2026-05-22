const Groq = require('groq-sdk');
const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

function getRoutingProvider() {
  const explicit = (process.env.ROUTING_PROVIDER || '').toLowerCase();
  if (explicit === 'anthropic' || explicit === 'groq') return explicit;
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'groq';
}

function getRoutingConfig() {
  const provider = getRoutingProvider();
  if (provider === 'anthropic') {
    return {
      provider,
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ROUTING_MODEL || DEFAULT_ANTHROPIC_MODEL,
    };
  }
  return {
    provider,
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.ROUTING_MODEL || DEFAULT_GROQ_MODEL,
  };
}

function parseRouteJson(raw) {
  const trimmed = (raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1].trim() : trimmed);
}

async function callRoutingLLM(userPayload) {
  const config = getRoutingConfig();
  if (!config.apiKey) {
    const keyName = config.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GROQ_API_KEY';
    throw new Error(`${keyName} is not configured`);
  }

  if (config.provider === 'anthropic') {
    const client = new Anthropic({ apiKey: config.apiKey });
    const message = await client.messages.create({
      model: config.model,
      max_tokens: 1024,
      temperature: 0.05,
      system: ROUTING_PROMPT,
      messages: [{ role: 'user', content: userPayload }],
    });
    const block = message.content.find((b) => b.type === 'text');
    return block?.text || '{}';
  }

  const groq = new Groq({ apiKey: config.apiKey });
  const completion = await groq.chat.completions.create({
    model: config.model,
    messages: [
      { role: 'system', content: ROUTING_PROMPT },
      { role: 'user', content: userPayload },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.05,
  });
  return completion.choices[0]?.message?.content || '{}';
}

const ROUTING_PROMPT = `You parse voice notes for Blurt. Split each transcript into WHERE it goes and WHAT to save.

MODES (check routingMode in input):
- "home": user is on the main screen — detect destination from speech OR send to Miscellaneous if no destination is named
- "context": user is already viewing a destination — ignore destination phrases; only extract noteText (and list/book creation if explicitly requested)

CRITICAL — noteText vs commands:
- noteText is ONLY real annotation content (thoughts, tasks, quotes) — NOT instructions
- If the user is ONLY giving a structure command, set noteText to "" (empty string)
- Set commandOnly: true when there is no annotation to save
- Examples (command only — NO note):
  - "Make a new book" → createBookTitle: "New book", noteText: "", commandOnly: true
  - "Create a book called East of Eden" → createBookTitle: "East of Eden", noteText: "", commandOnly: true
  - "Make a new book and add two chapters" → createBookTitle: "New book", createChapterTitles: ["Chapter 1", "Chapter 2"], noteText: "", commandOnly: true
  - "Add a list called groceries" → createListTitle: "groceries", noteText: "", commandOnly: true
- Examples (command + note):
  - "New book Dune, first note: desert planet" → createBookTitle: "Dune", noteText: "desert planet", commandOnly: false
  - "Add a to-do list: call mom" → createListTitle: "To-do", createListType: "todo", noteText: "call mom", commandOnly: false
- Never keep "add this to", "put in books", "file under", "make a new book", etc. in noteText

Creation:
- createBookTitle when user asks for a new book (default title "New book" if unnamed)
- createChapterTitles: array of chapter names when user asks for multiple chapters (use "Chapter 1", "Chapter 2" if unnamed)
- createChapterTitle: single chapter name (legacy; prefer createChapterTitles)
- createListTitle / createListType when user asks for a new list

Routing (home mode only):
- Match spoken names to provided book/chapter/list IDs
- No destination named → destinationBookId/defaultBookId should be Miscellaneous (__misc__)
- confidence "high" if user explicitly named destination; "low" if defaulting to misc

Respond with JSON only:
{
  "destinationBookId": "string or null",
  "destinationChapterId": "string or null",
  "destinationListId": "string or null",
  "createBookTitle": "string or null",
  "createChapterTitle": "string or null",
  "createChapterTitles": ["string"] or null,
  "createListTitle": "string or null",
  "createListType": "todo or notes or null",
  "noteText": "string",
  "commandOnly": true or false,
  "confidence": "high" | "medium" | "low",
  "reasoning": "string"
}`;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripRoutingPhrases(transcript, books, lists) {
  let text = transcript.trim();

  const stripPatterns = [
    /[,.]?\s*(?:and\s+)?(?:add|put|save|file)\s+(?:this|it|that)?\s*(?:to|in|under|into)\s+(?:books?\s+)?[^.!?]+[.!?]?\s*$/i,
    /^(?:add|put|save|file)\s+(?:this|it|that)?\s*(?:to|in|under|into)\s+(?:books?\s+)?[^,.:;!?]+[,.:;!?]\s*/i,
    /^(?:add|create|make)\s+a\s+(?:new\s+)?(?:to-?do\s*)?list(?:\s+(?:called|named))?\s+[^,.:;!?]+[,.:;!?]\s*/i,
    /^(?:new book(?: called)?|create a book(?: called)?)\s+[^,.:;!?]+[,.:;!?]\s*/i,
    /^(?:under|in)\s+(?:books?\s+)?[^,.:;!?]+[,.:;!?]\s*/i,
  ];

  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const p of stripPatterns) {
      const next = text.replace(p, '').trim();
      if (next && next.length < text.length) {
        text = next;
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const book of books) {
    for (const phrase of [book.title, ...(book.chapters || []).map(c => `${book.title} ${c.title}`), ...(book.chapters || []).map(c => c.title)]) {
      if (!phrase || phrase.length < 3) continue;
      const re = new RegExp(`^[,.\\s]*(?:in\\s+)?${escapeRegex(phrase)}[,.:;\\-–—]?\\s*`, 'i');
      const next = text.replace(re, '').trim();
      if (next && next.length < text.length) text = next;
    }
  }

  for (const list of lists) {
    if (!list.title || list.title.length < 2) continue;
    const re = new RegExp(`^[,.\\s]*(?:in\\s+|on\\s+(?:my\\s+)?)?${escapeRegex(list.title)}[,.:;\\-–—]?\\s*`, 'i');
    const next = text.replace(re, '').trim();
    if (next && next.length < text.length) text = next;
  }

  return text.trim();
}

function hasRoutingSignal(transcript, books, lists) {
  const lower = transcript.toLowerCase();
  if (/\b(add|put|save|file|create|make)\s+(?:this|a|it|to|in|under)\b/.test(lower)) return true;
  if (/\bnew\s+(book|list|chapter|to-?do)\b/.test(lower)) return true;
  for (const book of books) {
    if (lower.includes(book.title.toLowerCase())) return true;
    for (const c of book.chapters || []) {
      if (lower.includes(c.title.toLowerCase())) return true;
    }
  }
  for (const list of lists) {
    if (lower.includes(list.title.toLowerCase())) return true;
  }
  return false;
}

function parseChapterCount(word) {
  const map = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const n = map[(word || '').toLowerCase()];
  return n || parseInt(word, 10) || 0;
}

function defaultChapterTitles(count) {
  return Array.from({ length: count }, (_, i) => `Chapter ${i + 1}`);
}

function detectStructureCommand(transcript) {
  const trimmed = transcript.trim();
  const lower = trimmed.toLowerCase();

  const bareBook = trimmed.match(/^(?:make|create|add)\s+(?:a\s+)?(?:new\s+)?book\s*\.?$/i);
  if (bareBook) {
    return { createBookTitle: 'New book', createChapterTitles: [], noteText: '', commandOnly: true };
  }

  const bookWithCount = trimmed.match(
    /^(?:make|create|add)\s+(?:a\s+)?(?:new\s+)?book(?:\s+(?:called|named)\s+([^,.]+?))?\s*(?:,\s*)?(?:and\s+)?(?:add\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+chapters?\s*\.?$/i
  );
  if (bookWithCount) {
    const title = (bookWithCount[1] || 'New book').trim();
    const count = parseChapterCount(bookWithCount[2]);
    return {
      createBookTitle: title,
      createChapterTitles: defaultChapterTitles(count),
      noteText: '',
      commandOnly: true,
    };
  }

  const namedBook = trimmed.match(/^(?:make|create|add)\s+(?:a\s+)?(?:new\s+)?book(?:\s+(?:called|named)\s+(.+?))?\s*\.?$/i);
  if (namedBook && !/(?:note|annotation|saying|:\s*\S)/i.test(trimmed)) {
    return {
      createBookTitle: (namedBook[1] || 'New book').trim(),
      createChapterTitles: [],
      noteText: '',
      commandOnly: true,
    };
  }

  const bareList = trimmed.match(/^(?:make|create|add)\s+(?:a\s+)?(?:new\s+)?(?:to-?do\s*)?list\s*\.?$/i);
  if (bareList) {
    const isTodo = /to-?do/i.test(bareList[0]);
    return {
      createListTitle: isTodo ? 'To-do' : 'New list',
      createListType: isTodo ? 'todo' : 'notes',
      noteText: '',
      commandOnly: true,
    };
  }

  const namedListOnly = trimmed.match(/^(?:make|create|add)\s+(?:a\s+)?(?:new\s+)?((?:to-?do\s*)?list)(?:\s+(?:called|named)\s+(.+?))\s*\.?$/i);
  if (namedListOnly && !/(?::\s*\S|first note|note:|saying)/i.test(trimmed)) {
    const isTodo = /to-?do/i.test(namedListOnly[1]);
    return {
      createListTitle: namedListOnly[2].trim(),
      createListType: isTodo ? 'todo' : 'notes',
      noteText: '',
      commandOnly: true,
    };
  }

  const addChapters = trimmed.match(/^(?:add|create|make)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+chapters?\s*\.?$/i);
  if (addChapters) {
    return {
      createChapterTitles: defaultChapterTitles(parseChapterCount(addChapters[1])),
      noteText: '',
      commandOnly: true,
    };
  }

  if (/^(?:add|create|make)\s+(?:a\s+)?(?:new\s+)?chapter\s*\.?$/i.test(trimmed)) {
    return { createChapterTitles: ['Chapter 1'], noteText: '', commandOnly: true };
  }

  return null;
}

function normalizeCreations(parsed) {
  const out = { ...parsed };
  if (!out.createChapterTitles && out.createChapterTitle) {
    out.createChapterTitles = [out.createChapterTitle];
  }
  if (Array.isArray(out.createChapterTitles)) {
    out.createChapterTitles = out.createChapterTitles.filter(Boolean).map((t) => String(t).trim());
  }
  return out;
}

function hasStructureCreation(route) {
  return !!(
    route.createBookTitle ||
    route.createListTitle ||
    route.createChapterTitle ||
    (route.createChapterTitles && route.createChapterTitles.length)
  );
}

function finalizeNoteText(route, transcript) {
  let noteText = (route.noteText || '').trim();

  if (route.commandOnly || (hasStructureCreation(route) && !noteText)) {
    return '';
  }

  if (hasStructureCreation(route)) {
    const stripped = stripRoutingPhrases(transcript, [], []);
    const cmdStripped = stripStructurePhrases(stripped);
    if (!cmdStripped || isLikelyCommandRemainder(cmdStripped, transcript, route)) {
      return '';
    }
    noteText = cmdStripped;
  }

  if (noteText && noteText === transcript.trim() && hasStructureCreation(route)) {
    return '';
  }

  return noteText;
}

function stripStructurePhrases(text) {
  let t = text.trim();
  const patterns = [
    /^(?:make|create|add)\s+(?:a\s+)?(?:new\s+)?book(?:\s+(?:called|named)\s+[^,.]+?)?(?:\s*,?\s*(?:and\s+)?(?:add\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+chapters?)?\s*\.?\s*/i,
    /^(?:make|create|add)\s+(?:a\s+)?(?:new\s+)?(?:to-?do\s*)?list(?:\s+(?:called|named)\s+[^,.]+?)?\s*\.?\s*/i,
    /^(?:add|create|make)\s+(?:a\s+)?(?:new\s+)?chapter(?:\s+(?:called|named)\s+[^,.]+?)?\s*\.?\s*/i,
    /^(?:add|create|make)\s+(\d+|one|two|three|four|five)\s+chapters?\s*\.?\s*/i,
  ];
  for (const p of patterns) {
    const next = t.replace(p, '').trim();
    if (next.length < t.length) t = next;
  }
  return t.trim();
}

function isLikelyCommandRemainder(noteText, transcript, route) {
  const lower = noteText.toLowerCase();
  if (/^(make|create|add|new)\s/.test(lower)) return true;
  if (/^\d+\s+chapters?$/.test(lower)) return true;
  if (route.createBookTitle && lower === route.createBookTitle.toLowerCase()) return true;
  if (route.createListTitle && lower === route.createListTitle.toLowerCase()) return true;
  if (noteText === transcript.trim()) return true;
  return false;
}
function detectListCreation(transcript) {
  const structure = detectStructureCommand(transcript);
  if (structure?.createListTitle || structure?.createBookTitle || structure?.createChapterTitles) {
    return structure;
  }

  const m = transcript.match(/(?:add|create|make)\s+a\s+(?:new\s+)?((?:to-?do\s*)?list)(?:\s+(?:called|named))?\s*[:\-]?\s*(.+)/i);
  if (!m) return null;
  const isTodo = /to-?do/i.test(m[1]);
  let rest = m[2].trim();
  let title = isTodo ? 'To-do' : 'New list';
  let noteText = rest;

  const named = rest.match(/^["']?([^"':]+)["']?\s*[:\-]\s*(.+)/);
  if (named) {
    title = named[1].trim();
    noteText = named[2].trim();
  } else if (!isTodo && rest.split(/\s+/).length <= 4 && !/[.!?]/.test(rest)) {
    title = rest;
    noteText = '';
  }

  return {
    createListTitle: title,
    createListType: isTodo ? 'todo' : 'notes',
    noteText,
    commandOnly: !noteText,
  };
}

function buildRouteResult(fields) {
  return {
    destinationBookId: fields.destinationBookId ?? null,
    destinationChapterId: fields.destinationChapterId ?? null,
    destinationListId: fields.destinationListId ?? null,
    createBookTitle: fields.createBookTitle || null,
    createChapterTitle: fields.createChapterTitle || null,
    createChapterTitles: fields.createChapterTitles || null,
    createListTitle: fields.createListTitle || null,
    createListType: fields.createListType || null,
    noteText: (fields.noteText || '').trim(),
    commandOnly: !!fields.commandOnly,
    confidence: fields.confidence || 'low',
    reasoning: fields.reasoning || '',
  };
}

function validateRoute(parsed, books, lists, defaultBookId, defaultChapterId, defaultListId, routingMode) {
  const bookIds = new Set(books.map(b => b.id));
  const listIds = new Set(lists.map(l => l.id));
  const MISC = defaultBookId === '__misc__' || !defaultBookId ? '__misc__' : defaultBookId;

  let destinationBookId = parsed.destinationBookId || null;
  let destinationChapterId = parsed.destinationChapterId ?? null;
  let destinationListId = parsed.destinationListId || null;
  let confidence = parsed.confidence || 'low';

  if (routingMode === 'context') {
    if (defaultListId && listIds.has(defaultListId)) {
      return buildRouteResult({
        destinationListId: defaultListId,
        ...parsed,
        confidence: 'high',
        reasoning: 'Current view',
      });
    }
    if (defaultBookId && defaultBookId !== '__misc__' && bookIds.has(defaultBookId)) {
      return buildRouteResult({
        destinationBookId: defaultBookId,
        destinationChapterId: defaultChapterId ?? null,
        createChapterTitles: parsed.createChapterTitles,
        createChapterTitle: parsed.createChapterTitle,
        noteText: parsed.noteText,
        commandOnly: parsed.commandOnly,
        confidence: 'high',
        reasoning: 'Current view',
      });
    }
    return buildRouteResult({
      destinationBookId: MISC,
      noteText: parsed.noteText,
      commandOnly: parsed.commandOnly,
      confidence: 'high',
      reasoning: 'Current view (misc)',
    });
  }

  if (destinationListId && listIds.has(destinationListId)) {
    destinationBookId = null;
    destinationChapterId = null;
  } else if (destinationBookId && bookIds.has(destinationBookId)) {
    destinationListId = null;
    const book = books.find(b => b.id === destinationBookId);
    const chapterIds = new Set((book?.chapters || []).map(c => c.id));
    if (destinationChapterId && !chapterIds.has(destinationChapterId)) {
      destinationChapterId = null;
      if (confidence === 'high') confidence = 'medium';
    }
  } else if (!parsed.createBookTitle && !parsed.createListTitle && !(parsed.createChapterTitles?.length)) {
    destinationBookId = MISC;
    destinationChapterId = null;
    destinationListId = null;
    confidence = 'low';
  }

  return buildRouteResult({
    destinationBookId,
    destinationChapterId,
    destinationListId,
    createBookTitle: parsed.createBookTitle,
    createChapterTitle: parsed.createChapterTitle,
    createChapterTitles: parsed.createChapterTitles,
    createListTitle: parsed.createListTitle,
    createListType: parsed.createListType,
    noteText: parsed.noteText,
    commandOnly: parsed.commandOnly,
    confidence,
    reasoning: parsed.reasoning,
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    transcript,
    books = [],
    lists = [],
    defaultBookId = '__misc__',
    defaultChapterId = null,
    defaultListId = null,
    routingMode = 'home',
  } = req.body || {};

  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'Missing transcript' });
  }

  const trimmed = transcript.trim();

  try {
    if (routingMode === 'context') {
    const structureCmd = detectStructureCommand(trimmed);
    let parsed = { noteText: stripRoutingPhrases(trimmed, books, lists), confidence: 'high' };
    if (structureCmd) {
      parsed = { ...parsed, ...structureCmd };
      if (structureCmd.createChapterTitles?.length && defaultBookId && defaultBookId !== '__misc__') {
        parsed.destinationBookId = defaultBookId;
      }
    }
    const route = validateRoute(
      normalizeCreations(parsed),
      books,
      lists,
      defaultBookId,
      defaultChapterId,
      defaultListId,
      'context'
    );
    route.noteText = finalizeNoteText(route, trimmed);
    if (!route.noteText && !hasStructureCreation(route) && !route.commandOnly) {
      route.noteText = trimmed;
    }
    return res.status(200).json(route);
  }

  const structureCmd = detectListCreation(trimmed) || detectStructureCommand(trimmed);

    if (structureCmd?.commandOnly) {
      const parsed = normalizeCreations({ ...structureCmd, confidence: 'high', reasoning: 'Structure command' });
      let route = validateRoute(parsed, books, lists, defaultBookId || '__misc__', defaultChapterId, defaultListId, 'home');
      route.noteText = '';
      route.commandOnly = true;
      return res.status(200).json(route);
    }

    const userPayload = JSON.stringify({
      routingMode: 'home',
      transcript: trimmed,
      defaultBookId: defaultBookId || '__misc__',
      books: books.map(b => ({
        id: b.id,
        title: b.title,
        chapters: (b.chapters || []).map(c => ({ id: c.id, title: c.title })),
      })),
      lists: lists.map(l => ({ id: l.id, title: l.title, type: l.type || 'notes' })),
    });

    let parsed;
    try {
      const raw = await callRoutingLLM(userPayload);
      parsed = parseRouteJson(raw);
    } catch (err) {
      if (err instanceof SyntaxError) {
        return res.status(502).json({ error: 'LLM returned invalid JSON' });
      }
      throw err;
    }

    parsed = normalizeCreations(parsed);

    if (structureCmd) {
      parsed.createBookTitle = parsed.createBookTitle || structureCmd.createBookTitle || null;
      parsed.createChapterTitles = parsed.createChapterTitles?.length
        ? parsed.createChapterTitles
        : structureCmd.createChapterTitles || null;
      parsed.createChapterTitle = parsed.createChapterTitle || structureCmd.createChapterTitle || null;
      parsed.createListTitle = parsed.createListTitle || structureCmd.createListTitle || null;
      parsed.createListType = parsed.createListType || structureCmd.createListType || null;
      if (structureCmd.commandOnly) parsed.commandOnly = true;
      if (!parsed.noteText && structureCmd.noteText) parsed.noteText = structureCmd.noteText;
    }

    let route = validateRoute(parsed, books, lists, defaultBookId || '__misc__', defaultChapterId, defaultListId, 'home');
    route.createChapterTitles = parsed.createChapterTitles || null;
    route.commandOnly = !!parsed.commandOnly;

    const stripped = stripRoutingPhrases(trimmed, books, lists);
    const llmNote = (parsed.noteText || '').trim();
    if (!route.commandOnly && !hasStructureCreation(route)) {
      if (llmNote && llmNote.length <= trimmed.length * 0.95) {
        route.noteText = llmNote;
      } else if (stripped) {
        route.noteText = stripped;
      } else {
        route.noteText = llmNote || trimmed;
      }
    }

    route.noteText = finalizeNoteText(route, trimmed);

    if (!route.noteText && !hasStructureCreation(route) && !route.commandOnly) {
      route.noteText = trimmed;
    }

    if (!hasRoutingSignal(trimmed, books, lists) && !hasStructureCreation(route)) {
      route.destinationBookId = '__misc__';
      route.destinationChapterId = null;
      route.destinationListId = null;
      route.confidence = 'low';
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
