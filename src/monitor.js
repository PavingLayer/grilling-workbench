import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreState } from './core.js';
import { atomicWrite } from './storage.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultDataDir = join(root, '.workbench');

export async function readReceipts(dataDir = defaultDataDir) {
  let receipts;
  try { receipts = JSON.parse(await readFile(join(dataDir, 'chat-receipts.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { received: [] }; throw error; }
  if (!Array.isArray(receipts.received) || !receipts.received.every(r => typeof r.submissionId === 'string' && typeof r.receivedAt === 'string' && Number.isFinite(Date.parse(r.receivedAt)))) throw new Error('Chat receipts could not be read. They have been kept for recovery.');
  return receipts;
}

async function readSubmitted(dataDir) {
  let saved;
  try { saved = JSON.parse(await readFile(join(dataDir, 'session.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  // Only immutable submissions leave this helper. Drafts are never delivered.
  return restoreState(saved.state).submissions;
}

export async function pendingSubmissions(dataDir = defaultDataDir) {
  const [submissions, receipts] = await Promise.all([readSubmitted(dataDir), readReceipts(dataDir)]);
  const received = new Set(receipts.received.map(r => r.submissionId));
  return submissions.filter(s => !received.has(s.id));
}

export async function acknowledgeSubmission(id, { dataDir = defaultDataDir, write = atomicWrite } = {}) {
  const [submissions, receipts] = await Promise.all([readSubmitted(dataDir), readReceipts(dataDir)]);
  if (!submissions.some(s => s.id === id)) throw new Error('Only a saved submission can be acknowledged.');
  if (receipts.received.some(r => r.submissionId === id)) return receipts;
  const next = { received: [...receipts.received, { submissionId: id, receivedAt: new Date().toISOString() }] };
  await write(join(dataDir, 'chat-receipts.json'), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, id] = process.argv.slice(2);
    if (command === 'pending') console.log(JSON.stringify({ submissions: await pendingSubmissions() }, null, 2));
    else if (command === 'ack' && id) console.log(JSON.stringify(await acknowledgeSubmission(id)));
    else throw new Error('Use: node src/monitor.js pending | ack SUBMISSION_ID');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
