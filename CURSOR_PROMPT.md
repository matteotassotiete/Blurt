# Cursor Prompt: Upgrade Blurt to Whisper + Smart Routing

Copy everything below this line into Cursor's chat. Work through it section by section — don't paste it all at once and expect magic. Cursor does best when given one phase at a time.

---

## Context (always include this first)

I'm building **Blurt**, a vanilla HTML/CSS/JS web app — no framework, no build step. The entire app lives in a single `index.html` file. Data is stored in `localStorage` under the key `blurt-v1`. It's a voice annotation app for books: users add books with chapters, hold a mic button, speak, and the transcribed note saves under the selected book/chapter.

**Current state:** I'm using the browser's Web Speech API (`window.SpeechRecognition`) for transcription. Quality is poor — accents, technical words, and long-form speech all break it. I want to replace it with **Groq's hosted Whisper API** for much better transcription, and add an LLM-based smart routing step so users can speak the destination as part of the note (e.g., "add this to Brothers Karamazov chapter three: this part reminded me of...") and the app files it correctly.

**Hard rules — do not violate these:**
- Do not introduce React, Vue, Svelte, or any framework.
- Do not split into multiple files yet — keep everything in `index.html`.
- Do not change the existing UI unless I ask. Only swap the transcription engine and add the routing layer.
- Show me the diff before applying any change. Explain what's changing and why.
- One phase at a time. Stop and wait for me after each phase.

---

## Phase 1: Set up the backend (serverless functions on Vercel)

Right now Blurt is a single static HTML file. To call Groq and an LLM securely, I need a tiny backend — Vercel serverless functions — because I can't put API keys in the browser.

**Tasks:**
1. Create the folder structure for Vercel:
   ```
   /
   ├── index.html
   ├── api/
   │   ├── transcribe.js   (calls Groq Whisper)
   │   └── route.js        (calls LLM for smart routing)
   ├── vercel.json         (if needed)
   └── package.json        (for dependencies)
   ```
2. Initialize `package.json` with `groq-sdk` and `openai` as dependencies (we'll use OpenAI's SDK to call Groq since Groq is OpenAI-compatible, or use Groq's native SDK — your call, just pick one and explain why).
3. Write `api/transcribe.js`:
   - Accept POST with audio file (multipart/form-data or base64 — pick the simpler one)
   - Forward to Groq's `whisper-large-v3` model
   - Return `{ transcript: "..." }` as JSON
   - Read API key from `process.env.GROQ_API_KEY`
   - Handle errors with proper status codes
4. Write `api/route.js`:
   - Accept POST with `{ transcript: string, books: [...], defaultBookId: string, defaultChapterId: string | null }`
   - Call an LLM (Groq's `llama-3.1-8b-instant` is fine — it's fast and free-tier-friendly) with a routing prompt
   - Return `{ destinationBookId, destinationChapterId, noteText, confidence: "high"|"medium"|"low", reasoning }`
   - The LLM prompt should follow these rules:
     - Confidence "high" only if user explicitly named the destination
     - Confidence "medium" if inferred from content but uncertain
     - Confidence "low" if no signal — use the default destination
     - Strip routing phrases like "add this to X" from `noteText`
     - Never invent destinations that don't exist in the provided list
   - Force structured JSON output (use the LLM's JSON mode if available)
5. Create a `.env.local` file with placeholder for `GROQ_API_KEY` and add `.env*` to `.gitignore`.
6. Add a `README.md` section explaining how to: get a Groq API key, set it locally, and run `vercel dev` to test.

**Stop after Phase 1. Show me everything, walk me through it, and let me confirm before moving on.**

---

## Phase 2: Update the frontend to use the new backend

Now wire the existing `index.html` to call the new endpoints instead of using Web Speech API.

**Tasks:**
1. **Remove the Web Speech API code entirely.** The `recognition` object, all `onresult` handlers, the browser-warning div — gone.
2. **Add MediaRecorder-based audio capture:**
   - When user holds the mic button, start `MediaRecorder` recording from `navigator.mediaDevices.getUserMedia({ audio: true })`.
   - When they release, stop the recorder, get the audio Blob.
   - Use `audio/webm` or `audio/mp4` — whichever Groq Whisper accepts (check Groq's docs; Whisper accepts most formats).
3. **Show a "Transcribing..." state** in the floating indicator box (where the live transcript used to appear) — since we don't have streaming transcription anymore, we need to show progress.
4. **Send the audio to `/api/transcribe`** — POST with the audio Blob. Get back `{ transcript }`.
5. **Send the transcript to `/api/route`** along with the current state's books list and the currently selected book/chapter as defaults.
6. **Save the note to the destination the routing API returned.** Show the user where it was saved.
7. **If confidence is "medium" or "low",** show a small inline message under the saved note: "Saved to [book name]. Wrong place? [Tap to move]" — clicking opens a simple dropdown to reassign the note's destination.
8. **Handle errors gracefully:**
   - No mic permission → friendly error
   - Network error → retry button + keep the audio so user doesn't lose it
   - Transcription failure → show error, allow retry
9. **Preserve the existing UI exactly.** No visual changes except the floating indicator's text.

**Stop after Phase 2. Show me the diff. Let me test it locally with `vercel dev` before moving on.**

---

## Phase 3: Deploy to Vercel

Once Phase 2 works locally:

1. Walk me through creating a Vercel account and linking my GitHub repo (`matteotassotiete/Blurt`).
2. Walk me through setting the `GROQ_API_KEY` environment variable in the Vercel dashboard.
3. Confirm the production URL works on desktop and on my iPhone Safari.
4. Test the full flow on iPhone:
   - Hold mic → record → transcribe → route → save
   - Note that mic permission on iOS Safari requires the site be served over HTTPS (Vercel does this automatically).

---

## Phase 4: Quality of life

Only after Phases 1–3 are working:

1. Add an "edit note" button so I can fix transcription errors after the fact.
2. Add a way to set a "currently reading" book that becomes the default destination (instead of always using whatever's selected in the sidebar).
3. Add a small visual cue showing the routing confidence on each note (subtle — a dot color or a tiny label).

---

## How to start

Begin with **Phase 1 only**. Do not start Phase 2 until I explicitly say "go." Show me the file structure you'll create, the contents of each file, and explain your choices. If you have questions about anything (which Groq SDK to use, which audio format, how to structure the LLM prompt), ask me before writing code — don't guess.
