const Groq = require('groq-sdk');
const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const MISC_ID = '__misc__';

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'createBook',
      description: 'Create a new book at the top level of the Books category.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title of the new book.' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createChapter',
      description: 'Create a chapter under an existing book. If the book does not exist yet, call createBook first in the same response.',
      parameters: {
        type: 'object',
        properties: {
          bookTitle: { type: 'string', description: 'Title of the parent book (fuzzy matched).' },
          bookId: { type: 'string', description: 'ID of the parent book if known.' },
          chapterTitle: { type: 'string', description: 'Title of the new chapter.' },
        },
        required: ['chapterTitle'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createList',
      description: 'Create a new list under the Lists category.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title of the new list.' },
          listType: {
            type: 'string',
            enum: ['notes', 'todo'],
            description: 'Use "todo" for checklists, shopping lists, to-do lists.',
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addListItem',
      description: 'Add an item to a list. For todo lists this creates an unchecked checkbox item.',
      parameters: {
        type: 'object',
        properties: {
          listTitle: { type: 'string', description: 'List title (fuzzy matched).' },
          listId: { type: 'string', description: 'List ID if known.' },
          text: { type: 'string', description: 'Text of the list item.' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'toggleListItem',
      description: 'Check or uncheck a list item. Fuzzy-match itemText against existing items ("eggs" matches "buy eggs").',
      parameters: {
        type: 'object',
        properties: {
          listTitle: { type: 'string' },
          listId: { type: 'string' },
          itemText: { type: 'string', description: 'Partial or full text of the item to toggle.' },
          itemId: { type: 'string' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addNote',
      description: 'Save a note to a destination. Strip routing phrases from text — only save the annotation content.',
      parameters: {
        type: 'object',
        properties: {
          destination: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['misc', 'book', 'chapter', 'list'] },
              bookTitle: { type: 'string' },
              bookId: { type: 'string' },
              chapterTitle: { type: 'string' },
              chapterId: { type: 'string' },
              listTitle: { type: 'string' },
              listId: { type: 'string' },
            },
            required: ['kind'],
          },
          text: { type: 'string', description: 'Note content only — no destination or command phrases.' },
          formatting: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                start: { type: 'integer' },
                end: { type: 'integer' },
                type: { type: 'string', enum: ['bold', 'italic'] },
              },
              required: ['start', 'end', 'type'],
            },
          },
        },
        required: ['destination', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'editNote',
      description: 'Edit an existing note by ID. Use recentNotes in state to resolve "last note".',
      parameters: {
        type: 'object',
        properties: {
          noteId: { type: 'string' },
          newText: { type: 'string' },
          formatting: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                start: { type: 'integer' },
                end: { type: 'integer' },
                type: { type: 'string', enum: ['bold', 'italic'] },
              },
              required: ['start', 'end', 'type'],
            },
          },
        },
        required: ['noteId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteItem',
      description: 'Delete a book, chapter, list, list item (note), or misc note.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['book', 'chapter', 'list', 'listItem', 'note'] },
          id: { type: 'string' },
        },
        required: ['kind', 'id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'renameItem',
      description: 'Rename a book, chapter, list, or note.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['book', 'chapter', 'list', 'note'] },
          id: { type: 'string' },
          newName: { type: 'string' },
        },
        required: ['kind', 'id', 'newName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'askForClarification',
      description: 'Ask the user a clarifying question when intent is ambiguous. Do not guess.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
        },
        required: ['question'],
      },
    },
  },
];

const ANTHROPIC_TOOLS = TOOL_DEFINITIONS.map((t) => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));

function buildSystemPrompt() {
  return `You are the voice command engine for Blurt, a personal notes app with three categories:
- Books (with chapters for reading annotations)
- Lists (plain notes or todo/checkbox lists)
- Miscellaneous (unsorted notes)

You receive the user's spoken transcript and the current app state. Choose one or more tools to fulfill the request.

Rules:
1. Use fuzzy matching on titles. "east of eden" matches "East of Eden".
2. COMPOUND COMMANDS (critical): When the user creates something AND adds content in one utterance, emit ALL tools in one response in order:
   - "Create a to-do list for May 27 and add milk, eggs, bread" → createList(title:"May 27", listType:"todo") THEN addListItem(listTitle:"May 27", text:"milk") etc. Every addListItem MUST use the SAME listTitle as the list just created.
   - "In East of Eden, add chapter 3 and say this passage hit hard" → createChapter(bookTitle:"East of Eden", chapterTitle:"Chapter 3") THEN addNote(destination:{kind:"chapter", bookTitle:"East of Eden", chapterTitle:"Chapter 3"}, text:"this passage hit hard").
   - "Add chapter 3 and say blank" (while in a book) → createChapter + addNote with text "blank" to that new chapter.
   - Words like "say", "note", "write", "add" followed by content = the note text or list item text — never skip it.
3. If the user wants to file a note somewhere that does not exist yet, create it first then add content in the SAME response.
4. For multi-part commands like "in East of Eden chapter one, this passage hit hard" — destination from the first part, note text from the second. Strip destination phrases from note text.
5. Structure-only commands (no content) → create tools only, no empty addNote/addListItem.
6. Todo/shopping list content → addListItem (not addNote). Book/chapter annotations → addNote.
7. "Check off X" / "uncheck X" → toggleListItem with fuzzy itemText.
8. Multiple list items → multiple addListItem calls, all targeting the correct listTitle.
9. If ambiguous, call askForClarification — never guess.
10. Cancel phrases → no tool calls.
11. routingMode "context": user is viewing currentSelection (see itemTitle). New tasks go to that list via addListItem(listTitle: itemTitle) or addNote to that chapter/book. Do NOT send items to a different list unless the user names one.
12. routingMode "home": detect destination from speech; if none named, use kind "misc".
13. stickyTodoListId is a fallback only — NEVER prefer it over a list the user just created or named in the same utterance.
14. recentNotes helps resolve "last note", edit, delete.

Respond ONLY by calling tools. Do not write prose unless using askForClarification.`;
}

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

function isMiscNote(note, books) {
  if (note.listId) return false;
  if (note.bookId === MISC_ID || note.bookId == null) return true;
  return !books.some((b) => b.id === note.bookId);
}

function buildStateFromLegacy(body) {
  const books = body.books || [];
  const lists = body.lists || [];
  const notes = body.notes || [];
  const routingMode = body.routingMode || 'home';

  let categoryId = null;
  let itemId = null;
  let subItemId = null;

  if (routingMode === 'context') {
    if (body.defaultListId) {
      categoryId = 'lists';
      itemId = body.defaultListId;
    } else if (body.defaultBookId === MISC_ID) {
      categoryId = 'misc';
      itemId = MISC_ID;
    } else if (body.defaultBookId) {
      categoryId = 'books';
      itemId = body.defaultBookId;
      subItemId = body.defaultChapterId || null;
    }
  }

  let itemTitle = null;
  let subItemTitle = null;
  if (itemId && categoryId === 'lists') {
    itemTitle = lists.find((l) => l.id === itemId)?.title || null;
  }
  if (itemId && categoryId === 'books') {
    const book = books.find((b) => b.id === itemId);
    itemTitle = book?.title || null;
    if (subItemId && book) {
      subItemTitle = book.chapters?.find((c) => c.id === subItemId)?.title || null;
    }
  }

  return {
    books: books.map((b) => ({
      id: b.id,
      title: b.title,
      chapters: (b.chapters || []).map((c) => ({ id: c.id, title: c.title })),
    })),
    lists: lists.map((l) => ({
      id: l.id,
      title: l.title,
      type: l.type || 'notes',
      items: notes
        .filter((n) => n.listId === l.id)
        .map((n) => ({ id: n.id, text: n.text, checked: !!n.checked })),
    })),
    misc: notes
      .filter((n) => isMiscNote(n, books))
      .slice(-20)
      .map((n) => ({ id: n.id, text: n.text })),
    recentNotes: notes.slice(-15).map((n) => ({
      id: n.id,
      text: n.text,
      bookId: n.bookId,
      chapterId: n.chapterId,
      listId: n.listId,
    })),
    currentSelection: { categoryId, itemId, subItemId, itemTitle, subItemTitle },
    routingMode,
    stickyTodoListId: body.stickyTodoListId || null,
  };
}

function normalizeRequest(body) {
  const transcript = (body.transcript || '').trim();
  const state = body.state || buildStateFromLegacy(body);
  const parts = [];

  if (body.priorTranscript) {
    parts.push(`Previous utterance: ${body.priorTranscript}`);
  }
  if (body.clarificationContext) {
    parts.push(`Prior clarification question: ${body.clarificationContext}`);
  }
  parts.push(`Transcript: ${transcript}`);
  parts.push(`State: ${JSON.stringify(state)}`);

  return { transcript, state, userMessage: parts.join('\n\n') };
}

function isCancelUtterance(transcript) {
  const t = (transcript || '').trim();
  if (!t) return true;
  return /^(?:cancel(?:\s+(?:this|that|it|the note))?|nevermind|never mind|forget it|scratch that|don'?t save(?:\s+that)?|do not save|ignore that|undo(?:\s+that)?)\s*\.?$/i.test(t)
    || /(?:^|[,.\s]+)(?:cancel(?:\s+(?:this|that|it|the note))?|nevermind|never mind|forget it|scratch that|don'?t save(?:\s+that)?|do not save|ignore that|undo(?:\s+that)?)\s*\.?$/i.test(t);
}

function sanitizeFormatting(formatting, textLength) {
  if (!Array.isArray(formatting)) return [];
  return formatting
    .filter((f) => f && typeof f.start === 'number' && typeof f.end === 'number'
      && f.end > f.start && f.start >= 0 && f.end <= textLength
      && (f.type === 'bold' || f.type === 'italic'))
    .map((f) => ({ start: f.start, end: f.end, type: f.type }));
}

function toolCallToAction(name, args) {
  const a = args || {};

  switch (name) {
    case 'createBook':
      return { type: 'createBook', title: String(a.title || '').trim() };
    case 'createChapter':
      return {
        type: 'createChapter',
        bookTitle: a.bookTitle ? String(a.bookTitle).trim() : undefined,
        bookId: a.bookId || undefined,
        chapterTitle: String(a.chapterTitle || '').trim(),
      };
    case 'createList':
      return {
        type: 'createList',
        title: String(a.title || '').trim(),
        listType: a.listType === 'todo' ? 'todo' : 'notes',
      };
    case 'addListItem':
      return {
        type: 'addListItem',
        listTitle: a.listTitle ? String(a.listTitle).trim() : undefined,
        listId: a.listId || undefined,
        text: String(a.text || '').trim(),
      };
    case 'toggleListItem':
      return {
        type: 'toggleListItem',
        listTitle: a.listTitle ? String(a.listTitle).trim() : undefined,
        listId: a.listId || undefined,
        itemText: a.itemText ? String(a.itemText).trim() : undefined,
        itemId: a.itemId || undefined,
      };
    case 'addNote': {
      const text = String(a.text || '').trim();
      return {
        type: 'addNote',
        destination: a.destination || { kind: 'misc' },
        text,
        formatting: sanitizeFormatting(a.formatting, text.length),
      };
    }
    case 'editNote': {
      const newText = a.newText != null ? String(a.newText).trim() : undefined;
      const len = newText != null ? newText.length : 9999;
      return {
        type: 'editNote',
        noteId: a.noteId,
        newText,
        formatting: sanitizeFormatting(a.formatting, len),
      };
    }
    case 'deleteItem':
      return { type: 'deleteItem', kind: a.kind, id: a.id };
    case 'renameItem':
      return { type: 'renameItem', kind: a.kind, id: a.id, newName: String(a.newName || '').trim() };
    case 'askForClarification':
      return { type: 'askForClarification', question: String(a.question || '').trim() };
    default:
      return null;
  }
}

function parseToolCallsFromGroq(message) {
  const calls = message.tool_calls || [];
  return calls.map((tc) => {
    let args = {};
    try {
      args = JSON.parse(tc.function.arguments || '{}');
    } catch (_) {}
    return { name: tc.function.name, args };
  });
}

function parseToolCallsFromAnthropic(content) {
  return (content || [])
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ name: b.name, args: b.input || {} }));
}

function buildResponseFromToolCalls(toolCalls) {
  let clarification = null;
  const actions = [];

  for (const { name, args } of toolCalls) {
    if (name === 'askForClarification') {
      clarification = String(args.question || '').trim() || clarification;
      continue;
    }
    const action = toolCallToAction(name, args);
    if (!action) continue;
    if (action.type === 'createBook' && !action.title) continue;
    if (action.type === 'createChapter' && !action.chapterTitle) continue;
    if (action.type === 'createList' && !action.title) continue;
    if (action.type === 'addListItem' && !action.text) continue;
    if (action.type === 'addNote' && !action.text) continue;
    actions.push(action);
  }

  return { actions, clarification };
}

/** Wire create→add actions when the LLM omits list/chapter targets in compound commands. */
function linkActionsInBatch(actions) {
  if (!Array.isArray(actions) || !actions.length) return actions;

  let lastListTitle = null;
  let lastBookTitle = null;
  let lastBookId = null;
  let lastChapterTitle = null;

  return actions.map((action) => {
    if (action.type === 'createList') {
      lastListTitle = action.title;
    }
    if (action.type === 'createBook') {
      lastBookTitle = action.title;
      lastBookId = null;
      lastChapterTitle = null;
    }
    if (action.type === 'createChapter') {
      lastChapterTitle = action.chapterTitle;
      if (action.bookTitle) lastBookTitle = action.bookTitle;
      if (action.bookId) lastBookId = action.bookId;
    }

    if (action.type === 'addListItem') {
      if (!action.listId && !action.listTitle && lastListTitle) {
        return { ...action, listTitle: lastListTitle };
      }
      return action;
    }

    if (action.type === 'addNote') {
      const dest = { ...(action.destination || {}) };
      let changed = false;

      if (lastChapterTitle && (dest.kind === 'chapter' || !dest.kind)) {
        if (!dest.chapterTitle && !dest.chapterId) {
          dest.chapterTitle = lastChapterTitle;
          dest.kind = 'chapter';
          changed = true;
        }
        if (!dest.bookTitle && !dest.bookId && lastBookTitle) {
          dest.bookTitle = lastBookTitle;
          changed = true;
        }
        if (!dest.bookTitle && !dest.bookId && lastBookId) {
          dest.bookId = lastBookId;
          changed = true;
        }
      }

      if (dest.kind === 'list' && !dest.listTitle && !dest.listId && lastListTitle) {
        dest.listTitle = lastListTitle;
        changed = true;
      }

      if (changed) return { ...action, destination: dest };
    }

    return action;
  });
}

async function callGroqTools(userMessage) {
  const config = getRoutingConfig();
  const groq = new Groq({ apiKey: config.apiKey });
  const completion = await groq.chat.completions.create({
    model: config.model,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: userMessage },
    ],
    tools: TOOL_DEFINITIONS,
    tool_choice: 'auto',
    temperature: 0.05,
    max_tokens: 2048,
  });

  const message = completion.choices[0]?.message;
  if (!message) return { toolCalls: [], reasoning: 'Empty LLM response' };

  if (message.tool_calls?.length) {
    return {
      toolCalls: parseToolCallsFromGroq(message),
      reasoning: message.content || `Called ${message.tool_calls.length} tool(s)`,
    };
  }

  // Fallback: model returned JSON in content instead of tool calls
  const raw = (message.content || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1].trim() : raw;
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed.actions)) {
      return {
        directActions: parsed.actions,
        clarification: parsed.clarification || null,
        reasoning: parsed.reasoning || 'JSON fallback',
      };
    }
  } catch (_) {}

  return { toolCalls: [], reasoning: raw || 'No tool calls returned' };
}

async function callAnthropicTools(userMessage) {
  const config = getRoutingConfig();
  const client = new Anthropic({ apiKey: config.apiKey });
  const message = await client.messages.create({
    model: config.model,
    max_tokens: 2048,
    temperature: 0.05,
    system: buildSystemPrompt(),
    tools: ANTHROPIC_TOOLS,
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: userMessage }],
  });

  const toolCalls = parseToolCallsFromAnthropic(message.content);
  const textBlock = message.content.find((b) => b.type === 'text');
  return {
    toolCalls,
    reasoning: textBlock?.text || `Called ${toolCalls.length} tool(s)`,
  };
}

async function routeWithTools(userMessage) {
  const config = getRoutingConfig();
  if (!config.apiKey) {
    const keyName = config.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GROQ_API_KEY';
    throw new Error(`${keyName} is not configured`);
  }

  if (config.provider === 'anthropic') {
    return callAnthropicTools(userMessage);
  }
  return callGroqTools(userMessage);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const { transcript } = normalizeRequest(body);

  if (!transcript || typeof body.transcript !== 'string') {
    return res.status(400).json({ error: 'Missing transcript' });
  }

  if (isCancelUtterance(transcript)) {
    return res.status(200).json({
      actions: [],
      clarification: null,
      reasoning: 'User cancelled',
      cancelled: true,
    });
  }

  try {
    const { userMessage } = normalizeRequest(body);
    const llmResult = await routeWithTools(userMessage);

    if (llmResult.directActions) {
      return res.status(200).json({
        actions: linkActionsInBatch(llmResult.directActions),
        clarification: llmResult.clarification,
        reasoning: llmResult.reasoning,
      });
    }

    const { actions, clarification } = buildResponseFromToolCalls(llmResult.toolCalls || []);

    return res.status(200).json({
      actions: linkActionsInBatch(actions),
      clarification,
      reasoning: llmResult.reasoning || '',
    });
  } catch (err) {
    console.error('route error:', err);
    const status = err.status || err.statusCode || 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: err.message || 'Routing failed',
    });
  }
};

// Exported for local testing (scripts/test-route.js)
module.exports.TOOL_DEFINITIONS = TOOL_DEFINITIONS;
module.exports.buildStateFromLegacy = buildStateFromLegacy;
module.exports.normalizeRequest = normalizeRequest;
module.exports.buildResponseFromToolCalls = buildResponseFromToolCalls;
module.exports.toolCallToAction = toolCallToAction;
module.exports.linkActionsInBatch = linkActionsInBatch;
