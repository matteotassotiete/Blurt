const Groq = require('groq-sdk');
const { toFile } = require('groq-sdk');

/** Vercel Hobby request body limit (~4.5 MB). Base64 JSON payload must stay under this. */
const VERCEL_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;
/** Raw audio above this is unlikely to fit in a JSON base64 POST on Hobby tier. */
const RECOMMENDED_MAX_AUDIO_BYTES = 3.2 * 1024 * 1024;

function normalizeAudioForWhisper(mimeType, filename) {
  const mime = (mimeType || 'audio/webm').toLowerCase();
  let type = mime;
  let name = filename || 'recording.webm';

  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac') || mime.includes('x-caf')) {
    type = 'audio/mp4';
    name = /\.(m4a|mp4|caf)$/i.test(name) ? name : 'recording.m4a';
  } else if (mime.includes('ogg')) {
    type = 'audio/ogg';
    name = /\.ogg$/i.test(name) ? name : 'recording.ogg';
  } else if (mime.includes('webm')) {
    type = 'audio/webm';
    name = /\.webm$/i.test(name) ? name : 'recording.webm';
  } else if (mime.includes('wav')) {
    type = 'audio/wav';
    name = /\.wav$/i.test(name) ? name : 'recording.wav';
  }

  return { type, name };
}

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function collectWarnings(buffer, durationSeconds, transcript) {
  const warnings = [];
  const audioBytes = buffer.length;
  const estimatedPayload = Math.ceil(audioBytes * 1.37) + 512;

  console.log('[transcribe] audio bytes:', audioBytes, {
    durationSeconds: durationSeconds ?? 'unknown',
    mimeEstimate: estimatedPayload,
  });

  if (audioBytes > RECOMMENDED_MAX_AUDIO_BYTES) {
    warnings.push(
      `Audio file is large (${(audioBytes / (1024 * 1024)).toFixed(1)} MB). Upload may hit Vercel's ~4.5 MB body limit — try a shorter recording.`
    );
  }

  if (estimatedPayload > VERCEL_BODY_LIMIT_BYTES) {
    warnings.push(
      `Estimated upload size (${(estimatedPayload / (1024 * 1024)).toFixed(1)} MB) exceeds Vercel body limit. Recording may fail to upload.`
    );
  }

  if (durationSeconds && durationSeconds >= 10) {
    const words = countWords(transcript);
    const wordsPerSec = words / durationSeconds;
    if (wordsPerSec < 0.35) {
      warnings.push(
        `Transcript may be incomplete: ${words} words for ${Math.round(durationSeconds)}s of audio (${wordsPerSec.toFixed(2)} words/sec).`
      );
    }
  }

  if (warnings.length) {
    console.warn('[transcribe] warnings:', warnings);
  }

  return warnings;
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
    audio,
    mimeType = 'audio/webm',
    filename = 'recording.webm',
    durationSeconds = null,
    books = [],
    lists = [],
  } = req.body || {};

  if (!audio || typeof audio !== 'string') {
    return res.status(400).json({ error: 'Missing audio (base64 string required)' });
  }

  try {
    const buffer = Buffer.from(audio, 'base64');
    if (!buffer.length) {
      return res.status(400).json({ error: 'Audio data is empty' });
    }

    const parsedDuration = typeof durationSeconds === 'number' && durationSeconds > 0
      ? durationSeconds
      : null;

    if (buffer.length > RECOMMENDED_MAX_AUDIO_BYTES) {
      console.warn('[transcribe] large upload:', buffer.length, 'bytes', {
        durationSeconds: parsedDuration,
      });
    }

    const { type, name } = normalizeAudioForWhisper(mimeType, filename);
    const groq = new Groq({ apiKey });
    const file = await toFile(buffer, name, { type });

    const vocab = [
      'Blurt',
      'add to',
      'add a list',
      'to-do list',
      'miscellaneous',
      ...books.filter(Boolean),
      ...lists.filter(Boolean),
    ];
    const prompt = vocab.join(', ').slice(0, 220);

    const result = await groq.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3',
      language: 'en',
      response_format: 'json',
      prompt,
    });

    const transcript = result.text || '';
    const warnings = collectWarnings(buffer, parsedDuration, transcript);

    return res.status(200).json({
      transcript,
      meta: {
        audioBytes: buffer.length,
        durationSeconds: parsedDuration,
        wordCount: countWords(transcript),
        mimeType: type,
        filename: name,
        warnings,
      },
    });
  } catch (err) {
    console.error('transcribe error:', err);
    const status = err.status || err.statusCode || 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: err.message || 'Transcription failed',
    });
  }
};
