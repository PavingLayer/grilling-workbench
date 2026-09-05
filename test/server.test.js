import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createWorkbenchServer, atomicWrite } from '../src/server.js';
import { makeReview } from '../src/core.js';

const fixture = JSON.parse(await readFile(new URL('../data/questions.json', import.meta.url)));
async function setup(t, write) {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-test-'));
  const questionsPath = join(dir, 'questions.json'), dataDir = join(dir, 'saved');
  await writeFile(questionsPath, JSON.stringify(fixture));
  const server = createWorkbenchServer({ questionsPath, dataDir, write });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { dir, questionsPath, dataDir, url, get: async () => { const response = await fetch(`${url}/api/session`); return { status: response.status, body: await response.json() }; }, post: async (body, headers = {}) => { const response = await fetch(`${url}/api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; } };
}
const edit = (questionId, optionIds, text = '') => ({ type: 'edit', questionId, answer: { optionIds, text } });

test('durable drafts, conflict detection, partial submission and retry', async t => {
  const api = await setup(t);
  let saved = (await api.get()).body;
  const first = { version: saved.version, requestId: 'edit-a', action: edit('atmosphere', ['quiet'], 'Test draft') };
  let response = await api.post(first);
  assert.equal(response.status, 200); saved = response.body;
  assert.equal((await api.post(first)).body.version, saved.version, 'retry does not edit twice');
  response = await api.post({ ...first, requestId: 'stale-tab' });
  assert.equal(response.status, 409);
  response = await api.post({ version: saved.version, requestId: 'edit-b', action: edit('activities', ['open-reading'], 'Pending note') });
  saved = response.body;
  const review = makeReview(saved.state, ['atmosphere'], 'submit-a', '2026-09-05T12:00:00.000Z');
  const submit = { version: saved.version, requestId: 'confirm-a', action: { type: 'submit', review } };
  response = await api.post(submit);
  assert.equal(response.status, 200);
  assert.equal((await api.post(submit)).body.state.submissions.length, 1);
  const disk = JSON.parse(await readFile(join(api.dataDir, 'session.json')));
  assert.deepEqual(disk.state.submissions[0], review);
  assert.equal(disk.state.drafts.activities.text, 'Pending note');
  assert.deepEqual((await api.get()).body.state, disk.state);
  const restarted = createWorkbenchServer({ questionsPath: api.questionsPath, dataDir: api.dataDir });
  restarted.listen(0, '127.0.0.1'); await once(restarted, 'listening');
  try {
    const restored = await (await fetch(`http://127.0.0.1:${restarted.address().port}/api/session`)).json();
    assert.deepEqual(restored.state, disk.state);
  } finally { await new Promise(resolve => restarted.close(resolve)); }
});

test('failed writes retain saved drafts and allow retrying the same confirmation', async t => {
  let fail = false;
  const api = await setup(t, async (...args) => { if (fail) throw new Error('Simulated disk failure'); return atomicWrite(...args); });
  let saved = (await api.get()).body;
  saved = (await api.post({ version: saved.version, requestId: 'draft', action: edit('atmosphere', ['quiet']) })).body;
  const before = await readFile(join(api.dataDir, 'session.json'), 'utf8');
  const action = { version: saved.version, requestId: 'confirm', action: { type: 'submit', review: makeReview(saved.state, ['atmosphere'], 's-1', '2026-09-05T12:00:00.000Z') } };
  fail = true;
  assert.equal((await api.post(action)).status, 500);
  assert.equal(await readFile(join(api.dataDir, 'session.json'), 'utf8'), before);
  assert.equal((await api.get()).body.state.drafts.atmosphere.optionIds[0], 'quiet');
  fail = false;
  assert.equal((await api.post(action)).body.state.submissions.length, 1);
});

test('agent definition edits refresh the session and invalidate stale reviews while retaining drafts', async t => {
  const api = await setup(t);
  let saved = (await api.get()).body;
  saved = (await api.post({ version: saved.version, requestId: 'draft', action: edit('atmosphere', ['quiet']) })).body;
  const review = makeReview(saved.state, ['atmosphere'], 's-1', '2026-09-05T12:00:00.000Z');
  const doc = structuredClone(fixture); doc.questions[0].context = 'Updated by the agent'; doc.questions[0].revision++;
  await writeFile(api.questionsPath, JSON.stringify(doc));
  const changed = (await api.get()).body;
  assert.equal(changed.state.questionnaire.questions[0].context, 'Updated by the agent');
  assert.deepEqual(changed.state.drafts, saved.state.drafts);
  assert.equal((await api.post({ version: changed.version, requestId: 'stale-review', action: { type: 'submit', review } })).status, 422);
  await writeFile(api.questionsPath, '{invalid');
  assert.equal((await api.get()).status, 500);
  assert.deepEqual(JSON.parse(await readFile(join(api.dataDir, 'session.json'))).state.drafts, saved.state.drafts);
});

test('corrupt saved data is never silently overwritten', async t => {
  const api = await setup(t);
  await mkdir(api.dataDir); await writeFile(join(api.dataDir, 'session.json'), '{broken');
  assert.equal((await api.get()).status, 500);
  assert.equal(await readFile(join(api.dataDir, 'session.json'), 'utf8'), '{broken');
});

test('local API rejects unrelated origins and never serves private files', async t => {
  const api = await setup(t);
  assert.equal((await api.post({}, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await fetch(`${api.url}/.workbench/session.json`)).status, 404);
  assert.equal((await fetch(`${api.url}/data/questions.json`)).status, 404);
});
