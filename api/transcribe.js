const Groq = require('groq-sdk');
const { toFile } = require('groq-sdk');

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

    const groq = new Groq({ apiKey });
    const file = await toFile(buffer, filename, { type: mimeType });

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

    return res.status(200).json({ transcript: result.text || '' });
  } catch (err) {
    console.error('transcribe error:', err);
    const status = err.status || err.statusCode || 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: err.message || 'Transcription failed',
    });
  }
};
