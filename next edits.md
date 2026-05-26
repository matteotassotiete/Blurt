# Cursor Prompt: Refactor Blurt's Voice Engine to Use LLM Tool Use

Paste this entire document into Cursor's chat. **This is a significant refactor of `/api/route.js` and the frontend's post-recording flow.** Take it in phases. Do not do everything in one shot.

---

## Context

I'm building **Blurt**, a vanilla HTML/CSS/JS web app with Vercel serverless functions on the backend. Voice gets transcribed by Groq Whisper, then routed by an LLM, then saved to localStorage. The sidebar has three categories: Books, Lists, Miscellaneous. Each category contains items (books have chapters; lists have checkable entries; misc has free-form notes).

**The current state is broken:**
- Saying "add a new book called X" doesn't actually create the book — sometimes it tries to file a note under a non-existent destination.
- Saying "check off buy eggs" doesn't toggle the checkbox — or it duplicates it.
- Multi-part commands like "in East of Eden, chapter one, this passage hit hard" don't reliably file the note in the right chapter.
- Text formatting commands ("make this bold") don't work at all.
- Long audio loses content.

**The root cause:** the current `/api/route.js` is built around a single decision — *where does this note go?* — and returns a destination ID. That model can't handle actions like creating things, modifying things, or formatting text. It also has no way to say "I don't understand, ask the user."

**The fix: switch to LLM tool use (a.k.a. function calling).** The LLM should be given a set of tools it can call to operate the app, and it should choose which tool(s) to call based on what the user said. This is the same architecture Claude Code and other agents use.

---

## Hard rules

- Do not introduce frameworks. Vanilla HTML/JS/CSS only.
- Do not split `index.html` into multiple files yet.
- Show me a plan before writing code. Show me diffs before applying.
- One phase at a time. Stop and wait after each phase.
- Do not regress any working feature. If something used to work, it must still work after the refactor.
- Do not use hardcoded keyword matching ("if transcript contains 'add'…"). All intent extraction goes through the LLM.

---

## The architecture I want

### Backend: `/api/route.js` becomes a tool-use endpoint

Instead of returning `{ destinationId, noteText, confidence }`, it returns an **array of actions** the frontend should execute. Each action is a structured object describing exactly what to do.

**The endpoint receives:**
```json
{
  "transcript": "<the Whisper transcript>",
  "state": {
    "books": [{ "id": "...", "title": "...", "chapters": [{ "id": "...", "title": "..." }] }],
    "lists": [{ "id": "...", "title": "...", "items": [{ "id": "...", "text": "...", "checked": false }] }],
    "misc": [{ "id": "...", "text": "..." }],
    "currentSelection": { "categoryId": "books", "itemId": "...", "subItemId": "..." }
  }
}
```

**It returns:**
```json
{
  "actions": [
    { "type": "createBook", "title": "East of Eden" },
    { "type": "addNote", "destination": { "kind": "chapter", "bookTitle": "East of Eden", "chapterTitle": "Chapter one" }, "text": "this passage hit hard", "formatting": [] }
  ],
  "clarification": null,
  "reasoning": "User wanted to file a note in East of Eden chapter one. Book doesn't exist yet, so created it first."
}
```

If the LLM is uncertain, it returns:
```json
{
  "actions": [],
  "clarification": "Did you mean to add this to East of Eden chapter one, or chapter two? You said 'chapter' but it wasn't clear which.",
  "reasoning": "Ambiguous chapter reference."
}
```

### The tool set the LLM can choose from

Define these tools in the LLM call. Each one corresponds to a frontend handler.

1. **`createBook(title)`** — create a new book at the top level.
2. **`createChapter(bookTitle | bookId, chapterTitle)`** — create a chapter under a book. If the book doesn't exist, the LLM must `createBook` first in the same response.
3. **`createList(title)`** — create a new list under the Lists category.
4. **`addListItem(listTitle | listId, text)`** — add an item to a list.
5. **`toggleListItem(listTitle | listId, itemText | itemId)`** — check or uncheck an item. Use fuzzy matching on `itemText` ("eggs" should match "buy eggs").
6. **`addNote(destination, text, formatting)`** — add a note. `destination` describes where (e.g. `{ kind: "chapter", bookTitle, chapterTitle }`, `{ kind: "book", bookTitle }`, `{ kind: "misc" }`). `formatting` is an array of `{ start, end, type: "bold" | "italic" }` ranges. If the user said "make this sentence bold," the LLM identifies which range and includes it.
7. **`editNote(noteId, newText, formatting)`** — edit an existing note. Used for follow-ups.
8. **`deleteItem(kind, id)`** — delete a book, chapter, list, list item, or note.
9. **`renameItem(kind, id, newName)`** — rename anything.
10. **`askForClarification(question)`** — when the LLM isn't sure what the user meant.

### Frontend: action dispatcher

When `/api/route.js` returns, the frontend loops through the `actions` array and dispatches each one to a handler function in `index.html`. Each handler updates state and re-renders the UI. Existing localStorage save logic still runs after each action.

If `clarification` is present and `actions` is empty, the frontend should:
- Show the clarification question as a chat-bubble-style overlay near the orb.
- Wait for the user to press-and-hold again to answer.
- When they answer, the next `/api/route.js` call must include the prior clarification context so the LLM remembers what it was asking about.

---

## Phase 1: Refactor `/api/route.js`

**Tasks:**
1. Rewrite `/api/route.js` to use the new tool-use pattern.
2. Use Groq's `llama-3.1-70b-versatile` for this (the 8b model isn't smart enough for multi-step reasoning — we need real understanding here). If Groq has a newer/better tool-use model available when you read this, use that.
3. Use the LLM's native tool-use feature if available; otherwise fall back to a strict JSON schema in the system prompt.
4. The system prompt should:
   - Explain that Blurt is a voice notes app with books, lists, and misc.
   - List all available tools with descriptions and parameters.
   - Include the current app state (books, lists, misc, currentSelection) as context.
   - Instruct the LLM: "Use fuzzy matching for titles. If the user says 'east of eden' and a book called 'East of Eden' exists, use that one. If they say something ambiguous, call `askForClarification` instead of guessing."
   - Instruct the LLM: "If the user wants to file a note in a place that doesn't exist yet (e.g. a chapter that hasn't been created), call `createChapter` first, then `addNote`, in the same response."
   - Instruct the LLM: "For multi-part commands like 'in East of Eden chapter one, this passage hit hard,' identify the destination from the first part and the content from the second part. Strip the destination phrase from the note text."
   - Instruct the LLM: "If the user includes formatting commands like 'make this bold' or 'italicize the next sentence,' return formatting ranges that point to the relevant substring in the note text."
5. Return the structured action array. Include `reasoning` for debugging.

**Stop after Phase 1.** Show me the new `/api/route.js`, walk me through the prompt and tool definitions, and let me test it with a few sample transcripts (pasted directly, not yet wired to the frontend) before moving on. I want to see what `actions` array comes back for these test cases:

- "Add a new book called Karamazov"
- "In East of Eden chapter one, this passage about Cathy hit hard"
- "Check off buy eggs"
- "Add to my grocery list, milk and sourdough"
- "Make the last sentence bold"
- "Actually delete that last note"
- "I think this should go somewhere about a book but I'm not sure"  ← should return clarification

---

## Phase 2: Frontend action dispatcher

**Tasks:**
1. Refactor the existing state management in `index.html` so that state mutations go through clean handler functions: `handleCreateBook(title)`, `handleAddNote(...)`, `handleToggleListItem(...)`, etc.
2. After the `/api/route.js` response comes back, iterate the `actions` array and call the matching handler for each.
3. Handle the clarification flow:
   - If `clarification` is set, show it as an overlay near the orb (small bubble, soft fade-in).
   - Store the pending clarification in a `pendingClarification` variable.
   - On the next recording, prepend the prior transcript + clarification to the new transcript before sending to `/api/route.js`, so the LLM has context.
4. After each action runs, save state to localStorage and re-render the sidebar and the main panel.
5. If an action references an item that doesn't exist (e.g. `toggleListItem` for "eggs" when there's no matching item), silently no-op and log a warning — do NOT show an error to the user. The LLM is supposed to handle that with clarification.

**Stop after Phase 2.** Show me the changes. Test these flows manually:
- Record "Add a new book called Karamazov." → sidebar should show Karamazov.
- Record "In Karamazov, add chapter one." → sidebar should expand and show "Chapter one."
- Record "In Karamazov chapter one, this part about Alyosha is gorgeous." → note saved in the right place.
- Record "Add a grocery list with milk eggs and bread." → new list created with three items.
- Record "Check off eggs." → eggs gets checked.

---

## Phase 3: Audio quality fix

The user has been having trouble with longer recordings — words get dropped, transcription cuts off. Fix the recording pipeline:

1. Inspect the MediaRecorder setup. Make sure `mediaRecorder.ondataavailable` is collecting chunks into an array and that `mediaRecorder.onstop` fires with the full blob before we send to `/api/transcribe`.
2. Set MediaRecorder's `timeslice` to 1000ms (1-second chunks) instead of leaving it undefined — this ensures more reliable data collection on long recordings.
3. On the backend, confirm that `/api/transcribe` isn't truncating the upload (Vercel has a 4.5MB body limit on Hobby tier; longer audio might exceed it). If audio is over 60s, we may need to either compress before upload or stream to Groq. For now, log the audio size on every request and tell me if it's hitting limits.
4. After Whisper returns, check the transcript length. If it's suspiciously short relative to the audio duration, log a warning. (e.g. 30 seconds of audio returning 5 words is suspicious.)
5. Ensure the audio mime type matches what Whisper expects. Chrome records as `audio/webm;codecs=opus`, which Whisper accepts. Safari can be weird — check the recorded format and convert if needed.

**Stop after Phase 3.** Test with a 30-second recording, a 60-second one, and a 90-second one. Tell me the audio file size, transcript length, and whether it felt accurate.

---

## Phase 4: Text formatting in notes

Add basic formatting support:

1. Notes in localStorage gain an optional `formatting` field: `[{ start: number, end: number, type: "bold" | "italic" }]`.
2. When rendering a note, apply the formatting by wrapping the relevant character ranges in `<strong>` or `<em>`.
3. The LLM already returns formatting ranges in Phase 1 — wire them through.
4. Be careful with edge cases: overlapping ranges, ranges that exceed the note length, etc. If a range is invalid, drop it silently.

**Stop after Phase 4.** Test "make this sentence bold" voice commands.

---

## Phase 5: Polish

Only after Phases 1–4 are solid:

1. Show a small "thinking…" indicator while waiting for `/api/route.js` to respond.
2. When the LLM creates a new book/chapter/list, briefly highlight it in the sidebar (1-second flash).
3. When the LLM asks for clarification, the user should be able to dismiss it with an "X" or by recording again.
4. Add an undo button at the top of the main canvas that reverts the last action.

---

## How to start

Begin with **Phase 1 only**. Before writing any code:

1. Tell me your plan: which Groq model you'll use, how you'll structure the tool definitions, what the system prompt will look like (paraphrased — I don't need the full thing yet, just the structure).
2. Tell me what could go wrong with this architecture and where the failure modes are.
3. Wait for my approval before writing.

If anything is unclear, ask me — don't guess.
