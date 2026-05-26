#!/usr/bin/env node
/**
 * Phase 1 smoke tests for /api/route.js tool-use endpoint.
 * Usage: node scripts/test-route.js
 * Requires GROQ_API_KEY or ANTHROPIC_API_KEY in env (or .env.local loaded manually).
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const handler = require('../api/route');

const SAMPLE_STATE = {
  books: [
    {
      id: 'book-eoe',
      title: 'East of Eden',
      chapters: [{ id: 'ch-1', title: 'Chapter one' }],
    },
  ],
  lists: [
    {
      id: 'list-grocery',
      title: 'Grocery list',
      type: 'todo',
      items: [
        { id: 'item-eggs', text: 'buy eggs', checked: false },
        { id: 'item-milk', text: 'milk', checked: false },
      ],
    },
  ],
  misc: [],
  recentNotes: [
    { id: 'note-1', text: 'First sentence. Last sentence here.', bookId: '__misc__', chapterId: null, listId: null },
  ],
  currentSelection: { categoryId: null, itemId: null, subItemId: null },
  routingMode: 'home',
  stickyTodoListId: null,
};

const TEST_CASES = [
  'Add a new book called Karamazov',
  'In East of Eden chapter one, this passage about Cathy hit hard',
  'Check off buy eggs',
  'Add to my grocery list, milk and sourdough',
  'Make the last sentence bold',
  'Actually delete that last note',
  "I think this should go somewhere about a book but I'm not sure",
];

function mockReq(body) {
  return { method: 'POST', body };
}

function mockRes() {
  const out = { statusCode: 200, body: null };
  return {
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(data) {
      out.body = data;
      return this;
    },
    get result() {
      return out;
    },
  };
}

async function runCase(transcript) {
  const req = mockReq({ transcript, state: SAMPLE_STATE });
  const res = mockRes();
  await handler(req, res);
  return res.result;
}

async function main() {
  console.log('Provider:', process.env.ROUTING_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'groq'));
  console.log('---\n');

  for (const transcript of TEST_CASES) {
    console.log(`INPUT: "${transcript}"`);
    try {
      const { statusCode, body } = await runCase(transcript);
      console.log(`STATUS: ${statusCode}`);
      console.log(JSON.stringify(body, null, 2));
    } catch (err) {
      console.error('ERROR:', err.message);
    }
    console.log('---\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
