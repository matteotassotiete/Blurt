# Blurt

Voice annotation app for books. Hold the mic bar, speak, and notes are transcribed and filed automatically.

## Local development (with Whisper + smart routing backend)

The `/api` routes call [Groq](https://console.groq.com) for transcription and routing. API keys stay on the server — never in the browser.

### 1. Get a Groq API key

1. Sign up at [console.groq.com](https://console.groq.com)
2. Go to **API Keys** → **Create API Key**
3. Copy the key (shown once)

### 2. Set the key locally

```bash
cp .env.example .env.local
```

Edit `.env.local` and replace the placeholder:

```
GROQ_API_KEY=gsk_...
```

`.env*.local` is gitignored — do not commit your key.

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

1. Push to GitHub
2. Import the repo in [vercel.com](https://vercel.com)
3. Add environment variable `GROQ_API_KEY` in **Project → Settings → Environment Variables**
4. Redeploy

Production URLs are HTTPS automatically (required for mic access on iPhone).
