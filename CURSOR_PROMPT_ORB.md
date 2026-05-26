# Cursor Prompt: Redesign Blurt's Main Canvas (Ambient Orb)

Paste everything below into Cursor's chat. This is a UI-only change — do not touch transcription, routing, storage, or sidebar logic.

---

## Context

I'm building **Blurt**, a vanilla HTML/CSS/JS web app (no framework). It's a voice annotation app — users hold a mic to record, transcript goes to a Groq Whisper endpoint, an LLM routes it to the right destination, and the note saves to localStorage. The sidebar has three categories (Books, Lists, Miscellaneous).

The current main canvas has a single mic button floating in the middle. I want to replace it with an **ambient breathing orb** design where:

1. The **entire main canvas area is the mic trigger** — clicking and holding anywhere in the canvas starts recording (not just a button).
2. A soft glowing orb breathes in the center as ambient state.
3. On hover, the orb expands slightly.
4. On press-and-hold, the orb shifts to a red/warm tone and pulses faster (recording state).
5. The "Blurt" wordmark sits in the center in serif type, with a small tagline below.

**Hard rules:**
- Do not refactor anything outside the main canvas area.
- Do not touch the sidebar HTML, the category logic, the mic recording logic, the API calls, or localStorage.
- Do not introduce frameworks or new dependencies.
- The existing mic button (the bottom-right floating one, if it's still there) should be **removed** — the whole canvas becomes the button.
- Preserve all existing event handlers — just move them from the old mic button element to the new canvas element. Mousedown/mouseup/mouseleave/touchstart/touchend should all trigger the same `startRecording()` / `stopRecording()` functions that already exist.
- Keep dark mode working (the app currently has a dark theme).

---

## The design to implement

Use this exact HTML and CSS as the starting point. Adapt class names if they collide with existing styles, but keep the visual result identical.

### HTML structure (replace whatever is currently inside the main canvas container)

```html
<div class="canvas" id="canvas">
  <div class="orb"></div>
  <div class="orb-2"></div>
  <div class="content">
    <div class="wordmark">Blurt</div>
    <div class="tagline">say where it goes, then your note</div>
    <div class="hint">tap anywhere & hold to speak</div>
  </div>
  <div class="recording-text">
    <span class="recording-dot"></span>listening…
  </div>
</div>
```

### CSS to add

```css
.canvas {
  flex: 1;
  position: relative;
  cursor: pointer;
  user-select: none;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}

.orb {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 380px;
  height: 380px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(212, 165, 116, 0.35) 0%, rgba(212, 165, 116, 0.08) 40%, transparent 70%);
  transform: translate(-50%, -50%);
  animation: breathe 4s ease-in-out infinite;
  pointer-events: none;
  transition: all 0.4s ease;
}

.orb-2 {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 240px;
  height: 240px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(212, 165, 116, 0.5) 0%, rgba(212, 165, 116, 0.15) 50%, transparent 75%);
  transform: translate(-50%, -50%);
  animation: breathe 4s ease-in-out infinite 1s;
  pointer-events: none;
  transition: all 0.4s ease;
}

@keyframes breathe {
  0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.7; }
  50% { transform: translate(-50%, -50%) scale(1.08); opacity: 1; }
}

.canvas:hover .orb { width: 460px; height: 460px; }
.canvas:hover .orb-2 { width: 280px; height: 280px; }

.canvas.active .orb {
  background: radial-gradient(circle, rgba(220, 80, 60, 0.45) 0%, rgba(220, 80, 60, 0.1) 40%, transparent 70%);
  animation: breathe 1s ease-in-out infinite;
}
.canvas.active .orb-2 {
  background: radial-gradient(circle, rgba(220, 80, 60, 0.6) 0%, rgba(220, 80, 60, 0.2) 50%, transparent 75%);
  animation: breathe 1s ease-in-out infinite 0.5s;
}

.content {
  position: relative;
  z-index: 2;
  text-align: center;
  pointer-events: none;
}

.wordmark {
  font-family: 'Iowan Old Style', Georgia, serif;
  font-size: 64px;
  font-weight: 400;
  letter-spacing: -1px;
  margin-bottom: 8px;
}

.tagline {
  font-size: 13px;
  color: rgba(241, 237, 229, 0.45);
  font-style: italic;
  letter-spacing: 0.3px;
  margin-bottom: 60px;
}

.hint {
  font-size: 12px;
  color: rgba(241, 237, 229, 0.3);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  transition: opacity 0.3s;
}

.canvas.active .hint { opacity: 0; }
.canvas.active .wordmark { opacity: 0.3; }

.recording-text {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 14px;
  color: #d4a574;
  opacity: 0;
  transition: opacity 0.3s;
  font-style: italic;
  letter-spacing: 0.5px;
}
.canvas.active .recording-text { opacity: 1; }

.recording-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #dc5040;
  margin-right: 8px;
  animation: blink 1s infinite;
}
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
}
```

### JS wiring (replace the existing mic-button event listeners)

The canvas element itself becomes the press target. Find wherever `startRecording()` and `stopRecording()` are currently being called from the old mic button, and replace those listeners with these (keep the function definitions exactly as they are):

```js
const canvas = document.getElementById('canvas');
canvas.addEventListener('mousedown', (e) => {
  // Ignore if the click started inside the sidebar or on an interactive child
  if (e.target.closest('.sidebar')) return;
  canvas.classList.add('active');
  startRecording();
});
canvas.addEventListener('mouseup', () => {
  if (!canvas.classList.contains('active')) return;
  canvas.classList.remove('active');
  stopRecording();
});
canvas.addEventListener('mouseleave', () => {
  if (!canvas.classList.contains('active')) return;
  canvas.classList.remove('active');
  stopRecording();
});
canvas.addEventListener('touchstart', (e) => {
  if (e.target.closest('.sidebar')) return;
  e.preventDefault();
  canvas.classList.add('active');
  startRecording();
});
canvas.addEventListener('touchend', () => {
  if (!canvas.classList.contains('active')) return;
  canvas.classList.remove('active');
  stopRecording();
});
```

---

## What I expect you to do

1. **Read the current `index.html`** and tell me what the existing main canvas section looks like before you change anything.
2. **Show me a diff** of the HTML, CSS, and JS changes you're about to make. Walk me through it.
3. **Confirm with me before applying.**
4. **After applying, tell me:**
   - Did the existing recording logic still work? (Press-and-hold → audio captured → transcribed → routed → saved.)
   - Is there a `currentBook` / `currentChapter` selection somewhere that needs to display in the canvas? If so, where should we add it (without ruining the clean look)?
   - Did any existing styles conflict? (e.g., a previous `.canvas` or `.orb` class.)
5. **Do not** add or remove any features beyond the visual redesign. No new buttons, no new flows.

---

## After this is done

We'll probably want to revisit a few things in a follow-up — don't do them now, just flag them if you notice:
- Showing the currently-selected destination subtly somewhere (maybe a small label that fades in near the orb).
- Mobile sizing — the 64px wordmark might be too big on small screens.
- The hint text should probably hide after the user's first successful recording (one-time onboarding cue).

Start by reading `index.html` and reporting back what you see in the main canvas area. Wait for my go before making changes.
