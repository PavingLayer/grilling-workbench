import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createWorkbenchServer, atomicWrite } from '../src/server.js';
import { createSubmissionSocket, waitForSubmission } from '../src/submission-socket.js';
import { acknowledgeSubmission, pendingSubmissions, readReceipts } from '../src/delivery.js';
import { makeReview } from '../src/core.js';

const fixture = JSON.parse(await readFile(new URL('../data/questions.json', import.meta.url)));
async function setup(t, write) {
  const dataDir = await mkdtemp(join(tmpdir(), 'workbench-socket-'));
  const questionsPath = join(dataDir, 'questions.json');
  await writeFile(questionsPath, JSON.stringify(fixture));
  const server = createWorkbenchServer({ questionsPath, dataDir, write });
  const signals = createSubmissionSocket(server, { dataDir });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  signals.listen(0, '127.0.0.1'); await once(signals, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  return {
    dataDir, port: signals.address().port, url,
    get: async () => (await fetch(`${url}/api/session`)).json(),
    post: async body => { const response = await fetch(`${url}/api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; },
  };
}

test('socket wakes only after durable whole-form submission, including blanks', { timeout: 5000 }, async t => {
  let releaseWrite, enteredWrite, hold = false;
  const writing = new Promise(resolve => { enteredWrite = resolve; });
  const api = await setup(t, async (...args) => {
    if (hold) { enteredWrite(); await new Promise(resolve => { releaseWrite = resolve; }); }
    return atomicWrite(...args);
  });
  let state = await api.get();
  let ready;
  const connected = new Promise(resolve => { ready = resolve; });
  let delivered = false;
  const event = waitForSubmission({ port: api.port, onReady: ready }).then(async submission => {
    delivered = true;
    const disk = JSON.parse(await readFile(join(api.dataDir, 'session.json')));
    assert.deepEqual(disk.state.submissions[0], submission, 'notification follows durable save');
    return submission;
  });
  await connected;
  state = (await api.post({ version: state.version, requestId: 'draft', action: { type: 'edit', questionId: 'atmosphere', answer: { optionIds: ['social'], text: 'Socket test' } } })).body;
  assert.equal(delivered, false, 'drafts never signal completion');
  const review = makeReview(state.state, 'form-1', '2026-09-05T12:00:00.000Z');
  const request = { version: state.version, requestId: 'submit', action: { type: 'submit', review } };
  hold = true;
  const submitting = api.post(request);
  await writing;
  assert.equal(delivered, false, 'a submission waiting on storage does not signal completion');
  releaseWrite();
  assert.equal((await submitting).status, 200);
  const received = await event;
  assert.deepEqual(received.answers.map(a => a.outcome), ['answered', 'not_answered', 'not_answered']);
  assert.equal((await api.post(request)).body.state.submissions.length, 1);
  assert.equal((await pendingSubmissions(api.dataDir)).length, 1);
  await assert.rejects(acknowledgeSubmission(review.id, { dataDir: api.dataDir, write: async () => { throw new Error('disk full'); } }), /disk full/);
  assert.equal((await pendingSubmissions(api.dataDir)).length, 1, 'failed acknowledgment remains recoverable');
  await acknowledgeSubmission(review.id, { dataDir: api.dataDir });
  await acknowledgeSubmission(review.id, { dataDir: api.dataDir });
  assert.equal((await readReceipts(api.dataDir)).received.length, 1);
  assert.deepEqual(await pendingSubmissions(api.dataDir), []);
  const delivery = await (await fetch(`${api.url}/api/delivery`)).json();
  assert.equal(delivery.received[0].submissionId, review.id);
});

test('reconnection replays unreceived forms and suppresses acknowledged submissions', { timeout: 5000 }, async t => {
  const api = await setup(t);
  const state = await api.get();
  const review = makeReview(state.state, 'blank-form', '2026-09-05T12:00:00.000Z');
  const partial = { ...review, answers: review.answers.slice(0, 1) };
  assert.equal((await api.post({ version: state.version, requestId: 'partial', action: { type: 'submit', review: partial } })).status, 422);
  assert.equal((await api.post({ version: state.version, requestId: 'submit', action: { type: 'submit', review } })).status, 200);
  assert.deepEqual(await waitForSubmission({ port: api.port }), review);
  assert.deepEqual(await waitForSubmission({ port: api.port }), review, 'a disconnected receiver without a receipt can reconnect');
  await acknowledgeSubmission(review.id, { dataDir: api.dataDir });
  const abort = new AbortController();
  let ready;
  const connected = new Promise(resolve => { ready = resolve; });
  const waiting = waitForSubmission({ port: api.port, signal: abort.signal, onReady: ready });
  const stopped = assert.rejects(waiting, /aborted/);
  await connected;
  abort.abort(); await stopped;
  await assert.rejects(acknowledgeSubmission('not-a-submission', { dataDir: api.dataDir }), /Only a saved submission/);
});
