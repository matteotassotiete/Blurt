# Blurt — v1 Build Plan

This is a step-by-step plan to validate and ship v1 of Blurt: a web-based voice annotation app for books. Work through it sequentially. Don't skip ahead. Each step has a clear "done when" so you know whether to move on.

## Context for Cursor

You are helping me build **Blurt**, a vanilla HTML/CSS/JS web app — no framework, no build step. Everything lives in a single `index.html` file. Data is stored in `localStorage` under the key `blurt-v1`. Speech recognition uses the Web Speech API (`window.SpeechRecognition` / `window.webkitSpeechRecognition`).

**Rules:**
- Do not suggest React, Vue, Svelte, or any framework. Not yet.
- Do not split into multiple files yet. Keep everything in `index.html`.
- Do not add a backend. Local-only.
- When in doubt, prefer the simpler solution.
- Before changing anything, tell me what you're about to change and why.

---

## Phase 0 — Local setup

### Step 0.1: Get the project running
- [ ] Create folder `blurt`, drop `index.html` inside.
- [ ] Open in Cursor: `cursor .`
- [ ] Initialize git: `git init && git add . && git commit -m "Initial v1 prototype"`
- [ ] Open `index.html` in Chrome (double-click or run `npx serve .` and visit localhost).

**Done when:** the app loads in Chrome and you see the Blurt sidebar with "East of Eden" pre-seeded.

### Step 0.2: Sanity check the existing UI
- [ ] Click "East of Eden" — confirm chapters expand below it.
- [ ] Click "Part One" — confirm the main panel header updates.
- [ ] Click "+ Add book" — add a book called "Test Book". Confirm it appears.
- [ ] Click "+ Add chapter" inside Test Book — add "Chapter 1". Confirm it appears.
- [ ] Refresh the page — confirm Test Book and Chapter 1 persisted (localStorage works).

**Done when:** all of the above works without errors. If anything breaks, fix that before moving on.

---

## Phase 1 — Make the microphone actually work

This is the make-or-break feature. If voice doesn't feel good, nothing else matters.

### Step 1.1: Verify mic permissions and basic recording
- [ ] With "East of Eden → Part One" selected, hold down the mic button (bottom-right).
- [ ] Browser should prompt for microphone permission. Click **Allow**.
- [ ] While holding, speak: "This is a test annotation."
- [ ] Confirm the floating "Listening" box appears above the mic and shows your words in real time.
- [ ] Release the mic. Confirm the note appears in the main panel with a timestamp.
- [ ] Refresh page. Confirm note is still there.

**Done when:** you can record a note, see live transcription, and the note persists.

### Step 1.2: Test edge cases — these will break things
- [ ] Hold the mic, say nothing for 3 seconds, release. → Should not create an empty note.
- [ ] Hold the mic, say "test", drag your mouse OFF the mic button without releasing. → Should still stop recording (mouseleave fallback).
- [ ] Try recording on mobile: open the file on your phone (email it to yourself or use `npx serve .` and visit the local IP from your phone on the same wifi). Touch and hold the mic.
- [ ] Try recording WITHOUT selecting a book first (deselect by adding a fresh book and not clicking it). → Should alert "Pick a book first."

**Done when:** all edge cases behave sensibly. Fix any that don't with Cursor's help — paste this prompt: *"In index.html, the mic button [describe what's broken]. Find the relevant code and fix it. Show me the change before applying."*

### Step 1.3: Real-world test (THIS IS THE IMPORTANT ONE)
- [ ] Pick a book you're actually reading.
- [ ] Add it to Blurt.
- [ ] For 2–3 days, every time you'd normally want to annotate, use Blurt.
- [ ] Keep notes (on paper or in your phone's notes app) about what feels good and what feels broken.

**Done when:** you've used it on a real book for at least 48 hours. Don't skip this. This is the entire point of building a prototype.

---

## Phase 2 — Fix what Phase 1 revealed

Based on your real-world test, you'll have a list. Likely candidates:

- [ ] Transcription accuracy is bad for specific words → consider letting users edit notes after they're saved.
- [ ] Holding the mic on phone is awkward → add tap-to-toggle as an alternative.
- [ ] Hard to remember which book is "currently selected" → make the current selection more prominent in the UI.
- [ ] Background noise picks up garbage → add a "discard" button while recording.

**Pick the TOP 2 issues only.** Don't try to fix everything. Use this Cursor prompt format:

> In `index.html`, [describe the issue]. Specifically [give a concrete example]. Propose a minimal change to fix it. Show me the diff before applying.

**Done when:** your top 2 friction points from real use are addressed.

---

## Phase 3 — Mobile polish (still no native app)

You want this on your phone for real testing. Let's make the web version feel app-like on mobile.

### Step 3.1: Add a web manifest
- [ ] Create a `manifest.json` file in the project folder with name, short_name, icons, theme color.
- [ ] Link it from `index.html` head: `<link rel="manifest" href="manifest.json">`
- [ ] Add iOS-specific meta tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`.

**Cursor prompt:** *"Add a minimal web app manifest and the iOS standalone meta tags to index.html so that when added to home screen on iOS, the app opens fullscreen without the Safari chrome. Give me the manifest.json contents and the head tag additions."*

### Step 3.2: Make the layout work on mobile
- [ ] On phone, the sidebar takes up too much room. Add a media query so on screens < 600px, the sidebar becomes a slide-in drawer activated by a menu icon.
- [ ] Make sure the mic button is easily thumb-reachable (bottom-right is good, but check size).

**Cursor prompt:** *"Add a responsive layout to index.html: on screens narrower than 600px, the sidebar should be hidden by default and slide in from the left when a hamburger menu icon is tapped. Keep the existing desktop layout unchanged for wider screens."*

### Step 3.3: Install to home screen and test
- [ ] Host the file somewhere with HTTPS (required for Speech API on mobile). Easiest options: deploy to **Vercel** or **Netlify** (drag-drop, free, ~2 minutes).
- [ ] On iPhone Safari, visit the URL → Share → Add to Home Screen.
- [ ] Tap the home screen icon. Confirm it opens fullscreen, no Safari bars.
- [ ] Test mic. **iOS Safari Speech API has quirks** — if it doesn't work, that's a known limitation, not your bug. Plan B is to record audio and transcribe via a cloud API (later, not now).

**Done when:** Blurt is installed on your phone home screen and you can record a note from there.

---

## Phase 4 — Decision point

After Phases 0–3, you have a working web app installed on your phone. Now ask yourself honestly:

1. **Did I actually use it?** Count: how many real annotations did you make in the past week?
2. **What's still missing?** What did you want to do that you couldn't?
3. **Is the friction gone, or just moved?** Is opening the home screen icon + tapping mic actually faster than your previous workflow?

### If you used it 10+ times and miss it when it's gone:
→ Move to v2. Candidates: smart routing mic (the top-bar one), iOS Shortcut integration, native Swift rewrite, cloud sync, sharing.

### If you used it 1–5 times:
→ Something's off. Talk to 3 other readers. Show them. Watch them try. Figure out what's wrong before adding features.

### If you didn't use it:
→ Honest answer time: was this the right problem? Maybe the friction wasn't actually the bottleneck. Maybe you don't annotate as much as you thought. That's valuable info. Don't pour months into a problem you don't have.

---

## How to use this plan with Cursor

When you want help on a step, paste this into Cursor's chat:

```
I'm working on Blurt, a vanilla HTML/JS web app for voice book annotations.
Current step: [paste the step from above]
What's happening: [describe what you tried]
What I expected: [describe expected behavior]
What actually happened: [describe actual behavior]

Don't rewrite the whole file. Show me the minimal change and explain it before applying.
```

The "don't rewrite the whole file" line matters. Cursor's AI will absolutely refactor your entire app if you let it. Keep it on a leash.

---

## What NOT to do in v1

- Don't add user accounts.
- Don't add cloud sync.
- Don't add AI smart routing yet (that's v2).
- Don't add a backend.
- Don't switch frameworks.
- Don't redesign the UI three times.
- Don't add export features until someone asks for one.
- Don't worry about the App Store. This is a web app for now.

The goal of v1 is one thing: **prove that one-tap voice annotation makes you (and ideally a few other people) annotate more.** That's it.
