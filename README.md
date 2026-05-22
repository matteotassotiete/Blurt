# Blurt

Voice annotation app for books. Hold the mic bar, speak, and notes are transcribed and filed automatically.

## Local development (with Whisper + smart routing backend)

The `/api` routes use [Groq Whisper](https://console.groq.com) for transcription and [Claude Haiku](https://console.anthropic.com) (or Groq Llama) for smart routing. API keys stay on the server — never in the browser.

### 1. Get API keys

**Groq** (transcription — required):

1. Sign up at [console.groq.com](https://console.groq.com)
2. Go to **API Keys** → **Create API Key**

**Anthropic** (routing — recommended):

1. Sign up at [console.anthropic.com](https://console.anthropic.com)
2. Go to **API Keys** → create a key

If `ANTHROPIC_API_KEY` is set, routing uses Claude automatically. Without it, routing falls back to Groq Llama.

### 2. Set keys locally

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
GROQ_API_KEY=gsk_...
ANTHROPIC_API_KEY=sk-ant-...
```

`.env*.local` is gitignored — do not commit your keys.

### 3. Install dependencies

```bash
npm install
```

### 4. Run locally with Vercel dev server

```bash
npx vercel dev
```

Open the URL it prints (usually `http://localhost:3000`). This serves `index.html` and the `/api/transcribe` and `/api/route` serverless functions together.

### API endpoints

**POST `/api/transcribe`**

```json
{ "audio": "<base64>", "mimeType": "audio/webm", "filename": "recording.webm" }
```

Response: `{ "transcript": "..." }`

**POST `/api/route`**

```json
{
  "transcript": "...",
  "books": [{ "id": "...", "title": "...", "chapters": [{ "id": "...", "title": "..." }] }],
  "defaultBookId": "...",
  "defaultChapterId": null
}
```

Response: `{ "destinationBookId", "destinationChapterId", "noteText", "confidence", "reasoning" }`

### Deploy to Vercel

**Production URL:** [https://project-96zp3.vercel.app](https://project-96zp3.vercel.app)

**GitHub repo:** [github.com/matteotassotiete/Blurt](https://github.com/matteotassotiete/Blurt)

1. Push to `main` — Vercel redeploys automatically if Git is connected (see below).
2. In [Vercel → project-96zp3 → Settings → Environment Variables](https://vercel.com/matteotassoti-6593s-projects/project-96zp3/settings/environment-variables), add:
   - `GROQ_API_KEY` — your Groq key (transcription)
   - `ANTHROPIC_API_KEY` — your Anthropic key (routing; recommended)
   - Optional: `ROUTING_PROVIDER=anthropic` or `ROUTING_MODEL=claude-3-5-haiku-latest`
   - **Environments:** Production, Preview, Development
3. **Redeploy** after adding variables (Deployments → ⋯ → Redeploy).

**Connect GitHub (one-time, for auto-deploy on push):**

1. Vercel dashboard → **project-96zp3** → **Settings** → **Git**
2. Connect repository **matteotassotiete/Blurt**, branch `main`

**iPhone:**

1. Open `https://project-96zp3.vercel.app` in Safari
2. Allow microphone when prompted
3. Share → **Add to Home Screen**
4. Hold the bottom bar, speak, release — wait for “Transcribing…”

Production URLs are HTTPS automatically (required for mic on iPhone).
